import { z } from 'zod';
import { htttxMoveRequestSchema, htttxSideSchema } from './htttx';
import { provisionalSchema, ratingSchema } from './leaderboard';
import { levelIdSchema } from './levels';
import { gameTurnCap, orphanForfeitMs, unlimitedWallCapMs } from './limits';

// One line of the bot event stream, discriminated by `type`; the set of
// kinds is closed, so an unknown discriminator is a hard parse failure.

// Play order in the wire vocabulary: `x` owns turn 0, the origin, and `o` turn 1.
export const sideSchema = htttxSideSchema;
export type Side = z.infer<typeof sideSchema>;

export const finishReasonSchema = z
    .enum([`aborted`, `disconnect`, `surrender`, `timeout`, `terminated`, `six-in-a-row`])
    .meta({
        id: `FinishReason`,
        description: [
            `How a game ended.`,
            `six-in-a-row: the winner completed six in a row.`,
            `timeout: the loser's clock ran out.`,
            `surrender: the loser resigned.`,
            `disconnect: the loser's stream stayed closed for ${String(orphanForfeitMs / 1000)} s.`,
            `terminated: the loser played an illegal move, or, with no winner, the game reached ${String(gameTurnCap)} turns or an unlimited game ${String(unlimitedWallCapMs / 3_600_000)} hours.`,
            `aborted: the operator, a restart, or the end of a human player's session stopped the game, with no winner.`,
        ].join(` `),
    });
export type FinishReason = z.infer<typeof finishReasonSchema>;

// The floors are contract promises a bot can rely on when choosing what to
// accept.
export const timeControlSchema = z
    .discriminatedUnion(`mode`, [
        z.object({ mode: z.literal(`unlimited`) }),
        z.object({ mode: z.literal(`turn`), turnTimeMs: z.number().int().min(5_000) }),
        z.object({
            mode: z.literal(`match`),
            mainTimeMs: z.number().int().min(60_000),
            incrementMs: z.number().int().min(0),
        }),
    ])
    .meta({
        id: `TimeControl`,
        description: [
            `turn gives each turn turnTimeMs, and unused time is lost; match gives each side mainTimeMs for the game, adding incrementMs after each of its turns; unlimited has no clock.`,
            `Each move_request carries the seconds left for that move.`,
        ].join(` `),
    });
export type TimeControl = z.infer<typeof timeControlSchema>;

// A player in a game or challenge, named by the one global namespace shared
// by users and bots; the name is immutable, so it identifies without an id.
export const streamPlayerSchema = z
    .object({
        name: z.string(),
        rating: ratingSchema,
        provisional: provisionalSchema,
    })
    .meta({ id: `Player` });
export type StreamPlayer = z.infer<typeof streamPlayerSchema>;

// A guest is never provisional. The rating is inline, since the shared
// Rating made nullable reads as an allOf in the document.
export const seatPlayerSchema = streamPlayerSchema
    .extend({ rating: z.number().int().nullable() })
    .meta({ id: `Seat`, description: `A seat in a game: a bot, a player, or a guest, whose rating is null.` });
export type SeatPlayer = z.infer<typeof seatPlayerSchema>;

export const defaultOpeningPlies = 5;

// Where drawn stones may land and what the redraw rejects; the rules engine
// holds the same numbers, checked equal by its contract tests.
export const openingRadius = 2;
export const openingWindowCells = 6;
export const openingThreatStones = 4;

// A stone lands within this hex distance of some stone already placed; the
// rules engine holds the same number, checked equal by its contract tests.
export const placementRadius = 8;

