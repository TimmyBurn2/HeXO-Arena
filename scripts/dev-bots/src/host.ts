import type { FinishReason, Levels, Side, StreamEvent } from '@hexo-arena/contract';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, type ArenaClient } from './client';
import { paceAt } from './levels';
import { playGame, type EngineSession, type Strategy } from './player';

const streamRetryMs = 2_000;

/** A bot held online: its stream open for challenges, each game it is dealt played by its strategy, at the level it names when it declares levels. */
export interface HostedBot {
    readonly name: string;
    readonly strategy: Strategy;
    readonly levels?: Levels;
    token: string;
}

/** A game a hosted bot finished, as its stream reported it. */
export interface HostedFinish {
    readonly gameId: string;
    readonly opponent: string | null;
    readonly side: Side | null;
    readonly winner: Side | null;
    readonly reason: FinishReason;
}

/** How the host reaches its target, paces its bots, and reports. */
export interface HostOptions {
    client: ArenaClient;
    thinkMs: () => number;
    random: () => number;
    log: (line: string) => void;
    // A fresh token for a bot whose token the server refused; a rejection
    // leaves the bot offline until the next try.
    reclaim: (bot: HostedBot) => Promise<string>;
    // Fires once per bot, on its first open.
    opened?: (bot: HostedBot) => void;
    finished?: (bot: HostedBot, finish: HostedFinish) => void;
}

/** The hosted bots; stop closes every stream and engine session. */
export interface BotHost {
    stop(): Promise<void>;
}

// fetch reports a dropped connection as `terminated`, with the reason in
// the cause.
export function message(error: unknown): string {
    if (!(error instanceof Error)) return String(error);
    return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

function describeFinish(event: Extract<StreamEvent, { type: `gameFinish` }>): string {
    return event.winner === null ? `no winner (${event.reason})` : `${event.winner} won (${event.reason})`;
}

/**
 * Holds every bot's stream open for challenges, accepts every challenge,
 * and plays every game it is dealt, redialing until stopped.
 */
export function hostBots(bots: readonly HostedBot[], options: HostOptions): BotHost {
    const { client, log } = options;
    const controller = new AbortController();
    // A function, not a read: narrowing would pin the flag across awaits.
    const stopped = (): boolean => controller.signal.aborted;
    const sessions = new Map<HostedBot, Map<string, EngineSession>>();
    const seats = new Map<string, { opponent: string; side: Side }>();

    function onEvent(bot: HostedBot, event: StreamEvent): void {
        const games = sessions.get(bot) ?? new Map<string, EngineSession>();
        sessions.set(bot, games);
        switch (event.type) {
            case `gameStart`: {
                // A replayed start carries a fresh token, and the fresh dial
                // replaces the stale session on the server as well.
                games.get(event.gameId)?.close();
                seats.set(`${bot.name} ${event.gameId}`, { opponent: event.opponent.name, side: event.side });
                // A restart can end a game with no gameFinish, so a session
                // leaves the map when its socket closes.
                const session = playGame({
                    url: client.engineUrl(event.engine.socketUrl, event.engine.token),
                    strategy: bot.strategy,
                    random: options.random,
                    thinkMs: bot.levels === undefined ? options.thinkMs : paceAt(bot.levels, event.level, options.thinkMs),
                    log: (line) => {
                        log(`${bot.name} ${event.gameId}: ${line}`);
                    },
                    closed: () => {
                        if (games.get(event.gameId) === session) games.delete(event.gameId);
                    },
                });
                games.set(event.gameId, session);
                log(`${bot.name} plays ${event.opponent.name} as ${event.side} in ${event.gameId}${event.level === null ? `` : ` at ${event.level}`}`);
                return;
            }
            case `gameFinish`: {
                games.get(event.gameId)?.close();
                games.delete(event.gameId);
                const seat = seats.get(`${bot.name} ${event.gameId}`);
                seats.delete(`${bot.name} ${event.gameId}`);
                log(`${bot.name} finished ${event.gameId}: ${describeFinish(event)}`);
                options.finished?.(bot, {
                    gameId: event.gameId,
                    opponent: seat?.opponent ?? null,
                    side: seat?.side ?? null,
                    winner: event.winner,
                    reason: event.reason,
                });
                return;
            }
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
    async function reclaim(bot: HostedBot): Promise<unknown> {
        try {
            bot.token = await options.reclaim(bot);
            return null;
        } catch (error) {
            return error;
        }
    }

    // A server restart ends every stream; the bot redials until stopped,
    // and a dead token (a wiped database, a revoke) is claimed afresh.
    async function hold(bot: HostedBot): Promise<void> {
        let down = false;
        let counted = false;
        while (!stopped()) {
            try {
                await client.stream(
                    bot.token,
                    {
                        opened: () => {
                            if (down) log(`${bot.name} is back online`);
                            down = false;
                            if (!counted) options.opened?.(bot);
                            counted = true;
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
                // A refused open names its wait, and a sooner retry would only be refused again.
                if (failure instanceof ApiError && failure.retryAfter !== null) {
                    await sleep(failure.retryAfter * 1000, undefined, { signal: controller.signal }).catch(() => undefined);
                    continue;
                }
            }
            await sleep(streamRetryMs, undefined, { signal: controller.signal }).catch(() => undefined);
        }
    }

    const holds = bots.map(hold);
    return {
        stop: async () => {
            controller.abort();
            for (const games of sessions.values()) {
                for (const session of games.values()) session.close();
                games.clear();
            }
            await Promise.allSettled(holds);
        },
    };
}
