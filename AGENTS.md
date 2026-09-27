# AGENTS.md

Rules for every coding agent working in this repo.

Local decision docs (`SPEC.md`, `STACK.md`, `ADMIN.md`, untracked by design)
record choices in depth; read them when present and follow them. The rules
below hold regardless.

Layout: pnpm monorepo. `apps/server` (Fastify), `apps/web` (React/Vite SPA),
`packages/contract` (zod schemas, board types), `packages/rules` (pure rules
engine, no runtime dependencies). Nested `AGENTS.md` files may appear
per package later; the nearest one wins.

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev` (server :3000, web :5173, hot reload; Ctrl-C stops both)
- Local opponents: `pnpm dev:bots` beside `pnpm dev` (three bots over the
  bot API)
- Docker dev runtime: `pnpm dev:compose` (operator-run; containers are not
  verified by day-to-day dev)
- Tests: `pnpm test`
- Browser suite: `pnpm e2e` (Playwright against Vite with the API mocked;
  every screen in every look and viewport, contrast, motion, six-key play;
  screenshots land in `apps/web/e2e/shots`)
- Prod build: `pnpm build` (bundled server and admin CLI in `apps/server/dist`,
  static site in `apps/web/dist`)
- Type-check + lint: `pnpm check`
- Regenerate `openapi.yaml`: `pnpm openapi`
- Export the bot surface to Hexo-Bot-Api: `pnpm spec:export [path]` (default
  `../Hexo-Bot-Api`; writes its `openapi.yaml` and `examples/stream.ndjson`)

Every task ends green: type-check, lint, tests.
`openapi.yaml` is generated from `packages/contract`; never hand-edit it.

## Code style

- One sentence per line in comments and docs; wrap at semantic breaks (`; , : .`).
- Comments explain why: constraints, invariants, non-obvious decisions. Never what.
- If code needs a what-comment, rename or restructure until it doesn't.
- Doc comments (TSDoc) on exported symbols only; internals carry none.
- No phase, milestone, or step comments; no section banners; no narration of
  process or history. Comments describe the code as it is; history is git's job.
- No comment may restate the line below it.
- Committed files never reference the local decision docs, their sections,
  slices, phases, or any planning language. Comments stand on their own;
  process and planning live outside the repo.
- ASCII only, in code, comments, docs, and commit messages. No em dashes, no
  decorative unicode; use `; , :` or a new sentence instead.
- Prose is lean: if a sentence can be shorter, make it shorter; if a paragraph
  adds nothing, delete it. Reread before committing.
- Named exports only. 4-space indent, backtick strings, semicolons, trailing commas.

## Language standards (strict)

- TypeScript `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`.
- No `any`; use `unknown` and narrow. An `as` cast carries a one-line comment
  stating the invariant that makes it sound.
- Discriminated unions over boolean flags; exhaustiveness checked against `never`.
- Zod parses every boundary: HTTP, websocket, admin socket, env.
- ESLint with typescript-eslint strict-type-checked and eslint-plugin-tsdoc;
  lint runs in CI and must stay running. A broken lint config is a bug, not an
  excuse to skip linting.
- SQL: constraints live in the schema (`NOT NULL`, `CHECK`, foreign keys), never
  in app code; `PRAGMA foreign_keys = ON`; every foreign key indexed; `nameKey`
  unique.
- Tests: Vitest, colocated, test names are sentences; no snapshot tests;
  the rules engine keeps its differential tests against HeXO as the oracle.

## Hard guardrails

- Spec-first: `packages/contract` zod is the source of truth; `openapi.yaml` is
  generated and diffed in CI.
- No HeXO code may be copied into this repo. GPLv3, clean-room rules
  (SPEC.md section 11).
- The server executes no engine code and makes no outbound calls except Discord
  OAuth.
- Never weaken: the egress allowlist, token hashing, one-stream-per-bot, the
  numeric rate limits, the deploy-drain rule, route-pattern logging (no URL,
  query, body, or client address in a log line).
- Committed files, examples, and generated documents write a placeholder such
  as `<domain>` wherever a deployment's domain or anything identifying the
  operator would go; the real values never land in a commit.
- The vendored htttx schemas are immutable: verbatim from the htttx spec.
  Deviation only when unavoidable, kept local, with a written reason in the
  decision log. `Hexo-Bot-Api` changes only when a contract change is
  genuinely needed.

## Commits

- Conventional one-liners, subject only: `feat(admin): pause kill switch`.
- One concern per commit, atomic: the commit builds, tests, and lints on its
  own; a change and its test land together; fix or churn gets squashed away
  before review, never committed as separate iterations.
- Every commit message ASCII, lowercase subject, no body, no trailers.
