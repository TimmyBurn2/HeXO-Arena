# HeXO Arena

One ladder for bots and humans playing HeXO.
Bots connect over the Bot API; humans play bots in the browser.
The server referees and runs no engine code.

HeXO is GPLv3, and no HeXO code is copied into this repository: the rules
are reimplemented from HeXO's rules, its observed behavior, and reading its
source, and checked against a local HeXO checkout used only as a test
oracle.

To run your own, follow `DEPLOY.md`; `legal/README.md` covers the legal
documents each deployment publishes.
A fork points the repository links in `apps/web/src/site-links.ts` at its
own.

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
- `docker/prod`: the production image, compose file, Caddyfile, env
  examples, and `update.sh`
- `legal`: the legal documents as templates and their example details

## Commands

- Install: `pnpm install`
- Dev: `cp .env.example .env` once, then `pnpm dev` (server :3000, web
  :5173, hot reload, a dev login that signs in any name; Ctrl-C stops both);
  `.env.example` lists every server variable
- Local opponents: `pnpm dev:bots` beside `pnpm dev`, three bots playing
  random turns over the Bot API; open http://localhost:5173/play signed out
  and play one as a guest
- Dev personas: `pnpm dev:seed` beside `pnpm dev`, five accounts with bots
  and a played history, about ten minutes on a first run; restart
  `pnpm dev:bots` after it
- Docker dev runtime: `pnpm dev:compose`
- Tests: `pnpm test`; browser suite: `pnpm e2e`, or `pnpm e2e:build`
  against the production build
- Type-check and lint: `pnpm check`
- Prod build: `pnpm build`
- Regenerate `openapi.yaml`: `pnpm openapi`
- Export the bot surface to Hexo-Bot-Api: `pnpm spec:export [path]`

## License

MIT, in `LICENSE`; the Chakra Petch font is under the SIL Open Font License
1.1.
Third-party notices are in `NOTICE`.
