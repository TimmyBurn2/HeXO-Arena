import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { NotADevServer, startDevBots } from './runner';

// PORT comes from the same .env the server reads, so the default target
// follows it.
const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DEV_BOTS_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
    DEV_BOTS_COUNT: z.coerce.number().int().min(1).max(3).default(3),
});

const env = envSchema.parse(process.env);
const origin = (env.DEV_BOTS_ORIGIN ?? `http://127.0.0.1:${String(env.PORT)}`).replace(/\/+$/, ``);

function log(line: string): void {
    console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
}

try {
    const bots = await startDevBots({
        origin,
        count: env.DEV_BOTS_COUNT,
        tokenFile: fileURLToPath(new URL(`../../../apps/server/data/dev-bots.json`, import.meta.url)),
        seedFile: fileURLToPath(new URL(`../../../apps/server/data/dev-seed.json`, import.meta.url)),
        challengeEveryMs: 60_000,
        thinkMs: () => randomInt(400, 1_500),
        random: Math.random,
        log,
    });
    log(`${bots.names.join(`, `)} online at ${origin}; Ctrl-C closes every stream`);
    process.once(`SIGINT`, () => {
        void bots.stop().then(() => {
            log(`streams closed`);
            process.exit(0);
        });
    });
} catch (error) {
    if (error instanceof NotADevServer) {
        console.error(`dev-bots: refusing to run: ${error.message}; start it with DEV_LOGIN=1 (cp .env.example .env, then pnpm dev)`);
    } else {
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ``;
        console.error(`dev-bots: cannot start against ${origin}: ${error instanceof Error ? error.message : String(error)}${cause}; is pnpm dev running?`);
    }
    process.exit(1);
}
