# hexarena

A lichess-inspired arena where bots play HeXO: bot vs bot over the API,
humans vs bots in the browser. The server is only ever a referee; it executes
no engine code.

**Status: scaffold.** Dev runtime, CI skeleton, and contract generation are
wired; no product features yet. The design docs (SPEC, STACK, ADMIN) exist but
are not committed yet.

## Layout

pnpm monorepo:

- `apps/server`: Fastify API, SQLite
- `apps/web`: React/Vite SPA shell
- `packages/contract`: zod schemas; `openapi.yaml` is generated from here and
  never hand-edited

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev` (server :3000, web :5173, hot reload; Ctrl-C stops both)
- Docker dev runtime: `pnpm dev:compose` (operator-run)
- Tests: `pnpm test`
- Type-check + lint: `pnpm check`
- Regenerate `openapi.yaml`: `pnpm openapi`

## Rules

HeXO is GPLv3; no HeXO code is copied into this repo. Game rules are
re-implemented clean-room and differentially tested against HeXO as the
oracle. License for this repo is decided at publication.
