import { z } from 'zod';
import { axialCoordSchema } from './board';
import { gameCellSchema } from './games';
import { htttxSideSchema } from './htttx';
import { gameTurnCap, type RateLimit } from './limits';
import { nameSyntaxSchema } from './names';

/** Turns of a game an analyzer reads and judges; later turns are neither, and a longer game is not read whole. */
export const analysisTurnCap = 200;

/** Stones a position may hold to be read by an analyzer, or set up for one. */
export const analysisStoneCap = 401;

/** How far from the origin a position's stones may lie, on each engine axis, to be read. */
export const analysisCoordLimit = 4_096;

/** Turns the analysis board keeps in its move tree, every variation counted. */
export const analysisTreeNodeCap = 2_000;

/** The analysis board's page; a stored game opens on it as `?game=<id>&turn=<t>`. */
export const analysisPagePath = `/analysis`;

export const analysisPositionsPath = `/api/analysis/positions`;
export const analysisCheckPath = `/api/analysis/check`;
export const gameAnalysesPath = `/api/games/{gameId}/analyses`;
export const botAnalysisSocketPath = `/api/bot/analysis/socket`;

/** Lines a reading holds at most: the analyzer's move, then up to two considerations. */
export const analysisLinesMax = 3;

/** The seconds a person may ask an analyzer to spend on one position. */
export const analysisSecondsChoices = [1, 2, 5] as const;

/** The seconds a position is read for unless the person picks another choice. */
export const analysisSecondsDefault = 2;

/** The most seconds an analyzer may declare it reads a position for. */
export const analyzerMaxSecondsCap = 10;

/** The seconds an analyzer reads for at most when its declaration names none. */
export const analyzerMaxSecondsDefault = 2;

/** Time an analyzer has past the seconds it was given before its answer times out. */
export const analysisGraceMs = 3_000;

/** Seconds each position of a whole game is read for. */
export const wholeGameSeconds = 2;

/** Whole games one user may ask to have read in a UTC day. */
export const analysisRequestsPerUserDay = 10;

/** Whole-game requests one user may have queued or running at once. */
export const analysisPendingPerUser = 2;

/** Community readings a game holds: finished ones, from different analyzers, and queued or running ones. */
export const analysesPerGame = { done: 2, pending: 1 } as const;

/** Whole-game requests queued across the site. */
export const analysisQueueCap = 50;

/** How long a whole-game request waits for an analyzer before it fails as expired. */
export const analysisQueueExpiryMs = 3_600_000;

/** Analyzers a whole-game request is tried on before it fails. */
export const analysisTries = 2;

/** Positions one user may have read by analyzers in a UTC day; cached readings are free. */
export const positionReadingsPerUserDay = 300;

/** Position requests one user may send. */
export const positionRequestLimit: RateLimit = { burst: 10, refillMs: 2_000 };

/**
 * Positions one client, by network address, may clear against live games before its engine reads them:
 * signed in or not, since the engine runs in the browser.
 */
export const positionCheckLimit: RateLimit = { burst: 20, refillMs: 1_000 };

/** Positions one IPv6 /48 may clear against live games. */
export const positionCheckPrefixLimit: RateLimit = { burst: 4 * positionCheckLimit.burst, refillMs: positionCheckLimit.refillMs / 4 };

/** How long a position request is held open waiting for its reading before it answers queued. */
export const positionHoldMs = 10_000;

/** Position requests queued across the site. */
export const positionQueueCap = 100;

/** Position requests queued for one analyzer. */
export const analyzerPositionQueueCap = 20;

/** Readings the server keeps, in memory only. */
export const readingCacheEntries = 5_000;

/** How long a kept reading is served. */
export const readingCacheTtlMs = 86_400_000;

/** Failed readings within the strike window that bench an analyzer. */
export const analyzerStrikeLimit = 3;

/** How far back an analyzer's failed readings count. */
export const analyzerStrikeWindowMs = 600_000;

/** How long a benched analyzer is given nothing to read. */
export const analyzerBenchMs = 600_000;

/** Positions of each live game no analyzer may read: the latest and the ones before it. */
export const liveGuardPositions = 3;

/** Turns past a live position that a requested position may run and still count as that position. */
export const liveGuardAheadTurns = 10;

/** The fewest stones a live position holds to be guarded: a tinier one sits inside most positions and would refuse most requests. */
export const liveGuardMinStones = 9;

