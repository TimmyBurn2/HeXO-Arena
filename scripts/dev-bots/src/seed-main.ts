import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { z } from 'zod';
import { seedPlan } from './personas';
import { NotADevServer, seats } from './runner';
import { seedDevData } from './seed';
import { devDuelPlans } from './duels';
import type { DevWeeklyRule } from './tournament';

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

// The admin client answers `unchanged` with exit status 1 when a rerun
// finds what the op would make already standing, which is the state the
// seed wants.
async function adminSettles(args: readonly string[]): Promise<void> {
    try {
        await run(`pnpm`, [`--silent`, `--filter`, `@hexo-arena/server`, `admin`, ...args], { cwd: repoRoot });
    } catch (error) {
        const output = error instanceof Error && `stderr` in error ? String(error.stderr) : ``;
        if (!output.includes(`unchanged`)) throw error;
    }
}

async function ban(name: string): Promise<void> {
    await adminSettles([`ban-user`, name, `--reason`, `dev seed persona`]);
}

async function addWeeklyRule(rule: DevWeeklyRule): Promise<void> {
    await adminSettles([
        `tournament-schedule`,
        `add`,
        `--weekday`,
        rule.weekday,
        `--time`,
        rule.time,
        `--name`,
        rule.namePattern,
        `--clock`,
        rule.clock,
        `--opening`,
        String(rule.openingPlies),
        `--max`,
        String(rule.maxEntrants),
        `--ahead`,
        String(rule.daysAhead),
        `--reason`,
        `dev seed weekly rule`,
    ]);
}

// The admin client schedules the tournament; its answer names the id.
async function scheduleTournament(name: string, startsAt: Date): Promise<string> {
    const args = [`--silent`, `--filter`, `@hexo-arena/server`, `admin`, `tournament-create`, `--name`, name, `--start`, startsAt.toISOString(), `--clock`, `turn:10`, `--opening`, `5`, `--reason`, `dev seed tournament`];
    const { stdout } = await run(`pnpm`, args, { cwd: repoRoot });
    const id = / as (t_[a-z0-9]{12})/.exec(stdout)?.[1];
    if (id === undefined) throw new Error(`the admin client scheduled no tournament: ${stdout}`);
    return id;
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
        scheduleTournament,
        addWeeklyRule,
        duels: devDuelPlans,
        tournamentCandidates: seats.map((seat) => ({ owner: `devowner-${seat}`, bot: `devbot-${seat}` })),
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
    if (report.tournament !== null) {
        log(`dev tournament ${report.tournament.id}, entered: ${report.tournament.entered.join(`, `) || `none`}`);
    }
    if (report.duels !== null) {
        log(`finished duel: ${report.duels.finished ?? `none`}; test: ${report.duels.test ?? `none`}; live duel: ${report.duels.live ?? `none, start pnpm dev:bots and seed again`}`);
    }
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
