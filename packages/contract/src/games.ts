import { z } from 'zod';
import type { Accepts } from './api';
import { axialCoordSchema } from './board';
import { nameSyntaxSchema } from './names';
import {
    finishReasonSchema,
    openingPliesRequestSchema,
    openingPliesSchema,
    seatPlayerSchema,
    sideSchema,
    timeControlSchema,
    type TimeControl,
} from './stream';

export const gamesPath = `/api/games`;
export const gamePath = `/api/games/{gameId}`;
export const gameMovePath = `/api/games/{gameId}/move`;
export const gameResignPath = `/api/games/{gameId}/resign`;
export const botGameSocketPath = `/api/bot/game/{gameId}/socket`;
export const botGameResignPath = `/api/bot/game/{gameId}/resign`;

// Live games at once: a bot across every surface, a human, user or guest,
// on the human surface.
export const botConcurrentGameCap = 4;
export const humanConcurrentGameCap = 3;
export const humanGameCooldownSeconds = 60;

/** An unlimited game ends after this long with no winner, as `terminated`. */
export const unlimitedWallCapMs = 24 * 60 * 60 * 1000;

// The live list is a glance, not an archive: this many games, newest first.
export const liveGameListCap = 12;

export const createGameRequestSchema = z.object({
    bot: nameSyntaxSchema,
    timeControl: timeControlSchema,
    openingPlies: openingPliesRequestSchema,
});
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

// The clock at the moment of the read, mirroring the time-control modes.
// Match clocks are keyed by side; remaining values never go below zero.
export const gameClockSchema = z
    .discriminatedUnion(`mode`, [
        z.object({ mode: z.literal(`unlimited`) }),
        z.object({ mode: z.literal(`turn`), remainingTurnMs: z.number().int().min(0) }),
        z.object({
            mode: z.literal(`match`),
            remainingMainMs: z.object({ x: z.number().int().min(0), o: z.number().int().min(0) }),
        }),
    ])
    .meta({ id: `GameClock` });
export type GameClock = z.infer<typeof gameClockSchema>;

// Geometry in the engine's x,y so the browser and the server share one
// coordinate system; identity by side, the wire vocabulary for turn order.
export const gameCellSchema = axialCoordSchema.extend({ side: sideSchema });
export type GameCell = z.infer<typeof gameCellSchema>;

export const gameBoardSchema = z.object({ cells: z.array(gameCellSchema) }).meta({ id: `GameBoard` });

// Bots and users share one name namespace, so the kind is what tells a
// watcher which seat is the bot; a guest seat has no rating.
export const gamePlayerSchema = seatPlayerSchema
    .extend({ kind: z.enum([`bot`, `user`, `guest`]) })
    .meta({ id: `GamePlayer` });
export type GamePlayer = z.infer<typeof gamePlayerSchema>;

export const gamePlayersSchema = z.object({ x: gamePlayerSchema, o: gamePlayerSchema }).meta({ id: `GamePlayers` });
export type GamePlayers = z.infer<typeof gamePlayersSchema>;

const snapshotBase = {
    gameId: z.string(),
    players: gamePlayersSchema,
    you: sideSchema.optional(),
    openingPlies: openingPliesSchema,
    board: gameBoardSchema,
};

export const gameSnapshotSchema = z
    .discriminatedUnion(`status`, [
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
            // Absent when the process that ran the clock is gone; the
            // result stands without it.
            clock: gameClockSchema.optional(),
        }),
    ])
    .meta({
        id: `GameSnapshot`,
        description: [
            `you is the caller's side, present exactly when the caller holds a seat.`,
            `board.cells lists stones in ply order, so its first openingPlies entries are the opening.`,
        ].join(` `),
    });
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;

export const liveGameEntrySchema = z
    .object({
        gameId: z.string(),
        players: gamePlayersSchema,
        timeControl: timeControlSchema,
        toMove: sideSchema,
        rated: z.boolean(),
        plies: z.number().int().min(1).meta({ description: `Stones on the board, the opening included.` }),
    })
    .meta({ id: `LiveGameEntry`, description: `A game in progress; a game with a guest seat is unrated.` });
export type LiveGameEntry = z.infer<typeof liveGameEntrySchema>;

// Exactly two placements per turn, always; the first stone ever placed is
// the origin and the server places it.
export const humanMoveRequestSchema = z.object({
    cells: z.array(axialCoordSchema).length(2),
});
export type HumanMoveRequest = z.infer<typeof humanMoveRequestSchema>;

// Caller-side bounds on the human: the live-game cap and the creation
// cooldown, so a browser cannot farm the create route.
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