/** How long the analysis board rests on a position before it asks for a reading. */
export const analysisDwellMs = 600;

/** How often a page polls a game's readings while one is queued or running. */
export const analysesPollMs = 3_000;

/** A game's readings are read at most this often, every caller in that time getting one body. */
export const analysesMemoMs = 1_000;

/** Considerations kept beside a bot's own evaluation of its move. */
export const ownConsiderationsMax = 2;

/** The largest forced-win distance, in turns, an evaluation may claim. */
export const analysisWinInLimit = 1_000;

/** The largest heuristic, either way, an evaluation may carry. */
export const analysisHeuristicLimit = 1e6;

/** The wait a full position queue asks for. */
export const positionBusyRetryAfterSeconds = 10;

/** The wait a full whole-game queue asks for. */
export const analysisQueueRetryAfterSeconds = 60;

/** An analysis by id: `a_` and a UUID. */
export const analysisIdSchema = z.string().regex(/^a_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const secondsSchema = z.number().int().min(1).max(analyzerMaxSecondsCap);
const linesSchema = z.number().int().min(1).max(analysisLinesMax);

/** The largest drop of a scaled value a cut may name: the scaled range runs from -1 to 1. */
export const valueCutMax = 2;

const scaleSchema = z.number().positive().max(analysisHeuristicLimit);
const cutSchema = z.number().positive().max(valueCutMax);

/**
 * What an analyzer's heuristic, divided by its scale, means:
 * `expected` is its estimate of x's expected result, 2 P(x wins) - 1;
 * `raw` is only ordered, higher better for x, and calibrated to nothing.
 */
export const valueMeaningSchema = z.enum([`expected`, `raw`]).meta({
    id: `ValueMeaning`,
    description: `What the heuristic, divided by scale, means: expected is the analyzer's estimate of x's expected result, 2 P(x wins) - 1; raw is only ordered, higher being better for x, and not calibrated.`,
});
export type ValueMeaning = z.infer<typeof valueMeaningSchema>;

/** The drops of the scaled value an analyzer calls an inaccuracy, a mistake, and a blunder. */
export const valueCutsSchema = z
    .strictObject({ inaccuracy: cutSchema, mistake: cutSchema, blunder: cutSchema })
    .refine((cuts) => cuts.inaccuracy < cuts.mistake && cuts.mistake < cuts.blunder, { message: `cuts rise from inaccuracy to blunder` })
    .meta({
        id: `ValueCuts`,
        description: `Drops of the mover's value, on the scaled range, each above 0 and at most ${String(valueCutMax)}, rising from inaccuracy to blunder; 0.1, 0.2, and 0.3 suit expected values.`,
    });

/** How a bot's heuristic reads, as it declares it. */
export const analyzerValuesDeclarationSchema = z
    .strictObject({
        scale: scaleSchema
            .default(1)
            .meta({ description: `The heuristic size the bot means as decided; the site divides heuristics by it before drawing or judging them. 1 when absent.` }),
        cuts: valueCutsSchema
            .optional()
            .meta({
                description: `The drops of the mover's value, on the scaled range, the site judges a turn by: each above 0 and at most ${String(valueCutMax)}, rising from inaccuracy to blunder; 0.1, 0.2, and 0.3 suit expected values. Absent, it judges no drop of value.`,
            }),
        meaning: valueMeaningSchema.default(`raw`).meta({
            description: `expected: the heuristic, divided by scale, is the bot's estimate of x's expected result, 2 P(x wins) - 1. raw, the default: it is only ordered, higher being better for x, and not calibrated.`,
        }),
    })
    .meta({
        id: `AnalyzerValuesDeclaration`,
        description: `How the bot's heuristic reads. Absent, the heuristic reads as raw at scale 1 and no drop of value is judged; forced wins are judged either way.`,
    });

/** How an analyzer's heuristic reads, as it declared it: scale 1, no cuts, and raw when it declared none. */
export const analyzerValuesSchema = z
    .object({
        scale: scaleSchema,
        cuts: valueCutsSchema.nullable(),
        meaning: valueMeaningSchema,
    })
    .meta({ id: `AnalyzerValues`, description: `How the analyzer's heuristic reads: scale 1, null cuts, which judge no drop of value, and raw, unless it declared otherwise.` });
export type AnalyzerValues = z.infer<typeof analyzerValuesSchema>;

/** What a bot declares to read positions for the site; null withdraws it. */
export const analyzerDeclarationSchema = z
    .strictObject({
        maxSeconds: secondsSchema
            .default(analyzerMaxSecondsDefault)
            .meta({ description: `The most seconds the bot reads one position for; a person picks up to it. ${String(analyzerMaxSecondsDefault)} when absent.` }),
        lines: linesSchema.meta({ description: `Lines the bot answers per position: its move, then up to two considerations, each with an evaluation.` }),
        whilePlaying: z
            .boolean()
            .default(false)
            .meta({ description: `True to take positions while the bot plays a game; false, the default, takes them only between games.` }),
        values: analyzerValuesDeclarationSchema.optional(),
    })
    .meta({
        id: `AnalyzerDeclaration`,
        description: [
            `Opts the bot in to reading positions sent on its analysis session, from the website's analysis board and from finished games.`,
            `Declaring it promises the htttx basic_websocket capabilities free_setup, resettable_state, dual_sided, request_id, move_time_limit, and interruptible.`,
        ].join(` `),
    });
export type AnalyzerDeclaration = z.infer<typeof analyzerDeclarationSchema>;

/** A bot's stored analyzer declaration, and whether it can read now. */
export const analyzerSchema = z
    .object({
        maxSeconds: secondsSchema,
        lines: linesSchema,
        whilePlaying: z.boolean(),
        values: analyzerValuesSchema,
        ready: z.boolean().meta({ description: `True while the bot holds its analysis session open.` }),
    })
    .meta({ id: `Analyzer`, description: `The analyzer the bot declared; null until it declares one, and once it withdraws.` });
export type Analyzer = z.infer<typeof analyzerSchema>;

const evaluationFields = {
    heuristic: z
        .number()
        .min(-analysisHeuristicLimit)
        .max(analysisHeuristicLimit)
        .optional()
        .meta({ description: `The analyzer's heuristic, positive for x, on a scale of about -1 to 1.` }),
    winIn: z
        .number()
        .int()
        .min(-analysisWinInLimit)
        .max(analysisWinInLimit)
        .refine((turns) => turns !== 0, { message: `winIn is never zero` })
        .optional()
        .meta({ description: `Turns to a forced win, the side to move's turn counted first, positive when x wins; never zero.` }),
};

/** A candidate turn and the evaluation of the board after it, as htttx's PositionEvaluation. */
export const analysisLineSchema = z
    .object({
        cells: z
            .array(axialCoordSchema)
            .min(2)
            .max(2)
            .meta({ description: `The turn's two stones in order; when the first completes six, the second is never played.` }),
        ...evaluationFields,
    })
    .refine((line) => line.heuristic !== undefined || line.winIn !== undefined, { message: `a line holds a heuristic or winIn` })
    .meta({ id: `AnalysisLine`, description: `A turn and the evaluation of the board after it, x-positive; heuristic, winIn, or both.` });
export type AnalysisLine = z.infer<typeof analysisLineSchema>;

/** Why a reading failed. */
export const analysisFailureSchema = z
    .enum([`timeout`, `illegal`, `no_evaluation`, `inconsistent`, `disconnect`, `protocol`, `expired`])
    .meta({
        id: `AnalysisFailure`,
        description: [
            `Why a reading failed: no answer within its seconds and a grace (timeout);`,
            `a line that is not a legal turn, or repeats one (illegal); a move without an evaluation (no_evaluation);`,
            `an evaluation out of bounds or contradicting the board (inconsistent); the analyzer hung up (disconnect)`,
            `or broke the session's protocol (protocol); no analyzer took the request in time (expired).`,
        ].join(` `),
    });
export type AnalysisFailure = z.infer<typeof analysisFailureSchema>;

/** The bot that read, as it was when it read. */
export const analyzerRefSchema = z
    .object({
        name: z.string(),
        version: z.string().nullable().meta({ description: `The version the bot declared when it read; null if none.` }),
        ownerName: z.string().nullable().meta({ description: `Null once the owner's account is deleted.` }),
        values: analyzerValuesSchema,
    })
    .meta({ id: `AnalyzerRef`, description: `A community bot whose reading this is, with the values it declared when it read; no analyzer is official.` });
export type AnalyzerRef = z.infer<typeof analyzerRefSchema>;

const positionCellsSchema = z
    .array(gameCellSchema)
    .min(1)
    .max(analysisStoneCap)
    .refine((cells) => cells.every((cell) => Math.abs(cell.x) <= analysisCoordLimit && Math.abs(cell.y) <= analysisCoordLimit), {
        message: `a stone lies too far from the origin`,
    })
    .meta({
        id: `AnalysisCells`,
        description: `A position's stones with their sides, in any order, ${String(analysisStoneCap)} at most, each x and y within ${String(analysisCoordLimit)} of the origin; one stone a cell, and no six on the board.`,
    });

const positionShape = { cells: positionCellsSchema, toMove: htttxSideSchema };

/** A position the analysis board may read, cleared against live games. */
export const positionCheckRequestSchema = z.object(positionShape).meta({ id: `PositionCheck` });

/** A position to read, with the analyzer, lines, and seconds asked of it. */
export const positionReadingRequestSchema = z
    .object({
        ...positionShape,
        analyzer: nameSyntaxSchema.nullable().meta({ description: `The analyzer to ask, by name; null for any ready one.` }),
        lines: linesSchema.meta({ description: `Lines to read; an analyzer declaring fewer answers its own number.` }),
        // An enum renders as an integer enum, where a literal list does not.
        seconds: z
            .enum({ one: analysisSecondsChoices[0], two: analysisSecondsChoices[1], five: analysisSecondsChoices[2] })
            .meta({ description: `Seconds to read for; an analyzer declaring fewer reads for its own most.` }),
    })
    .meta({ id: `PositionReadingRequest` });
export type PositionReadingRequest = z.infer<typeof positionReadingRequestSchema>;

const leftSchema = z.number().int().min(0).max(positionReadingsPerUserDay);

/** What a position request answers: a reading, a place in the queue, or a failure. */
export const positionReadingSchema = z
    .discriminatedUnion(`status`, [
        z.object({
            status: z.literal(`done`),
            analyzer: analyzerRefSchema,
            seconds: secondsSchema.meta({ description: `The seconds the analyzer was given.` }),
            elapsedMs: z.number().int().min(0).meta({ description: `How long it took to answer.` }),
            readAt: z.iso.datetime(),
            cached: z.boolean().meta({ description: `True for a reading kept from an earlier request, which costs nothing.` }),
            lines: z.array(analysisLineSchema).min(1).max(analysisLinesMax).meta({ description: `Best first.` }),
            left: leftSchema,
        }),
        z.object({
            status: z.literal(`queued`),
            ahead: z.number().int().min(0).meta({ description: `Positions the analyzer reads before this one.` }),
            analyzer: analyzerRefSchema.optional(),
            left: leftSchema,
        }),
        z.object({ status: z.literal(`failed`), analyzer: analyzerRefSchema, failure: analysisFailureSchema, left: leftSchema }),
    ])
    .meta({
        id: `PositionReading`,
        description: [
            `queued: the request was held ${String(positionHoldMs / 1000)} s without an answer; posting the same position again waits on the same request, and analyzer names the one it waits for once one is chosen.`,
            `A failed reading costs nothing; left counts the positions the caller may still have read this UTC day.`,
        ].join(` `),
    });
export type PositionReading = z.infer<typeof positionReadingSchema>;

/** How far a whole-game reading has come. */
export const analysisStatusSchema = z.enum([`queued`, `running`, `done`, `failed`]).meta({ id: `AnalysisStatus` });
export type AnalysisStatus = z.infer<typeof analysisStatusSchema>;

/** A reading of the position before one turn, best line first. */
export const analysisTurnSchema = z
    .object({
        turn: z.number().int().min(1).max(gameTurnCap + 1).meta({ description: `The turn played from the position; one past the last turn reads the final board.` }),
        toMove: htttxSideSchema,
        lines: z.array(analysisLineSchema).min(1).max(analysisLinesMax),
    })
    .meta({ id: `AnalysisTurn` });
export type AnalysisTurn = z.infer<typeof analysisTurnSchema>;

/** A whole finished game read by a community analyzer on request. */
export const communityAnalysisSchema = z
    .object({
        kind: z.literal(`community`),
        analysisId: z.string(),
        analyzer: analyzerRefSchema.nullable(),
        involved: z.boolean().meta({
            description: `True when the analyzer's owner played in the game, as a human or through one of their bots, the analyzer itself included; set as the analyzer takes the game, never changed after, and false while none has.`,
        }),
        status: analysisStatusSchema,
        failure: analysisFailureSchema.optional(),
        failedTurn: z.number().int().min(1).optional().meta({ description: `The turn whose position failed, when one did.` }),
        requestedAt: z.iso.datetime(),
        finishedAt: z.iso.datetime().nullable(),
        queuePosition: z.number().int().min(1).optional().meta({ description: `Present while queued; 1 is next.` }),
        progress: z.object({ done: z.number().int().min(0), of: z.number().int().min(0) }).meta({ description: `Positions read, of those to read.` }),
        seconds: secondsSchema.meta({ description: `Seconds each position is read for.` }),
        turns: z.array(analysisTurnSchema).meta({ description: `Readings so far, in turn order, from the first turn after the opening.` }),
    })
    .meta({
        id: `CommunityAnalysis`,
        description: `A whole finished game read by a community analyzer on request; analyzer is null while none has taken it, and failure is present once it failed.`,
    });
export type CommunityAnalysis = z.infer<typeof communityAnalysisSchema>;

/** A bot's own view of its turns, published once its game finished. */
export const ownAnalysisSchema = z
    .object({
        kind: z.literal(`own`),
        side: htttxSideSchema,
        player: z.string().meta({ description: `The bot's name as the game shows it.` }),
        values: analyzerValuesSchema,
        turns: z.array(analysisTurnSchema).meta({ description: `Each turn the bot evaluated: its move first, then up to ${String(ownConsiderationsMax)} considerations.` }),
    })
    .meta({
        id: `OwnAnalysis`,
        description: `What a bot said of its own moves while it played, with the values its analyzer declaration held at its first evaluation of the game; a bot judging itself is no judgment.`,
    });
export type OwnAnalysis = z.infer<typeof ownAnalysisSchema>;

export const analysisSchema = z.discriminatedUnion(`kind`, [communityAnalysisSchema, ownAnalysisSchema]).meta({ id: `Analysis` });
export type Analysis = z.infer<typeof analysisSchema>;

// Beside the finished and pending community readings, a list shows the
// latest failed one and the own view of each of the two seats.
const analysesListed = analysesPerGame.done + analysesPerGame.pending + 1 + 2;

/** Readings of a finished game: community ones and each bot's own. */
export const analysisListSchema = z
    .object({
        analyses: z
            .array(analysisSchema)
            .max(analysesListed)
            .meta({ description: `Community readings, finished first, then queued or running, then the latest failed one; then each bot seat's own.` }),
        optedOut: z.boolean().meta({ description: `True when a player asked that their games stay out of public analysis; the list is then empty.` }),
        independentOnline: z.boolean().meta({
            description: `True while an analyzer whose owner played in neither seat is online and may read the game now; a request naming no analyzer goes to such an analyzer first.`,
        }),
    })
    .meta({ id: `AnalysisList` });
export type AnalysisList = z.infer<typeof analysisListSchema>;

export const analysisRequestSchema = z
    .object({
        analyzer: nameSyntaxSchema.optional().meta({
            description: `The analyzer to ask, by name; when absent, any eligible one, preferring one whose owner played in neither seat while such an analyzer is online.`,
        }),
    })
    .meta({ id: `AnalysisRequest` });
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;

/** What the signed-in user may still ask of analyzers this UTC day. */
export const analysisLeftSchema = z
    .object({ positions: leftSchema, games: z.number().int().min(0).max(analysisRequestsPerUserDay) })
    .meta({ id: `AnalysisLeft`, description: `What the user may still ask of analyzers this UTC day: positions read, and whole games requested.` });
export type AnalysisLeft = z.infer<typeof analysisLeftSchema>;

// The position is one a live game holds, or was a turn or two ago, or
// runs on from, under any turn, mirror, color swap, or shift; or the
// caller sits in a live game, which closes every position to them.
export const positionCheckErrorCodes = [`live_position`, `seated`] as const;

// No ready analyzer takes the position; or the caller sent a newer one,
// which answers in its place.
export const positionReadingConflictErrorCodes = [...positionCheckErrorCodes, `no_analyzer`, `superseded`] as const;

// The day's readings are spent; or the queues are full.
export const positionReadingQuotaErrorCodes = [`analysis_limit`, `analysis_busy`] as const;

export const analysisRequestConflictErrorCodes = [
    `analysis_pending`,
    `analysis_full`,
    `pending_limit`,
    `not_analysable`,
    `no_analyzer`,
    `opted_out`,
    `game_live`,
] as const;

export const analysisRequestQuotaErrorCodes = [`analysis_limit`, `analysis_queue_full`] as const;

export const analysisListConflictErrorCodes = [`game_live`] as const;
