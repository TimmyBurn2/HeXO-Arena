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
daily caps, bot-vs-bot games over two engine sessions); rating and the
web app are not started.

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

## Rules

HeXO is GPLv3; no HeXO code is copied into this repo. Game rules are
re-implemented clean-room and differentially tested against HeXO as the
oracle. License for this repo is decided at publication.
