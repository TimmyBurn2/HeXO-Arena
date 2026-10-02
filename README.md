# HeXO Arena

One ladder for bots and humans playing HeXO.
Bots connect over the Bot API; humans play bots in the browser.
The server referees and runs no engine code.

## Layout

pnpm monorepo:

- `apps/server`: Fastify API on SQLite
- `apps/web`: React/Vite single-page app
- `packages/contract`: zod schemas; `openapi.yaml` is generated from them and
  never hand-edited
- `packages/rules`: the rules engine, with no runtime dependencies; tested
  against a committed HeXO corpus, and live against a sibling HeXO checkout
  when one exists
- `scripts/dev-bots`: local opponents and the dev seed, a separate process
  that never ships
- `legal`: the legal documents as templates and their example details; each
  deployment serves its own copy

## Commands

- Install: `pnpm install`
- Dev: `cp .env.example .env` once, then `pnpm dev` (server :3000, web
  :5173, hot reload; Ctrl-C stops both)
- Local opponents: `pnpm dev:bots` beside `pnpm dev`
- Dev personas: `pnpm dev:seed` beside `pnpm dev`
- Docker dev runtime: `pnpm dev:compose`
- Tests: `pnpm test`; browser suite: `pnpm e2e`
- Type-check and lint: `pnpm check`
- Prod build: `pnpm build`
- Regenerate `openapi.yaml`: `pnpm openapi`
- Export the bot surface to Hexo-Bot-Api: `pnpm spec:export [path]`

## Local opponents

The site runs no bots of its own.
`pnpm dev:bots` runs three over the same Bot API as any other bot:

1. `pnpm dev`
2. `pnpm dev:bots` in a second terminal
3. open http://localhost:5173/play signed out, pick a `devbot`, and play as
   a guest

It signs in `devowner-a` to `devowner-c` through the dev login, one owner per
bot since an owner's bots never challenge each other, and claims `devbot-a`
to `devbot-c` with fresh tokens kept in `apps/server/data/dev-bots.json`.
A server without the dev login is refused.
The bots play random turns next to the stones, accept turn clocks from 5 s to
5 min and every match and unlimited clock, and challenge each other once a
minute until a daily cap refuses.
`DEV_BOTS_ORIGIN` (default `http://127.0.0.1:$PORT`) and `DEV_BOTS_COUNT`
(1 to 3, default 3) adjust it.

## Dev personas

`pnpm dev:seed` builds five accounts over the API, each showing one state:

- `ana`, at the bot cap: `hextide` (extends its longest line), `pebble`
  (random turns), and `lantern` (never connects), plus four rated games as a
  human
- `bruno`, about ten rated games and no bots
- `cleo`, brand new
- `dmitri` with `quietlake`, provisional
- `eve`, banned after two games

It plays the history itself, inside the daily caps and the creation
cooldown, so a first run takes about ten minutes; a rerun plays only what is
missing.
Once it has run, `pnpm dev:bots` also brings `hextide`, `pebble`, and
`quietlake` online from `apps/server/data/dev-seed.json`; restart it after
the first seed.
The seed ends by scheduling the dev tournament three minutes out, unless one
runs or waits, and enters one bot per owner with games left today: the
personas' online bots, then the dev bots.

The dev pill at the bottom left of framed screens signs in as a persona, any
name, a first sign-in, or a guest; in dev the Discord button opens the same
panel.
It loads only in the dev server's bundle, when `GET /api/dev/accounts`
answers.

## Server environment

`.env.example` lists every variable with its development value.
The server and the admin client load `.env` when it exists; production uses
the env files in `DEPLOY.md`.

- `DEV_LOGIN=1` registers `POST /api/dev/login`, which signs in any name
  without Discord, or, given
  `{"discord": {"username": "mira.hex", "displayName": "Mira"}}`, acts as a
  first Discord sign-in, on to `/welcome`; and `GET /api/dev/accounts`, the
  seeded personas.
- The admin socket's directory must be mode 0700 and owned by the server's
  uid, or boot fails.
  Boot replaces a socket left by an unclean stop, and fails on a socket
  another server answers or on any other file at the path.
- With `NODE_ENV=production`, any `DEV_LOGIN` or `DEV_FAST_STOP` value fails
  the boot.

SIGTERM drains, unless `DEV_FAST_STOP=1`: new streams, games, and challenges
answer `503 paused`, live games get 120 s, and the rest end aborted and
unrated.
SIGINT stops at once.

## Deploying and administration

`DEPLOY.md` covers the production stack, backups, the admin operations, and
the operator checklist.
`legal/README.md` covers the legal documents each deployment publishes: what
to copy where, what to fill in, and which are required where.

## Rules

HeXO is GPLv3; no HeXO code is copied into this repository.
The rules are reimplemented from HeXO's rules, its observed behavior, and
reading its source, and checked against a local HeXO checkout used only as a
test oracle.

## License

MIT, in `LICENSE`; the Chakra Petch font is under the SIL Open Font License
1.1.
Third-party notices are in `NOTICE`.
