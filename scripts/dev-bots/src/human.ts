import { playerOf, type FinishReason, type GameCell, type Side } from '@hexo-arena/contract';
import type { Position } from '@hexo-arena/rules';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, type ArenaClient } from './client';
import type { HumanGame } from './personas';
import { chooseTurn } from './player';

/** How a seeded human plays one game. */
export interface HumanPlayOptions {
    client: ArenaClient;
    cookie: string;
    name: string;
    game: HumanGame;
    random: () => number;
    // A pause before each turn, which keeps the human inside its request rate.
    paceMs: number;
    log: (line: string) => void;
}

/** A finished human game, from the human's seat. */
export interface HumanResult {
    readonly gameId: string;
    readonly you: Side;
    readonly winner: Side | null;
    readonly reason: FinishReason;
}

// Waits a refusal that names its wait, or a moment for a busy bot, and
// rethrows anything waiting cannot lift.
async function waitOut(error: unknown): Promise<void> {
    if (error instanceof ApiError && error.status === 429 && error.retryAfter !== null) {
        await sleep(error.retryAfter * 1_000);
        return;
    }
    if (error instanceof ApiError && error.code === `bot_busy`) {
        await sleep(2_000);
        return;
    }
    throw error;
}

function positionOf(cells: readonly GameCell[]): Position {
    return { stones: cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })) };
}

/**
 * Starts a game against a bot through the human routes, inside the
 * creation cooldown, and plays random turns next to the stones from the
 * game's event stream until it finishes, or ends it as the plan says.
 */
export async function playHumanGame(options: HumanPlayOptions): Promise<HumanResult> {
    const { client, cookie, game } = options;
    let snapshot;
    for (;;) {
        try {
            snapshot = await client.createGame(cookie, { bot: game.bot, timeControl: game.timeControl, openingPlies: game.openingPlies });
            break;
        } catch (error) {
            await waitOut(error);
        }
    }
    const { gameId, you } = snapshot;
    if (you === undefined) throw new Error(`the new game ${gameId} seats nobody as ${options.name}`);
    options.log(`${options.name} plays ${game.bot} as ${you} in ${gameId}`);

    let cells: GameCell[] = snapshot.board.cells;
    let turnsTaken = 0;
    let answered = -1;
    // Written from the stream's callbacks, which narrowing cannot follow.
    const outcome: { result: HumanResult | null } = { result: null };
    const controller = new AbortController();

    async function act(): Promise<void> {
        // One answer per position: the snapshot and a turn event can both
        // say it is this side's move.
        if (answered === cells.length) return;
        answered = cells.length;
        turnsTaken += 1;
        if (game.ending.kind === `idle`) return;
        await sleep(options.paceMs);
        if (game.ending.kind === `resign` && turnsTaken > game.ending.afterTurns) {
            await client.resign(cookie, gameId).catch(() => undefined);
            return;
        }
        const turn = chooseTurn(positionOf(cells), options.random);
        for (;;) {
            try {
                await client.move(cookie, gameId, turn);
                return;
            } catch (error) {
                // The clock or the bot may have ended the game meanwhile.
                if (error instanceof ApiError && (error.code === `game_over` || error.code === `not_your_turn`)) return;
                await waitOut(error);
            }
        }
    }

    function fail(error: unknown): void {
        options.log(`${options.name} in ${gameId}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // A stream the server ends before the finish is followed again; its
    // first frame is the snapshot, which carries a finish missed meanwhile.
    while (outcome.result === null) {
        await client
            .gameEvents(
                cookie,
                gameId,
                (event) => {
                    switch (event.event) {
                        case `snapshot`:
                            cells = event.data.board.cells;
                            if (event.data.status === `finished`) {
                                outcome.result = { gameId, you, winner: event.data.winner, reason: event.data.reason };
                                controller.abort();
                            } else if (event.data.toMove === you) {
                                act().catch(fail);
                            }
                            return;
                        case `turn`:
                            cells = [...cells, ...event.data.cells.map((cell) => ({ ...cell, side: event.data.side }))];
                            if (event.data.toMove === you) act().catch(fail);
                            return;
                        case `finish`:
                            outcome.result = { gameId, you, winner: event.data.winner, reason: event.data.reason };
                            controller.abort();
                            return;
                    }
                },
                controller.signal,
            )
            .catch((error: unknown) => {
                if (!controller.signal.aborted) throw error;
            });
    }
    return outcome.result;
}
