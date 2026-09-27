import type { Accepts, StreamEvent, TimeControl } from '@hexo-arena/contract';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, ArenaClient } from './client';
import { playGame, type EngineSession } from './player';

// The play dialog spans its turn slider over this window, so it stays in
// the range a person picks from: the 5 s floor to five minutes.
const devAccepts: Accepts = { turnMs: [5_000, 300_000], match: true, unlimited: true };

const about = `Plays random turns next to the stones; a local development opponent.`;

const challengeClock: TimeControl = { mode: `turn`, turnTimeMs: 20_000 };

const streamRetryMs = 2_000;

// An owner's bots may not challenge each other, so every bot gets an owner
// of its own.
const seats = [`a`, `b`, `c`] as const;

/** How the runner reaches its target and paces its bots. */
export interface DevBotsOptions {
    origin: string;
    count: number;
    tokenFile: string;
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

interface Bot {
    readonly name: string;
    readonly owner: string;
    token: string;
    readonly sessions: Map<string, EngineSession>;
}

// fetch reports a dropped connection as `terminated`, with the reason in
// the cause.
function message(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

function isDailyCap(error: unknown): boolean {
    return error instanceof ApiError && (error.code === `daily_pair_cap` || error.code === `daily_bot_cap`);
}

// Kept so a developer can drive a dev bot by hand; the file sits in the
// gitignored data directory beside the database the tokens belong to.
function saveTokens(file: string, bots: readonly Bot[]): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(Object.fromEntries(bots.map((bot) => [bot.name, bot.token])), null, 4)}\n`);
    chmodSync(file, 0o600);
}

function describeFinish(event: Extract<StreamEvent, { type: `gameFinish` }>): string {
    return event.winner === null ? `no winner (${event.reason})` : `${event.winner} won (${event.reason})`;
}

/**
 * Signs in one dev owner per bot, claims its bot with a fresh token, holds
 * every stream open for challenges, plays every game it is dealt, and has
 * the bots challenge each other on an interval until a daily cap refuses.
 * Rejects with NotADevServer before touching anything when the target has
 * no dev login route.
 */
export async function startDevBots(options: DevBotsOptions): Promise<DevBots> {
    const client = new ArenaClient(options.origin);
    const { log } = options;
    const controller = new AbortController();
    // A function, not a read: narrowing would pin the flag across awaits.
    const stopped = (): boolean => controller.signal.aborted;
    const bots: Bot[] = [];

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
        await client.declare(token, devAccepts, about);
        return token;
    }

    for (const seat of seats.slice(0, options.count)) {
        const owner = `devowner-${seat}`;
        const name = `devbot-${seat}`;
        bots.push({ name, owner, token: await claim(owner, name), sessions: new Map() });
    }
    saveTokens(options.tokenFile, bots);

    function onEvent(bot: Bot, event: StreamEvent): void {
        switch (event.type) {
            case `gameStart`: {
                // A replayed start carries a fresh token, and the fresh dial
                // replaces the stale session on the server as well.
                bot.sessions.get(event.gameId)?.close();
                // A restart can end a game with no gameFinish, so a session
                // leaves the map when its socket closes.
                const session = playGame({
                    url: client.engineUrl(event.engine.socketUrl, event.engine.token),
                    random: options.random,
                    thinkMs: options.thinkMs,
                    log: (line) => {
                        log(`${bot.name} ${event.gameId}: ${line}`);
                    },
                    closed: () => {
                        if (bot.sessions.get(event.gameId) === session) bot.sessions.delete(event.gameId);
                    },
                });
                bot.sessions.set(event.gameId, session);
                log(`${bot.name} plays ${event.opponent.name} as ${event.side} in ${event.gameId}`);
                return;
            }
            case `gameFinish`:
                bot.sessions.get(event.gameId)?.close();
                bot.sessions.delete(event.gameId);
                log(`${bot.name} finished ${event.gameId}: ${describeFinish(event)}`);
                return;
            case `challenge`:
                client.accept(bot.token, event.challenge.challengeId).catch((error: unknown) => {
                    log(`${bot.name} could not accept ${event.challenge.challenger.name}: ${message(error)}`);
                });
                return;
            // A replayed moveRequest needs nothing, since the fresh engine
            // session after a replayed start receives the outstanding request
            // itself; withdrawn and declined challenges need nothing either.
            case `moveRequest`:
            case `challengeCanceled`:
            case `challengeDeclined`:
                return;
            default: {
                const unknown: never = event;
                return unknown;
            }
        }
    }

    // Answers null once the bot holds a fresh token, or why it could not.
    async function reclaim(bot: Bot): Promise<unknown> {
        try {
            bot.token = await claim(bot.owner, bot.name);
            saveTokens(options.tokenFile, bots);
            return null;
        } catch (error) {
            return error;
        }
    }

    // A server restart ends every stream; the bot redials until stopped,
    // and a dead token (a wiped database, a revoke) is claimed afresh.
    async function hold(bot: Bot, opened: () => void): Promise<void> {
        let down = false;
        while (!stopped()) {
            try {
                await client.stream(
                    bot.token,
                    {
                        opened: () => {
                            if (down) log(`${bot.name} is back online`);
                            down = false;
                            opened();
                        },
                        event: (event) => {
                            onEvent(bot, event);
                        },
                    },
                    controller.signal,
                );
            } catch (error) {
                if (stopped()) return;
                const failure = error instanceof ApiError && error.status === 401 ? await reclaim(bot) : error;
                if (failure === null) continue;
                if (!down) log(`${bot.name} is offline: ${message(failure)}; retrying every ${String(streamRetryMs / 1000)} s`);
                down = true;
            }
            await sleep(streamRetryMs, undefined, { signal: controller.signal }).catch(() => undefined);
        }
    }

    const pairs = bots.flatMap((first, index) => bots.slice(index + 1).map((second) => [first, second] as const));
    const cappedOn = new Map<string, string>();
    let next = 0;

    // One challenge per tick, rotating over the pairs; a pair a daily cap
    // refused rests until the UTC day turns, as the server counts.
    async function challengeOnce(): Promise<void> {
        const today = new Date().toISOString().slice(0, 10);
        for (let tried = 0; tried < pairs.length; tried += 1) {
            const pair = pairs[next % pairs.length];
            next += 1;
            if (pair === undefined || stopped()) return;
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
                log(`${from.name} could not challenge ${to.name}: ${message(error)}`);
            }
            return;
        }
    }

    let firstOpens = 0;
    const holds = bots.map((bot) => {
        let counted = false;
        return hold(bot, () => {
            if (counted) return;
            counted = true;
            firstOpens += 1;
            if (firstOpens === bots.length) void challengeOnce();
        });
    });
    const ticker = setInterval(() => {
        void challengeOnce();
    }, options.challengeEveryMs);

    return {
        names: bots.map((bot) => bot.name),
        stop: async () => {
            controller.abort();
            clearInterval(ticker);
            for (const bot of bots) {
                for (const session of bot.sessions.values()) session.close();
                bot.sessions.clear();
            }
            await Promise.allSettled(holds);
        },
    };
}
