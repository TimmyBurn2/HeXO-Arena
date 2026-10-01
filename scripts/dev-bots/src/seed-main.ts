import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { seedPlan } from './personas';
import { NotADevServer } from './runner';
import { seedDevData } from './seed';

const envSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DEV_BOTS_ORIGIN: z.url({ protocol: /^https?$/ }).optional(),
});

const env = envSchema.parse(process.env);
const origin = (env.DEV_BOTS_ORIGIN ?? `http://127.0.0.1:${String(env.PORT)}`).replace(/\/+$/, ``);
const repoRoot = fileURLToPath(new URL(`../../../`, import.meta.url));
const run = promisify(execFile);

function log(line: string): void {
    console.log(`${new Date().toTimeString().slice(0, 8)} ${line}`);
}

// The admin client answers `unchanged` with exit status 1 for a persona a
// rerun finds banned already, which is the state the seed wants.
async function ban(name: string): Promise<void> {
    const args = [`--silent`, `--filter`, `@hexo-arena/server`, `admin`, `ban-user`, name, `--reason`, `dev seed persona`];
    try {
        await run(`pnpm`, args, { cwd: repoRoot });
    } catch (error) {
        const output = error instanceof Error && `stderr` in error ? String(error.stderr) : ``;
        if (!output.includes(`unchanged`)) throw error;
    }
}

try {
    log(`seeding ${origin}; the humans keep the creation cooldown, so this takes about ten minutes`);
    const report = await seedDevData({
        origin,
        plan: seedPlan,
        tokenFile: fileURLToPath(new URL(`../../../apps/server/data/dev-seed.json`, import.meta.url)),
        ban,
        thinkMs: () => randomInt(0, 200),
        paceMs: 500,
        random: Math.random,
        log,
    });
    log(`played ${String(report.played)} games`);
    for (const account of report.accounts) {
        const rating = `${String(account.rating)}${account.provisional ? `?` : ``}`;
        const bots = account.bots.length === 1 ? `1 bot` : `${String(account.bots.length)} bots`;
        log(`${account.name}: ${rating}, ${String(account.games)} games as a human, ${bots}${account.banned ? `, banned` : ``}`);
        for (const bot of account.bots) {
            log(`  ${bot.name}: ${String(bot.rating)}${bot.provisional ? `?` : ``}, ${String(bot.vsBots)} games against bots`);
        }
    }
    for (const line of report.capped) log(`stopped by a daily cap: ${line}`);
    log(`ranked: ${report.ranked.length === 0 ? `none` : report.ranked.join(`, `)}`);
    log(`restart pnpm dev:bots to bring the personas' online bots up`);
} catch (error) {
    if (error instanceof NotADevServer) {
        console.error(`dev-seed: refusing to run: ${error.message}; start it with DEV_LOGIN=1 (cp .env.example .env, then pnpm dev)`);
    } else {
        const cause = error instanceof Error && error.cause instanceof Error ? `: ${error.cause.message}` : ``;
        console.error(`dev-seed: cannot seed ${origin}: ${error instanceof Error ? error.message : String(error)}${cause}; is pnpm dev running?`);
    }
    process.exit(1);
}
