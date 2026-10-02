import type { Accepts, TimeControl } from '@hexo-arena/contract';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { devAnalyzer } from './analyzer';
import { ApiError, ArenaClient } from './client';
import { hostBots, message, type HostedBot } from './host';
import { devLevels } from './levels';
import { personaBots } from './personas';

// The play dialog spans its turn slider over this window, so it stays in
// the range a person picks from: the 5 s floor to five minutes.
const devAccepts: Accepts = { turnMs: [5_000, 300_000], match: true, unlimited: true };

const about = `Plays random turns next to the stones; a local development opponent.`;

const challengeClock: TimeControl = { mode: `turn`, turnTimeMs: 20_000 };

// The one dev bot that also reads positions, so the analysis board has a reader.
const analyzerBot = `devbot-a`;

// An owner's bots may not challenge each other, so every bot gets an owner
// of its own.
/** The dev bots' seats: devbot-a, owned by devowner-a, and on. */
export const seats = [`a`, `b`, `c`] as const;

/** How the runner reaches its target and paces its bots. */
export interface DevBotsOptions {
    origin: string;
    count: number;
    tokenFile: string;
    // The tokens `pnpm dev:seed` left for the personas' online bots, if it has run.
    seedFile: string;
    challengeEveryMs: number;
    thinkMs: () => number;
    random: () => number;
    log: (line: string) => void;
}

/** The running bots; stop closes every stream and engine session. */
export interface DevBots {
    readonly names: readonly string[];
    stop(): Promise<void>;
}

/** The target answered 404 on the dev login route, so it is not a dev server. */
export class NotADevServer extends Error {}

function isDailyCap(error: unknown): boolean {
    return error instanceof ApiError && (error.code === `daily_pair_cap` || error.code === `daily_bot_cap` || error.code === `daily_challenge_cap`);
}

const tokensSchema = z.record(z.string(), z.string());

/** Writes a name-to-token map where only its owner reads it. */
export function saveTokens(file: string, tokens: ReadonlyMap<string, string>): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(tokens), null, 4)}\n`);
    chmodSync(file, 0o600);
}

/** The name-to-token map a file holds, empty when there is none. */
export function loadTokens(file: string): Map<string, string> {
    if (!existsSync(file)) return new Map();
    return new Map(Object.entries(tokensSchema.parse(JSON.parse(readFileSync(file, `utf8`)))));
}

/**
 * Signs in one dev owner per bot, claims its bot with a fresh token, holds
 * every stream open for challenges, plays every game it is dealt, and has
 * the bots challenge each other on an interval until a daily cap refuses.
 * The personas' online bots join from the seed's file when it exists; they
 * take challenges and play, and never challenge.
 * Rejects with NotADevServer before touching anything when the target has
 * no dev login route.
 */
export async function startDevBots(options: DevBotsOptions): Promise<DevBots> {
    const client = new ArenaClient(options.origin);
    const { log } = options;
    const owners = new Map<string, string>();
    const tokens = new Map<string, string>();

    // The dev login route exists only under DEV_LOGIN=1, which production
    // refuses to boot with, so answering it proves the target is a dev
    // server before any bot is created.
    async function claim(owner: string, name: string): Promise<string> {
        let cookie: string;
        try {
            cookie = await client.devLogin(owner);
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                throw new NotADevServer(`${options.origin} does not answer the dev login route`);
            }
            throw error;
        }
        const token = await client.claimBot(cookie, name);
        await client.declare(token, { accepts: devAccepts, about, levels: devLevels, analyzer: name === analyzerBot ? devAnalyzer : null });
        return token;
    }

    const devBots: HostedBot[] = [];
    for (const seat of seats.slice(0, options.count)) {
        const name = `devbot-${seat}`;
        owners.set(name, `devowner-${seat}`);
        const token = await claim(`devowner-${seat}`, name);
        tokens.set(name, token);
        devBots.push({ name, strategy: `random`, levels: devLevels, ...(name === analyzerBot ? { analyzer: devAnalyzer } : {}), token });
    }
    saveTokens(options.tokenFile, tokens);

    // The seed owns its bots' tokens: a refused one is read again from its
    // file, which holds a fresh one once a rerun of the seed is done.
    const seeded = loadTokens(options.seedFile);
    const personas: HostedBot[] = personaBots.flatMap((bot) => {
        const token = seeded.get(bot.name);
        return bot.online && token !== undefined ? [{ name: bot.name, strategy: bot.strategy, token }] : [];
    });

    const pairs = devBots.flatMap((first, index) => devBots.slice(index + 1).map((second) => [first, second] as const));
    const cappedOn = new Map<string, string>();
    let firstOpens = 0;
    let next = 0;
    let stopped = false;
    // A rate limit's refusal names its wait, which every challenge sits out.
    let restUntil = 0;

    // One challenge per tick, rotating over the pairs; a pair a daily cap
    // refused rests until the UTC day turns, as the server counts.
    async function challengeOnce(): Promise<void> {
        if (Date.now() < restUntil) return;
        const today = new Date().toISOString().slice(0, 10);
        for (let tried = 0; tried < pairs.length; tried += 1) {
            const pair = pairs[next % pairs.length];
            next += 1;
            if (pair === undefined || stopped) return;
            const key = `${pair[0].name} and ${pair[1].name}`;
            if (cappedOn.get(key) === today) continue;
            const [from, to] = options.random() < 0.5 ? pair : [pair[1], pair[0]];
            try {
                await client.challenge(from.token, to.name, challengeClock, randomUUID());
            } catch (error) {
                if (isDailyCap(error)) {
                    cappedOn.set(key, today);
                    log(`${key} reached a daily cap and rest until 00:00 UTC`);
                    continue;
                }
                if (error instanceof ApiError && error.status === 429 && error.retryAfter !== null) {
                    restUntil = Date.now() + error.retryAfter * 1000;
                    log(`challenges rest ${String(error.retryAfter)} s: ${message(error)}`);
                    return;
                }
                log(`${from.name} could not challenge ${to.name}: ${message(error)}`);
            }
            return;
        }
    }

    const host = hostBots([...devBots, ...personas], {
        client,
        thinkMs: options.thinkMs,
        random: options.random,
        log,
        reclaim: async (bot) => {
            const owner = owners.get(bot.name);
            if (owner === undefined) {
                const fresh = loadTokens(options.seedFile).get(bot.name);
                if (fresh === undefined || fresh === bot.token) throw new Error(`no fresh token in ${options.seedFile}; run pnpm dev:seed`);
                return fresh;
            }
            const token = await claim(owner, bot.name);
            tokens.set(bot.name, token);
            saveTokens(options.tokenFile, tokens);
            return token;
        },
        opened: (bot) => {
            if (!devBots.includes(bot)) return;
            firstOpens += 1;
            if (firstOpens === devBots.length) void challengeOnce();
        },
    });

    const ticker = setInterval(() => {
        void challengeOnce();
    }, options.challengeEveryMs);

    return {
        names: [...devBots, ...personas].map((bot) => bot.name),
        stop: async () => {
            stopped = true;
            clearInterval(ticker);
            await host.stop();
        },
    };
}
