import { devPersonas, type DevAccount } from '@hexo-arena/contract';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, ArenaClient } from './client';
import { hostBots, message, type HostedBot, type HostedFinish } from './host';
import { playHumanGame } from './human';
import { personaBots, type BotRun, type PersonaName, type SeedPlan } from './personas';
import { NotADevServer, saveTokens } from './runner';
import { seedDevDuels, type DevDuels, type DevDuelPlans } from './duels';
import { seedDevRoundRobins, type DevRoundRobinPlans, type DevRoundRobins } from './round-robins';
import { devWeeklyRule, seedDevTournament, type Candidate, type DevTournament, type DevWeeklyRule } from './tournament';

/** How the seed reaches its target, what it plays, and how it bans. */
export interface SeedOptions {
    origin: string;
    plan: SeedPlan;
    // Where the personas' online bots' tokens land, for pnpm dev:bots.
    tokenFile: string;
    // Bans a persona through the admin client; resolves when the persona is banned, newly or already.
    ban: (name: PersonaName) => Promise<void>;
    thinkMs: () => number;
    // A seeded human's pause before each turn.
    paceMs: number;
    random: () => number;
    log: (line: string) => void;
    // Schedules a tournament through the admin client and answers its id;
    // without it the seed schedules none.
    scheduleTournament?: (name: string, startsAt: Date) => Promise<string>;
    // Bots the dev tournament may take beside the personas' own.
    tournamentCandidates?: readonly Candidate[];
    // Adds a weekly tournament rule through the admin client;
    // resolves when the rule stands, newly or already.
    // Without it the seed adds none.
    addWeeklyRule?: (rule: DevWeeklyRule) => Promise<void>;
    // The duels to leave: one played out, one running, and a test played out; without them the seed starts none.
    duels?: DevDuelPlans;
    // The round robins to leave: one played out, a test played out, and one running; without them the seed sets none up.
    roundRobins?: DevRoundRobinPlans;
    now?: () => number;
}

/** What the seed left: the personas as they stand, the bots now ranked, and what this run played. */
export interface SeedReport {
    readonly accounts: readonly DevAccount[];
    readonly ranked: readonly string[];
    readonly played: number;
    // Runs a daily cap stopped short, with the cap's code.
    readonly capped: readonly string[];
    readonly tournament: DevTournament | null;
    readonly duels: DevDuels | null;
    readonly roundRobins: DevRoundRobins | null;
}

// A challenge waits on these and tries again; a daily cap ends its run.
const transient = new Set([`challenge_pending`, `bot_busy`, `inbox_full`, `not_open`]);
const dailyCaps = new Set([`daily_pair_cap`, `daily_bot_cap`, `daily_challenge_cap`]);

// How long one game may take before the seed gives up on it: the longest
// planned clock is a 3 min match a side.
const gameDeadlineMs = 10 * 60_000;

/**
 * Builds the personas over the real API: signs each in, claims and
 * declares their bots, plays their history up to the plan with the
 * personas' own bots held online, bans whom the plan bans, and leaves the
 * online bots' tokens for pnpm dev:bots.
 * Every step reads what already stands first, so a rerun adds only what
 * is missing.
 * Rejects with NotADevServer before touching anything when the target has
 * no dev routes.
 */
