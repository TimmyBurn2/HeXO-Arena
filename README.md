# HeXO Arena

A lichess-inspired arena where bots play HeXO: bot vs bot over the API,
humans vs bots in the browser. The server is only ever a referee; it executes
no engine code.

**Status: early.** Identity (Discord OAuth login, dev-only login), bot
management (create, list, delete, rotate token), the bot stream (NDJSON
presence with keepalive and reconnect-close), and the account
self-declaration are live server-side; the rules engine exists in
`packages/rules`, differentially tested against HeXO; a logged-in human
plays a connected bot end to end (creation gates, per-game htttx engine
sessions over websocket, clocks with forfeits, resign both ways, full
move persistence); bots challenge bots over the API (challenge inbox with
a TTL, accept/decline/cancel, idempotent creation, per-pair and per-bot
daily caps, bot-vs-bot games over two engine sessions); Glicko-2 ratings
update on every decided game, cached from the game log and reproducible by
folding it, with ratings on the directory and a leaderboard; the operator
administers the site over a local socket (below); the web app is not
started.

## Layout

pnpm monorepo:

- `apps/server`: Fastify API, SQLite
- `apps/web`: React/Vite SPA shell
- `packages/contract`: zod schemas; `openapi.yaml` is generated from here and
  never hand-edited
- `packages/rules`: pure rules engine, no runtime dependencies; HeXO
differential corpus committed, live-oracle test runs when a sibling HeXO
checkout exists
- `scripts/dev-bots`: local opponents for development, a separate client
  process that never ships

## Commands

- Install: `pnpm install`
- Dev: `cp .env.example .env` once, then `pnpm dev` (server :3000, web
  :5173, hot reload; Ctrl-C stops both). The server and the admin client
  load `.env` when it exists; production uses the env files in `DEPLOY.md`
  instead
- Docker dev runtime: `pnpm dev:compose` (operator-run)
- Local opponents: `pnpm dev:bots` in a second terminal (below)
- Dev personas: `pnpm dev:seed` (below)
- Tests: `pnpm test`
- Prod build: `pnpm build`
- Type-check + lint: `pnpm check`
- Regenerate `openapi.yaml`: `pnpm openapi`

## Local play, signed out

The site runs no bots of its own, so a bare dev stack has nobody to play.
`pnpm dev:bots` supplies opponents as a separate process that plays over
the same bot API as any other bot:

1. `cp .env.example .env`, once
2. `pnpm dev`
3. `pnpm dev:bots` in a second terminal
4. open http://localhost:5173/play signed out, pick a `devbot`, then
   Play as guest

The runner refuses a target that does not answer the dev login route.
It signs in `devowner-a` to `devowner-c`, one owner per bot since an
owner's bots may not challenge each other, and claims `devbot-a` to
`devbot-c` with fresh tokens, kept in `apps/server/data/dev-bots.json`.
The bots play random turns next to the stones, accept turn clocks from
5 s to five minutes and every match and unlimited clock, and challenge
each other once a minute until a daily cap refuses.
Ctrl-C closes every stream; `pnpm dev` never starts the runner.
`DEV_BOTS_ORIGIN` (default `http://127.0.0.1:$PORT`) and `DEV_BOTS_COUNT`
(1 to 3, default 3) adjust it.

## Dev personas

`pnpm dev:seed`, beside `pnpm dev`, builds five accounts over the same
API, each there to show one state:

- `ana` at the bot cap: `hextide` (extends its longest line), `pebble`
  (random turns), and `lantern` (never connects, declares nothing), plus
  four rated games as a human
- `bruno`, about ten rated games and no bots
- `cleo`, brand new
- `dmitri` with `quietlake`, provisional
- `eve`, banned through the admin client after two games

The seed plays the history itself, the humans with random turns over the
human routes, inside the daily caps and the creation cooldown, so a first
run takes about ten minutes.
A rerun plays only what is missing.
It ends with each persona's standing and the bots that became ranked.
`pnpm dev:bots` brings `hextide`, `pebble`, and `quietlake` online from
`apps/server/data/dev-seed.json` once the seed has run; restart it after
the first seed.

In the browser, the dev pill at the bottom left of framed screens names
who is signed in and opens a panel: each persona one click away, any
name, a first sign-in on to `/welcome`, a guest session, and sign out.
In dev the Discord button opens the same panel.
The pill loads only in the dev server's bundle and only when
`GET /api/dev/accounts` answers; the production build holds none of it.

