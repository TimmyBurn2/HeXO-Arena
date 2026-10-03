import { z } from 'zod';
import type { Accepts } from './api';
import { axialCoordSchema } from './board';
import { levelIdSchema, seatLevelSchema } from './levels';
import { deletedMarkSchema, nameSyntaxSchema } from './names';
import {
    finishReasonSchema,
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


// The live list is a glance, not an archive: this many games, newest first.
export const liveGameListCap = 12;

// Every reader within this window gets the one body serialized for it,
// so a crowd of pollers costs one serialization a window.
export const liveGameListMemoMs = 1_000;

// Not strict: the list answered any query before it read one.
export const liveGamesQuerySchema = z.object({
    tests: z
        .literal(`1`)
        .optional()
        .meta({ param: { description: `Present as 1, tests are listed beside the other games; else they are left out.` } }),
});
export type LiveGamesQuery = z.infer<typeof liveGamesQuerySchema>;

/** A person's game opens on the origin alone unless the request asks for more; bot challenges and tournaments keep five. */
export const defaultHumanOpeningPlies = 1;

// Restating the component id keeps the $ref and renders this default beside it.
export const createGameRequestSchema = z.object({
    bot: nameSyntaxSchema,
    timeControl: timeControlSchema,
    openingPlies: openingPliesSchema.default(defaultHumanOpeningPlies).meta({ id: `OpeningPlies`, default: defaultHumanOpeningPlies }),
    level: levelIdSchema
        .optional()
        .meta({ description: `One of the bot's declared levels, its default when absent; at any other level the game is unrated and counts toward no daily cap.` }),
    // Optional rather than defaulted: the server reads it absent as rated, and a caller that never sets it keeps type-checking.
    rated: z
        .boolean()
        .optional()
        .meta({
            default: true,
            description: `False starts a signed-in caller's game unrated for both seats, and it counts toward no daily cap; a guest's game, one against the caller's own bot, or one at a level other than the bot's default, is unrated either way.`,
        }),
});
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

/**
 * The mark on a game unrated by how it started: a signed-in person's game
 * started unrated or against their own bot, a game of an unrated duel,
 * and a challenge's game between two bots of one owner; a guest's game and
 * practice at another level are unrated by their seats and never carry it.
 */
export const unratedByChoiceSchema = z.literal(true).meta({
    id: `UnratedByChoice`,
    description: `Present when the game was started unrated, alone or in a duel, or one owner holds both seats, a person facing their own bot or two bots of one owner: it moves no rating and counts toward no daily cap.`,
});

/** The mark on a test: a game one person holds on both sides, which is never rated. */
export const testMarkSchema = z.literal(true).meta({
    id: `TestMark`,
    description: `Present when one person holds both seats: their own bot against them, or two bots they own, alone or in a test. Never rated; lists leave it out unless asked.`,
});

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
// watcher which seat is the bot; a guest seat has no rating, and neither
// has a bot at a level other than its default, since its rating belongs
// to the default.
export const gamePlayerSchema = seatPlayerSchema
    .extend({ kind: z.enum([`bot`, `user`, `guest`]), deleted: deletedMarkSchema.optional(), level: seatLevelSchema.optional() })
    .meta({
        id: `GamePlayer`,
        description: `level is present on a bot seat played at a level other than the bot's default, whose rating is then null.`,
    });
export type GamePlayer = z.infer<typeof gamePlayerSchema>;

export const gamePlayersSchema = z.object({ x: gamePlayerSchema, o: gamePlayerSchema }).meta({ id: `GamePlayers` });
export type GamePlayers = z.infer<typeof gamePlayersSchema>;

export const gameTournamentSchema = z
    .object({ id: z.string(), name: z.string(), round: z.number().int().min(1), game: z.union([z.literal(1), z.literal(2)]) })
    .meta({ id: `GameTournament`, description: `The tournament a game belongs to: its round, and which of the pairing's two games it is.` });
export type GameTournament = z.infer<typeof gameTournamentSchema>;

/** The most games a duel plays, a test's most. */
export const duelGamesMax = 50;

export const gameDuelSchema = z
    .object({ id: z.string(), game: z.number().int().min(1).max(duelGamesMax), of: z.number().int().min(1).max(duelGamesMax) })
    .meta({ id: `GameDuel`, description: `The duel a game belongs to: which of its games this is, and how many it plays.` });
export type GameDuel = z.infer<typeof gameDuelSchema>;

const snapshotBase = {
    gameId: z.string(),
    players: gamePlayersSchema,
    you: sideSchema.optional(),
    openingPlies: openingPliesSchema,
    board: gameBoardSchema,
    timeControl: timeControlSchema,
    tournament: gameTournamentSchema.optional(),
    duel: gameDuelSchema.optional(),
    unratedByChoice: unratedByChoiceSchema.optional(),
    test: testMarkSchema.optional(),
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
            voided: z.boolean().meta({ description: `Taken out by the operator: the game stays readable, and counts in no record and no rating.` }),
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
        cells: z.array(gameCellSchema).min(1).meta({ description: `Every stone in ply order, the opening included.` }),
        clock: gameClockSchema,
        duel: gameDuelSchema.optional(),
        test: testMarkSchema.optional(),
    })
    .meta({
        id: `LiveGameEntry`,
        description: `A game in progress, its board and clock as its snapshot states them; a game with a guest seat, a bot at a level other than its default, one started unrated, alone or in a duel, or one whose seats one owner holds, is unrated.`,
    });
export type LiveGameEntry = z.infer<typeof liveGameEntrySchema>;

/** The turn clock a game the server schedules between bots takes, a tournament's or a duel's, and its default. */
export const scheduledTurnMs = { min: 5_000, max: 60_000, default: 10_000 } as const;

/** The match clock a scheduled game takes: main time and increment. */
export const scheduledMainMs = { min: 60_000, max: 600_000 } as const;
export const scheduledIncrementMs = { min: 0, max: 10_000 } as const;

/**
 * A scheduled game's clock: a turn or match clock in the bounds, never
 * unlimited, which could hold two bots a whole day a game.
 */
export const scheduledClockSchema = timeControlSchema.refine(
    (clock: TimeControl) =>
        clock.mode === `turn`
            ? clock.turnTimeMs >= scheduledTurnMs.min && clock.turnTimeMs <= scheduledTurnMs.max
            : clock.mode === `match` &&
              clock.mainTimeMs >= scheduledMainMs.min &&
              clock.mainTimeMs <= scheduledMainMs.max &&
              clock.incrementMs >= scheduledIncrementMs.min &&
              clock.incrementMs <= scheduledIncrementMs.max,
    { message: `a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s` },
);

// Exactly two placements per turn, always; the first stone ever placed is
// the origin and the server places it.
export const humanMoveRequestSchema = z.object({
    cells: z.array(axialCoordSchema).length(2),
});
export type HumanMoveRequest = z.infer<typeof humanMoveRequestSchema>;

// Caller-side bounds on the human: the live-game cap, then bot-side gates.
export const gameCreateErrorCodes = [`human_busy`, `not_open`, `clock_not_accepted`, `unknown_level`, `bot_busy`] as const;

// The creation cooldown, so a browser cannot farm the create route, and
// the daily pair cap one human and one bot share; waiting lifts either,
// so both answer 429.
export const gameLimitErrorCodes = [`game_cooldown`, `daily_pair_cap`] as const;
// A delisted bot takes no new games from humans either. own_bot is never
// sent, since an owner's game against their own bot plays unrated, and
// stays listed so the code a client knows keeps its place.
export const gameCreateForbiddenErrorCodes = [`own_bot`, `delisted`] as const;
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