export async function seedDevData(options: SeedOptions): Promise<SeedReport> {
    const client = new ArenaClient(options.origin);
    const { log, plan } = options;
    let before: DevAccount[];
    try {
        before = await client.devAccounts();
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) throw new NotADevServer(`${options.origin} does not answer the dev routes`);
        throw error;
    }
    const standing = new Map(before.map((account) => [account.name, account]));

    // A banned persona's sign-in is refused, and so is anything it would play.
    const cookies = new Map<PersonaName, string>();
    const personas: readonly PersonaName[] = devPersonas.map((persona) => persona.name);
    for (const persona of personas) {
        try {
            cookies.set(persona, await client.devLogin(persona));
        } catch (error) {
            if (!(error instanceof ApiError && error.code === `banned`)) throw error;
            log(`${persona} is banned; nothing more to play`);
        }
    }

    // Each create or rotation spends the owner's bot management limit,
    // which a persona at the bot cap would run out of on a quick rerun:
    // a bot already held is rotated with no create tried first,
    // and an offline one, declared when made and connecting to nothing, is left alone.
    const online: HostedBot[] = [];
    for (const bot of personaBots) {
        const cookie = cookies.get(bot.owner);
        if (cookie === undefined) continue;
        const held = standing.get(bot.owner)?.bots.some((each) => each.name === bot.name) === true;
        if (held && !bot.online) continue;
        const token = held ? await client.rotateToken(cookie, bot.name) : await client.createBot(cookie, bot.name);
        if (bot.declaration !== null) await client.declare(token, bot.declaration);
        if (bot.online) online.push({ name: bot.name, strategy: bot.strategy, token });
    }

    const waiters = new Set<{ from: string; to: string; done: (finish: HostedFinish) => void }>();
    let opens = 0;
    let allOpen: () => void = () => undefined;
    const opened = new Promise<void>((resolve) => {
        allOpen = resolve;
        if (online.length === 0) resolve();
    });
    const host = hostBots(online, {
        client,
        thinkMs: options.thinkMs,
        random: options.random,
        log,
        reclaim: async (bot) => {
            const owner = personaBots.find((each) => each.name === bot.name)?.owner;
            const cookie = owner === undefined ? undefined : cookies.get(owner);
            if (cookie === undefined) throw new Error(`no owner signed in for ${bot.name}`);
            return client.claimBot(cookie, bot.name);
        },
        opened: () => {
            opens += 1;
            if (opens === online.length) allOpen();
        },
        finished: (bot, finish) => {
            for (const waiter of waiters) {
                if (waiter.from === bot.name && waiter.to === finish.opponent) {
                    waiters.delete(waiter);
                    waiter.done(finish);
                }
            }
        },
    });

    let played = 0;
    const capped: string[] = [];

    async function playHumans(persona: PersonaName): Promise<void> {
        const cookie = cookies.get(persona);
        const games = plan.humans[persona] ?? [];
        const done = standing.get(persona)?.games ?? 0;
        if (cookie === undefined) return;
        for (const game of games.slice(done)) {
            const result = await playHumanGame({ client, cookie, name: persona, game, random: options.random, paceMs: options.paceMs, log });
            played += 1;
            log(`${persona} finished ${result.gameId}: ${result.winner === null ? `no winner` : result.winner === result.you ? `won` : `lost`} (${result.reason})`);
        }
        if (plan.banned.includes(persona)) {
            await options.ban(persona);
            log(`${persona} banned through the admin client`);
        }
    }

    // One challenge at a time per run, so each finish belongs to the
    // challenge before it.
    async function playRun(run: BotRun): Promise<void> {
        const from = online.find((bot) => bot.name === run.from);
        if (from === undefined) return;
        const done = before.flatMap((account) => account.bots).find((bot) => bot.name === run.from)?.vsBots ?? 0;
        for (const game of run.games.slice(done)) {
            const finished = new Promise<HostedFinish>((resolve, reject) => {
                const waiter = { from: run.from, to: run.to, done: resolve };
                waiters.add(waiter);
                setTimeout(() => {
                    if (waiters.delete(waiter)) reject(new Error(`${run.from} against ${run.to} did not finish in time`));
                }, gameDeadlineMs).unref();
            });
            for (;;) {
                try {
                    await client.challenge(from.token, run.to, game.timeControl, randomUUID(), game.openingPlies);
                    break;
                } catch (error) {
                    if (error instanceof ApiError && error.code !== null && dailyCaps.has(error.code)) {
                        capped.push(`${run.from} against ${run.to}: ${error.code}`);
                        log(`${run.from} against ${run.to} stops at a daily cap: ${error.code}`);
                        return;
                    }
                    if (error instanceof ApiError && error.status === 429 && error.retryAfter !== null) {
                        await sleep(error.retryAfter * 1_000);
                    } else if (error instanceof ApiError && error.code !== null && transient.has(error.code)) {
                        await sleep(1_000);
                    } else {
                        throw error;
                    }
                }
            }
            await finished;
            played += 1;
        }
    }

    let duels: DevDuels | null = null;
    let roundRobins: DevRoundRobins | null = null;
    try {
        await opened;
        await Promise.all([...personas.map(playHumans), ...plan.runs.map(playRun)]);
        // While the personas' bots are still held online, so the played-out duels can finish.
        if (options.duels !== undefined) {
            duels = await seedDevDuels({
                client,
                plans: options.duels,
                cookieOf: async (person) => cookies.get(person) ?? (await client.devLogin(person)),
                log,
            });
        }
        if (options.roundRobins !== undefined) {
            roundRobins = await seedDevRoundRobins({
                client,
                plans: options.roundRobins,
                cookieOf: async (person) => cookies.get(person) ?? (await client.devLogin(person)),
                log,
            });
        }
    } catch (error) {
        log(`the seed stopped: ${message(error)}`);
        throw error;
    } finally {
        await host.stop();
        // Written last, so pnpm dev:bots never redials with a token the seed
        // is about to rotate.
        saveTokens(options.tokenFile, new Map(online.map((bot) => [bot.name, bot.token])));
    }

    // The personas' online bots first, one per owner, then the others offered;
    // a bot playing the live duel or round robin stays out, as the tournament's start would cut the duel short and take the bot out of the round robin.
    const live = duels?.live == null ? undefined : options.duels?.live;
    const liveField = roundRobins?.live == null ? [] : (options.roundRobins?.live.bots ?? []);
    const busy = new Set([...(live === undefined ? [] : [live.first, live.second]), ...liveField]);
    const candidates: Candidate[] = [];
    for (const bot of personaBots) {
        if (bot.online && cookies.has(bot.owner) && !busy.has(bot.name) && !candidates.some((candidate) => candidate.owner === bot.owner)) {
            candidates.push({ owner: bot.owner, bot: bot.name });
        }
    }
    const tournament =
        options.scheduleTournament === undefined
            ? null
            : await seedDevTournament({
                  client,
                  schedule: options.scheduleTournament,
                  candidates: [...candidates, ...(options.tournamentCandidates ?? []).filter((candidate) => !busy.has(candidate.bot))],
                  now: options.now ?? Date.now,
                  log,
              });

    if (options.addWeeklyRule !== undefined) {
        await options.addWeeklyRule(devWeeklyRule);
        log(`weekly rule: ${devWeeklyRule.namePattern}, ${devWeeklyRule.weekday} ${devWeeklyRule.time} UTC`);
    }

    const accounts = await client.devAccounts();
    const ranked = accounts.flatMap((account) => account.bots).filter((bot) => !bot.provisional).map((bot) => bot.name);
    return { accounts, ranked, played, capped, tournament, duels, roundRobins };
}