## Server environment

`.env.example` lists every variable with its development value.

- `HOST`, `PORT`, `DATABASE_PATH`: bind and sqlite location
- `PUBLIC_ORIGIN`: site origin; builds the OAuth redirect uri and the link
  preview's image address, and decides the session cookie's `Secure` flag
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`: with both set, Discord login is
  live; otherwise the auth routes answer `503`
- `DEV_LOGIN=1`: registers `POST /api/dev/login`, which creates a synthetic
  Discord identity by chosen name for local development; with the flag unset
  the route does not exist. Given a Discord account instead, as
  `{"discord": {"username": "mira.hex", "displayName": "Mira"}}`, it returns
  as a Discord sign-in would: a new account goes on to `/welcome`, so the
  first sign-in works locally without Discord. It also registers
  `GET /api/dev/accounts`, the seeded personas as they stand
- `ADMIN_SOCKET_PATH`: the admin socket, default `data/run/admin.sock`; its
  directory must be mode 0700 and owned by the server's uid, or boot fails.
  A socket left by an unclean stop is replaced at boot; a socket another
  server answers on, or any other file at the path, fails the boot
- `ADMIN_ACTOR`: the name stamped on audit rows, default `operator`
- `DEV_FAST_STOP=1`: SIGTERM stops at once instead of draining, so
  `tsx watch` restarts never wait on a live game
- `NODE_ENV=production`: with any `DEV_LOGIN` or `DEV_FAST_STOP` value set,
  boot fails
- `BACKUP_DIR`: nightly `VACUUM INTO` snapshots land here; unset, none are
  taken
- `BACKUP_KEEP` (default 14), `BACKUP_HOUR_UTC` (default 3): rotation and
  schedule

SIGTERM drains, unless `DEV_FAST_STOP=1`: new streams, games, and challenges
answer `503 paused`, live games get 120 s to end, and the rest end aborted and
unrated.
SIGINT stops at once.

## Deploying

`DEPLOY.md` covers the production image, compose stack, backup and
restore, and the operator checklist.

## Administration

The site has no admin role, route, or UI. The server process applies admin
operations itself, taken one JSON request per connection from a Unix socket
that only its own uid can open. In the container it lives on a private
tmpfs at `/run/hexo-arena/admin.sock`, and the `hexo-arena-admin` client
ships in the same image:

```sh
docker compose exec server hexo-arena-admin status
docker compose exec server hexo-arena-admin pause --reason "incident"
docker compose exec server hexo-arena-admin ban-user somebody --reason "cheating"
```

Outside Docker, `pnpm --filter @hexo-arena/server admin status` talks to a
local `pnpm dev`.

| op | effect |
|---|---|
| `status` | uptime, paused flag, live streams, active games, last 10 admin actions |
| `pause` / `resume` | new streams, games, and challenges answer `503` with `Retry-After`; open streams and live games run on; the flag survives restarts |
| `ban-user <name>` / `unban-user <name>` | sessions end, bots are closed and hidden, their tokens answer `403`; unban relists the bots and kills their old tokens |
| `delete-user <name>` | live games aborted, bots deleted under the bot policy, the user forgotten; rated history stays under a `deleted-<n>` placeholder |
| `delist-bot <name>` / `relist-bot <name>` | hidden from the directory and leaderboard, refused from challenges and games both ways; live play continues |
| `revoke-bot <name>` | token dead, stream closed; the owner mints a fresh one |
| `abort-game <gameId>` / `abort-game --bot <name>` | unrated abort of one game, or of every live game of a bot |
| `recompute-ratings [--exclude <gameId\|name>]...` | re-fold every rating, and the ratings around each game, from the game log; excluded games are voided for good |

Every mutation takes `--reason` and writes an audit row. Deleting a bot,
by its owner or through `delete-user`, keeps a bot that has a game with a
winner under a placeholder with its name still reserved, and deletes a bot
without one outright, freeing the name.

## Rules

HeXO is GPLv3; no HeXO code is copied into this repository. HeXO's rules
are reimplemented independently. Behavior was derived from HeXO's rules, its
observed behavior, and reading its source for reference, and is checked
against a local HeXO checkout used only as a test oracle.

HeXO Arena is not affiliated with the HeXO project.

## License

MIT, in `LICENSE`. The Chakra Petch font is under the SIL Open Font License
1.1; third-party notices are in `NOTICE`.