// A ply is one stone placed and a turn is one player's action, both counted
// from zero: turn 0 is the origin stone, ply 0, and turn t >= 1 is plies
// 2t-1 and 2t.
// Only odd lengths end the opening on a turn boundary, so the first player
// turn always places two stones.
// zod takes a numeric enum as an object, so the keys are names only; an
// enum renders as an integer enum in OpenAPI, where a literal list does not.
export const openingPliesSchema = z.enum({ one: 1, three: 3, five: 5, seven: 7, nine: 9 }).meta({
    id: `OpeningPlies`,
    description: [
        `Stones the server places before either player acts, the origin at (0, 0) included.`,
        `A ply is one stone; turn 0 is the origin, and turn t >= 1 is plies 2t-1 and 2t.`,
        `Each later ply lands on an empty cell drawn uniformly from those within hex distance ${String(openingRadius)} of the origin.`,
        `The whole opening is redrawn while any ${String(openingWindowCells)} consecutive cells on an axis hold ${String(openingThreatStones)} or more stones of one player and none of the other.`,
    ].join(` `),
});
export type OpeningPlies = z.infer<typeof openingPliesSchema>;

export const openingPliesValues = openingPliesSchema.options;

// The generator drops a default beside a $ref; restating the component id
// keeps the $ref and renders the default next to it, so the component
// itself stays free of a default.
export const openingPliesRequestSchema = openingPliesSchema
    .default(defaultOpeningPlies)
    .meta({ id: `OpeningPlies`, default: defaultOpeningPlies });

// Who plays the first player turn, turn (openingPlies + 1) / 2; every turn
// before it belongs to the server's opening.
export const firstPlayerSchema = z.enum([`challenger`, `challenged`, `random`]);
export type FirstPlayer = z.infer<typeof firstPlayerSchema>;

export const challengeStatusSchema = z.enum([
    `created`,
    `accepted`,
    `declined`,
    `canceled`,
    `expired`,
]);
export type ChallengeStatus = z.infer<typeof challengeStatusSchema>;

// The whole offer, so the challenged side sees exactly what it accepts:
// clock, opening, and who takes the first turn.
export const challengeSchema = z
    .object({
        challengeId: z.string(),
        challenger: streamPlayerSchema,
        destUser: streamPlayerSchema,
        timeControl: timeControlSchema,
        openingPlies: openingPliesSchema,
        firstPlayer: firstPlayerSchema,
        status: challengeStatusSchema,
    })
    .meta({
        id: `Challenge`,
        description: [
            `firstPlayer picks who moves first after the opening, on turn (openingPlies + 1) / 2.`,
            `o plays the odd turns, so after 1, 5, or 9 opening plies the first player is o, and after 3 or 7 it is x.`,
            `random is drawn at acceptance; gameStart.side gives each bot its side.`,
        ].join(` `),
    });
export type Challenge = z.infer<typeof challengeSchema>;

// A game token is good this long after the gameStart line that carried it;
// a session already open outlasts it.
export const sessionTokenTtlMs = 60_000;

export const sessionHeartbeatMs = 10_000;

export const engineSessionSchema = z
    .object({
        socketUrl: z.string().meta({ description: `A path on the API's origin; dial it as wss://, or ws:// where the API is http://.` }),
        token: z.string().meta({
            description: `The game token (hgs_...): it opens this game's engine session and resigns the game until ${String(sessionTokenTtlMs / 1000)} s after this gameStart; reopening the stream replays gameStart with a fresh one.`,
        }),
    })
    .meta({ id: `EngineSession` });
export type EngineSession = z.infer<typeof engineSessionSchema>;

export const gameStartEventSchema = z
    .object({
        type: z.literal(`gameStart`),
        gameId: z.string(),
        side: sideSchema,
        opponent: seatPlayerSchema,
        timeControl: timeControlSchema,
        openingPlies: openingPliesSchema,
        rated: z.boolean().meta({
            description: [
                `Whether this game moves the bot's own rating: true only in a rated game between two bots.`,
                `A game against a player moves only the player's rating, and one against a guest moves none.`,
                `A game between two bots is unrated at a level other than a bot's default, in a series a player on the website started unrated, and between two bots of one owner.`,
            ].join(` `),
        }),
        level: levelIdSchema.nullable().meta({
            description: `The declared level the bot plays this game at, by id; null at its default. A bot that no longer declares the level plays its default.`,
        }),
        engine: engineSessionSchema,
    })
    .meta({
        id: `GameStartEvent`,
        description: `A game the bot plays has started, or is replayed as the stream opens. A game started by a player on the website or by a tournament arrives with no challenge before it.`,
    });
