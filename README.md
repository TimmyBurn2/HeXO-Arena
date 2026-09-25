# hexarena

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

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev` (server :3000, web :5173, hot reload; Ctrl-C stops both)
- Docker dev runtime: `pnpm dev:compose` (operator-run)
- Tests: `pnpm test`
- Prod build: `pnpm build`
- Type-check + lint: `pnpm check`
- Regenerate `openapi.yaml`: `pnpm openapi`

## Server environment

- `HOST`, `PORT`, `DATABASE_PATH`: bind and sqlite location
- `PUBLIC_ORIGIN`: site origin; builds the OAuth redirect uri and decides the
  session cookie's `Secure` flag
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`: with both set, Discord login is
  live; otherwise the auth routes answer `503`
- `DEV_LOGIN=1`: registers `POST /api/dev/login`, which creates a synthetic
  Discord identity by chosen name for local development; with the flag unset
  the route does not exist
- `ADMIN_SOCKET_PATH`: the admin socket, default `data/run/admin.sock`; its
  directory must be mode 0700 and owned by the server's uid, or boot fails
- `ADMIN_ACTOR`: the name stamped on audit rows, default `operator`
- `NODE_ENV=production`: with any `DEV_LOGIN` value set, boot fails
- `BACKUP_DIR`: nightly `VACUUM INTO` snapshots land here; unset, none are
  taken
- `BACKUP_KEEP` (default 14), `BACKUP_HOUR_UTC` (default 3): rotation and
  schedule

SIGTERM drains: new streams, games, and challenges answer `503 paused`, live
games get 120 s to end, and the rest end aborted and unrated.
SIGINT stops at once.

## Deploying

`DEPLOY.md` covers the production image, compose stack, backup and
restore, and the operator checklist.

## Administration

The site has no admin role, route, or UI. The server process applies admin
operations itself, taken one JSON request per connection from a Unix socket
that only its own uid can open. In the container it lives on a private
tmpfs at `/run/hexarena/admin.sock`, and the `hexarena-admin` client ships in
the same image:

```sh
docker compose exec server hexarena-admin status
docker compose exec server hexarena-admin pause --reason "incident"
docker compose exec server hexarena-admin ban-user somebody --reason "cheating"
```

Outside Docker, `pnpm --filter @hexarena/server admin status` talks to a
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
| `recompute-ratings [--exclude <gameId\|name>]...` | re-fold every rating from the game log; excluded games are voided for good |

Every mutation takes `--reason` and writes an audit row. Deleting a bot,
by its owner or through `delete-user`, keeps a bot with rated games under a
placeholder with its name still reserved, and deletes a bot without them
outright, freeing the name.

## Rules

HeXO is GPLv3; no HeXO code is copied into this repo. Game rules are
re-implemented clean-room and differentially tested against HeXO as the
oracle. License for this repo is decided at publication.
