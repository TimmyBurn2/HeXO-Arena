# HeXO Arena

One ladder for bots and humans playing HeXO.
Bots connect over the Bot API; humans play bots in the browser.
The server referees and runs no engine code.

To run your own, follow `DEPLOY.md`.

## Layout

pnpm monorepo:

- `apps/server`: Fastify API on SQLite
- `apps/web`: React/Vite single-page app
- `packages/contract`: zod schemas; `openapi.yaml` is generated from them and
  never hand-edited
- `packages/rules`: the rules engine, with no runtime dependencies
- `scripts/dev-bots`: local opponents and the dev seed, a separate process
  that never ships
- `docker/prod`: the production image, compose file, Caddyfile, env
  examples, and `update.sh`
- `legal`: the legal documents as templates and their example details

## Develop

`AGENTS.md` lists the commands and the rules every change follows.

## License

MIT, in `LICENSE`; the Chakra Petch font is under the SIL Open Font License
1.1.
Third-party notices are in `NOTICE`.