export type GameStartEvent = z.infer<typeof gameStartEventSchema>;

export const moveRequestEventSchema = z
    .object({
        type: z.literal(`moveRequest`),
        gameId: z.string(),
        request: htttxMoveRequestSchema,
    })
    .meta({
        id: `MoveRequestEvent`,
        deprecated: true,
        description: `Deprecated, and sent until the API's 1.0.0: it follows a replayed gameStart when the bot is to move, for information, and needs no answer, since the engine session sends its own move_request.`,
    });
export type MoveRequestEvent = z.infer<typeof moveRequestEventSchema>;

export const gameFinishEventSchema = z
    .object({
        type: z.literal(`gameFinish`),
        gameId: z.string(),
        winner: sideSchema.nullable().meta({
            description: `Null after aborted, and after terminated at the turn or time cap.`,
        }),
        reason: finishReasonSchema,
    })
    .meta({ id: `GameFinishEvent` });
export type GameFinishEvent = z.infer<typeof gameFinishEventSchema>;

/** How long after a bot's analysis session closes, its stream still open, the stream offers a new one. */
export const analysisSessionResendMs = 5_000;

export const analysisSessionSchema = z
    .object({
        socketUrl: z.string().meta({ description: `The analysis session's path on the API's origin, dialed as a game's engine session is.` }),
        token: z.string().meta({
            description: `The analysis token (has_...): it opens the bot's analysis session until ${String(sessionTokenTtlMs / 1000)} s after the line that carried it; a later analysisSession line replaces it.`,
        }),
    })
    .meta({ id: `AnalysisSession` });
export type AnalysisSession = z.infer<typeof analysisSessionSchema>;

export const analysisSessionEventSchema = z
    .object({
        type: z.literal(`analysisSession`),
        engine: analysisSessionSchema,
    })
    .meta({
        id: `AnalysisSessionEvent`,
        description: `Sent only to a bot that declares an analyzer: as the stream opens, after a declaration turns it on, and ${String(analysisSessionResendMs / 1000)} s after its analysis session closes while the stream stays open.`,
    });
export type AnalysisSessionEvent = z.infer<typeof analysisSessionEventSchema>;

export const challengeCreatedEventSchema = z
    .object({
        type: z.literal(`challenge`),
        challenge: challengeSchema,
    })
    .meta({
        id: `ChallengeCreatedEvent`,
        description: `A pending challenge for the bot, sent on creation and replayed as the stream opens.`,
    });

export const challengeCanceledEventSchema = z
    .object({
        type: z.literal(`challengeCanceled`),
        reason: z.enum([`canceled`, `expired`]),
        challenge: challengeSchema,
    })
    .meta({
        id: `ChallengeCanceledEvent`,
        description: `A cancel reaches the target with reason canceled; an expiry reaches both sides with reason expired.`,
    });

export const challengeDeclinedEventSchema = z
    .object({
        type: z.literal(`challengeDeclined`),
        challenge: challengeSchema,
    })
    .meta({ id: `ChallengeDeclinedEvent`, description: `The target declined; sent to the challenger.` });

export const challengeEventSchema = z.discriminatedUnion(`type`, [
    challengeCreatedEventSchema,
    challengeCanceledEventSchema,
    challengeDeclinedEventSchema,
]);

// Flat and closed: the challenge variants are members like the rest, so the
// discriminator resolves every line in one step.
export const streamEventSchema = z
    .discriminatedUnion(`type`, [
        gameStartEventSchema,
        moveRequestEventSchema,
        gameFinishEventSchema,
        challengeCreatedEventSchema,
        challengeCanceledEventSchema,
        challengeDeclinedEventSchema,
        analysisSessionEventSchema,
    ])
    .meta({ id: `StreamEvent` });
export type StreamEvent = z.infer<typeof streamEventSchema>;
