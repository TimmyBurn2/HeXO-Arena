import { z } from 'zod';
import type { Accepts } from './api';
import { axialCoordSchema } from './board';
import { nameSyntaxSchema } from './names';
import {
    defaultOpeningTurns,
    finishReasonSchema,
    openingTurnsSchema,
    sideSchema,
    streamPlayerSchema,
    timeControlSchema,
    type TimeControl,
} from './stream';

export const gamesPath = `/api/games`;
export const gamePath = `/api/games/{gameId}`;
export const gameMovePath = `/api/games/{gameId}/move`;
export const gameResignPath = `/api/games/{gameId}/resign`;
export const botGameSocketPath = `/api/bot/game/{gameId}/socket`;
export const botGameResignPath = `/api/bot/game/{gameId}/resign`;

export const createGameRequestSchema = z.object({
    bot: nameSyntaxSchema,
    timeControl: timeControlSchema,
    openingTurns: openingTurnsSchema.default(defaultOpeningTurns),
});
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

// The clock at the moment of the read, mirroring the time-control modes.
// Match clocks are keyed by side; remaining values never go below zero.
export const gameClockSchema = z.discriminatedUnion(`mode`, [
    z.object({ mode: z.literal(`unlimited`) }),
    z.object({ mode: z.literal(`turn`), remainingTurnMs: z.number().int().min(0) }),
    z.object({
        mode: z.literal(`match`),
        remainingMainMs: z.object({ x: z.number().int().min(0), o: z.number().int().min(0) }),
    }),
]);
export type GameClock = z.infer<typeof gameClockSchema>;

// Geometry in the engine's x,y so the browser and the server share one
// coordinate system; identity by side, the wire vocabulary for turn order.
export const gameCellSchema = axialCoordSchema.extend({ side: sideSchema });
export type GameCell = z.infer<typeof gameCellSchema>;

// openingTurns counts the server-placed turns after the origin, so a
// reader can tell the opening from the turns the players made.
const snapshotBase = {
    gameId: z.string(),
    you: sideSchema,
    opponent: streamPlayerSchema,
    openingTurns: openingTurnsSchema,
    board: z.object({ cells: z.array(gameCellSchema) }),
};

export const gameSnapshotSchema = z.discriminatedUnion(`status`, [
    z.object({
        ...snapshotBase,
        status: z.literal(`in-progress`),
        toMove: sideSchema,
        clock: gameClockSchema,
    }),
    z.object({
        ...snapshotBase,
        status: z.literal(`finished`),
        winner: sideSchema.nullable(),
        reason: finishReasonSchema,
        // Absent when the process that ran the clock is gone; the result
        // stands without it.
        clock: gameClockSchema.optional(),
    }),
]);
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;

// Exactly two placements per turn, always; the first stone ever placed is
// the origin and the server places it.
export const humanMoveRequestSchema = z.object({
    cells: z.array(axialCoordSchema).length(2),
});
export type HumanMoveRequest = z.infer<typeof humanMoveRequestSchema>;

// Caller-side bounds on the human: at most three live games at once and
// a cooldown between creations, so a browser cannot farm the create route.
// Bot-side gates follow.
export const gameCreateErrorCodes = [
    `human_busy`,
    `game_cooldown`,
    `not_open`,
    `clock_not_accepted`,
    `bot_busy`,
] as const;
// A delisted bot takes no new games from humans either.
export const gameCreateForbiddenErrorCodes = [`delisted`] as const;
export const gameMoveErrorCodes = [
    `not_your_turn`,
    `cell_occupied`,
    `out_of_range`,
    `game_over`,
] as const;
export const gameResignErrorCodes = [`game_over`] as const;

/**
 * Whether a declared accepts covers a clock. A bot that never declared
 * accepts covers nothing: a human always plays a bot that agreed to the
 * clock, and the declaration is the only voice a bot has.
 */
export function acceptsCovers(accepts: Accepts | undefined, timeControl: TimeControl): boolean {
    if (accepts === undefined) return false;
    if (timeControl.mode === `unlimited`) return accepts.unlimited;
    if (timeControl.mode === `match`) return accepts.match;
    const window = accepts.turnMs;
    if (window === null) return false;
    return (window[0] ?? 0) <= timeControl.turnTimeMs && timeControl.turnTimeMs <= (window[1] ?? 0);
}
