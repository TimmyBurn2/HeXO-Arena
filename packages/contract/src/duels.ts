import { z } from 'zod';
import { botVersionSchema } from './api';
import { estimateMoreGames, likelyStrongerChance, strongerChance } from './duel-estimate';
import { duelGamesMax, gameCellSchema, liveGameEntrySchema, scheduledClockSchema } from './games';
import { provisionalSchema } from './leaderboard';
import { levelIdSchema, seatLevelSchema } from './levels';
import { clockText, pageTitle, plural, siteName, type PageMeta } from './meta';
import { deletedBotName, deletedMarkSchema, deletedPlayerName, nameKeyOf, nameMaxLength, nameSyntaxSchema } from './names';
import { finishReasonSchema, openingPliesRequestSchema, openingPliesSchema, timeControlSchema } from './stream';

export const duelListPath = `/api/duels`;
export const duelPath = `/api/duels/{id}`;
export const duelStopPath = `/api/duels/{id}/stop`;
export const duelBotsPath = `/api/duels/bots`;
export const duelExportPath = `/api/duels/{id}/export`;

// zod takes a numeric enum as an object, so the keys are names only; an
// enum renders as an integer enum in OpenAPI, where a literal list does not.
export const duelGamesSchema = z.enum({ one: 1, two: 2, four: 4, six: 6, eight: 8, ten: 10, twenty: 20, thirty: 30, fifty: 50 }).meta({
    id: `DuelGames`,
    description: [
        `How many games a duel plays: a single game with sides drawn by lot, or pairs, each pair one opening played twice with the sides swapped.`,
        `More than 10 only in a test, between two bots of one owner.`,
    ].join(` `),
});
export type DuelGames = z.infer<typeof duelGamesSchema>;

/** Every length a duel or a test takes. */
export const duelGamesOptions = duelGamesSchema.options;

/** The lengths a duel between two owners' bots takes: a single game, or one to five pairs. */
export const duelGameCounts = [1, 2, 4, 6, 8, 10] as const satisfies readonly DuelGames[];

/** The lengths a test offers, where one person owns both bots. */
export const testGameCounts = [2, 10, 20, 30, 50] as const satisfies readonly DuelGames[];

/** A duel plays one pair unless its starter asks for another length. */
export const defaultDuelGames = 2;

/** A test plays ten pairs unless its starter asks for another length. */
export const defaultTestGames = 20;

/** Duels and tests one person may have running at once. */
export const duelLiveCap = 2;

/** Duels and tests one person may start in a UTC day. */
export const duelDailyCap = 10;

/** Running duels one bot plays in at once, so duels fill at most half its game slots. */
export const duelPerBotCap = 2;

/** Running duels one pair of bots plays at once; a unique index holds it. */
export const duelPerPairCap = 1;

// Every reader of one duel within this window gets the one body
// serialized for it.
export const duelDetailMemoMs = 2_000;

/** How often a duel's page reads it again while it runs. */
export const duelRunningPollMs = 5_000;

/** Duels a list holds of each kind, running and over, newest first. */
export const duelListCap = 20;

export const duelIdSchema = z.string().regex(/^d_[a-z0-9]{12}$/);

// Restating the component id keeps the $ref and renders this default beside it.
export const createDuelRequestSchema = z
    .strictObject({
        first: nameSyntaxSchema,
        second: nameSyntaxSchema,
        games: duelGamesSchema.default(defaultDuelGames).meta({ id: `DuelGames`, default: defaultDuelGames }),
        openingPlies: openingPliesRequestSchema,
        timeControl: timeControlSchema,
        levels: z
            .strictObject({ first: levelIdSchema.optional(), second: levelIdSchema.optional() })
            .optional()
            .meta({ description: `Each bot's declared level, its default when absent; at any other level the duel is unrated.` }),
        rated: z.boolean().default(false).meta({ description: `True asks for a rated duel, which only a starter owning exactly one of the bots gets, at their default levels.` }),
    })
    .refine((request) => nameKeyOf(request.first) !== nameKeyOf(request.second), { message: `first and second name two bots` })
    .refine((request) => scheduledClockSchema.safeParse(request.timeControl).success, { message: `a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s`, path: [`timeControl`] })
    .refine((request) => request.openingPlies > 1 || request.games <= 2, { message: `a 1-ply opening allows a single game or one pair` })
    .meta({
        id: `CreateDuelRequest`,
        description: [
            `The clock is a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s, never unlimited.`,
            `A 1-ply opening allows a single game or one pair, since a bot that plays alike every time would replay the bare origin identically.`,
            `Two bots of one owner meet in a test, never rated.`,
        ].join(` `),
    });
export type CreateDuelRequest = z.infer<typeof createDuelRequestSchema>;

// Each bot's gates in the caller's order, then the duel's own limits:
// one running duel per pair, the starter's running duels, a rated duel the
// starter may not have, and a length only a test takes.
export const duelCreateErrorCodes = [
    `not_open`,
    `duel_refused`,
    `clock_not_accepted`,
    `unknown_level`,
    `bot_busy`,
    `duel_live`,
    `duel_busy`,
    `unrated_only`,
    `test_only`,
] as const;

// A delisted bot, or one whose owner is banned, plays no new duel.
export const duelForbiddenErrorCodes = [`delisted`, `banned`] as const;

// The daily caps, which the UTC day's turn lifts, so they answer 429 with the wait.
export const duelQuotaErrorCodes = [`daily_duel_cap`, `daily_pair_cap`, `daily_bot_cap`] as const;

// Only the starter and the two bots' owners stop a duel, and only while it runs.
export const duelStopForbiddenErrorCodes = [`not_yours`] as const;
export const duelStopConflictErrorCodes = [`over`] as const;

export const duelKindSchema = z.enum([`duel`, `test`]).meta({
    id: `DuelKind`,
    description: `test: one person owns both bots, so it is never rated, may play up to 50 games, and estimates which bot is stronger.`,
});
export type DuelKind = z.infer<typeof duelKindSchema>;

export const duelStatusSchema = z.enum([`running`, `finished`, `cut_short`, `stopped`]).meta({
    id: `DuelStatus`,
    description: `finished: every game was played. cut_short: a game could not start or was aborted. stopped: the starter, an owner, or the operator stopped it.`,
});
export type DuelStatus = z.infer<typeof duelStatusSchema>;

export const duelSideSchema = z
    .enum([`first`, `second`])
    .meta({ id: `DuelSide`, description: `One of the duel's two bots, in the order its starter named them.` });
export type DuelSide = z.infer<typeof duelSideSchema>;

/** Why a duel was cut short: a bot not ready for its next game, taken out, or capped, or a game aborted. */
export const duelCutReasons = [`offline`, `closed`, `clock`, `busy`, `refused`, `tournament`, `banned`, `delisted`, `deleted`, `daily_cap`, `aborted`] as const;

/** Who stopped a duel. */
export const duelStopReasons = [`starter`, `owner`, `operator`] as const;

export const duelEndReasonSchema = z.enum([...duelCutReasons, ...duelStopReasons]).meta({
    id: `DuelEndReason`,
    description: [
        `Cut short: a bot was offline, connected but not open (closed), outside its accepted clocks (clock), at its game cap (busy), or no longer took duels by others (refused) for the whole grace;`,
        `a tournament it entered began; it or its owner was taken out (banned, delisted, deleted);`,
        `a rated game met a daily cap (daily_cap); or the operator aborted a game (aborted).`,
        `Stopped by the starter, a bot's owner, or the operator.`,
    ].join(` `),
});
export type DuelEndReason = z.infer<typeof duelEndReasonSchema>;

export const duelEndSchema = z
    .object({
        reason: duelEndReasonSchema,
        bot: duelSideSchema.nullable().meta({ description: `The bot the reason names, or whose owner stopped the duel; null when it names neither.` }),
    })
    .meta({ id: `DuelEnd`, description: `Why a duel ended early.` });
export type DuelEnd = z.infer<typeof duelEndSchema>;

export const duelBotSchema = z
    .object({
        name: z.string(),
        ownerName: z.string(),
        deleted: deletedMarkSchema.optional(),
        ratingAtStart: z.number().int().nullable(),
        level: seatLevelSchema.optional(),
        version: botVersionSchema.optional().meta({ description: `The version the bot declared as the duel began, absent where it declared none.` }),
        now: z
            .object({ rating: z.number().int(), provisional: provisionalSchema })
            .nullable()
            .meta({ description: `The bot's rating on the ladder now; null for a deleted bot.` }),
    })
    .meta({
        id: `DuelBot`,
        description: `A bot as the duel began: its rating then, its level, present when other than its default, whose rating is then null, and its version; and its rating now.`,
    });
export type DuelBot = z.infer<typeof duelBotSchema>;

export const duelTermsSchema = z
    .object({
        games: duelGamesSchema,
        openingPlies: openingPliesSchema,
        timeControl: timeControlSchema,
        rated: z.boolean(),
    })
    .meta({ id: `DuelTerms` });
export type DuelTerms = z.infer<typeof duelTermsSchema>;

const pointsSchema = z.number().int().min(0);

export const duelScoreSchema = z
    .object({ first: pointsSchema, second: pointsSchema })
    .meta({ id: `DuelScore`, description: `One point per game won; a game without a winner scores nothing.` });

const halvesSchema = z.number().min(0).multipleOf(0.5);
const ratingPointsSchema = z.number().int();

export const duelEstimateSchema = z
    .object({
        games: z.number().int().min(1).max(duelGamesMax),
        points: z.object({ first: halvesSchema, second: halvesSchema }).meta({ description: `Each bot's points, a game without a winner a half to each.` }),
        rating: ratingPointsSchema.meta({ description: `How many rating points stronger the first bot is; below zero, weaker.` }),
        low: ratingPointsSchema.nullable().meta({ description: `The 95% range's lower end; null where it runs past any finite difference.` }),
        high: ratingPointsSchema.nullable().meta({ description: `The 95% range's upper end; null where it runs past any finite difference.` }),
        chance: z.number().min(0).max(1).meta({ description: `The chance the first bot is the stronger.` }),
        favored: duelSideSchema.nullable().meta({ description: `The bot the chance favors, null at even.` }),
        verdict: z.enum([`stronger`, `likely_stronger`, `too_close`]).meta({
            description: `For the favored bot: stronger at a chance of ${String(strongerChance * 100)}% or more, likely_stronger from ${String(likelyStrongerChance * 100)}%, else too_close.`,
        }),
        narrowed: ratingPointsSchema.nullable().meta({
            description: `How far the range would reach either way after another ${String(estimateMoreGames)} games; null where it would still run past any finite difference.`,
        }),
    })
    .meta({
        id: `DuelEstimate`,
        description: `A test's estimate over the games over so far, counted by pairs since a pair shares its opening, with one pair won and one lost added so a short run or a sweep stays finite.`,
    });
export type DuelEstimate = z.infer<typeof duelEstimateSchema>;

export const duelGameStateSchema = z.enum([`pending`, `live`, `played`, `not_played`, `aborted`]);
export type DuelGameState = z.infer<typeof duelGameStateSchema>;

export const duelResultSchema = z
    .object({
        game: z.number().int().min(1).max(duelGamesMax),
        x: duelSideSchema,
        gameId: z.string().nullable(),
        state: duelGameStateSchema,
        winner: duelSideSchema.nullable(),
    })
    .meta({ id: `DuelResult`, description: `A game of the duel as a list draws it: its sides, how it stands, and who won.` });
export type DuelResult = z.infer<typeof duelResultSchema>;

export const duelGameSchema = duelResultSchema
    .extend({
        x: duelSideSchema.meta({ description: `The bot playing x; the sides alternate every game.` }),
        reason: finishReasonSchema.nullable().meta({ description: `How the game ended once over; null before.` }),
        turns: z.number().int().min(0).nullable().meta({ description: `Turns on the board once the game is over, the opening's included; null before.` }),
        opening: z
            .array(gameCellSchema)
            .nullable()
            .meta({ description: `The opening's stones, the origin included, once drawn at the first game of its pair; the pair's second game replays them.` }),
    })
    .meta({ id: `DuelGame` });
export type DuelGame = z.infer<typeof duelGameSchema>;

export const duelWaitingSchema = z
    .object({ bot: duelSideSchema, until: z.iso.datetime() })
    .meta({ id: `DuelWaiting`, description: `The bot the next game waits for, and when the duel is cut short unless it is ready.` });
export type DuelWaiting = z.infer<typeof duelWaitingSchema>;

const duelTime = z.iso.datetime();

// Shared by the list and the detail, so their descriptions live on the
// two components rather than on fields the document would repeat.
const duelFields = {
    id: duelIdSchema,
    kind: duelKindSchema,
    status: duelStatusSchema,
    startedBy: z.string(),
    first: duelBotSchema,
    second: duelBotSchema,
    terms: duelTermsSchema,
    score: duelScoreSchema,
    estimate: duelEstimateSchema.optional(),
    end: duelEndSchema.optional(),
    createdAt: duelTime,
    endedAt: duelTime.nullable(),
};

export const duelSummarySchema = z
    .object({ ...duelFields, played: z.number().int().min(0).max(duelGamesMax), results: z.array(duelResultSchema).min(1).max(duelGamesMax) })
    .meta({
        id: `DuelSummary`,
        description: [
            `startedBy names who started the duel, ${deletedPlayerName} once their account is deleted; a deleted bot reads as ${deletedBotName}.`,
            `played counts the games over, the live one aside; estimate is present on a test once a game is over; end is present once the duel ended early.`,
        ].join(` `),
    });
export type DuelSummary = z.infer<typeof duelSummarySchema>;

export const duelDetailSchema = z
    .object({
        ...duelFields,
        games: z.array(duelGameSchema).min(1).max(duelGamesMax),
        live: z.array(liveGameEntrySchema).max(1),
        waiting: duelWaitingSchema.optional(),
    })
    .meta({
        id: `DuelDetail`,
        description: [
            `A duel as its page reads it, named as the list names it.`,
            `The games run one at a time, each once both bots are ready; live holds the game under way, which a stopped duel still plays to its result, and waiting is present while the next game waits for a bot.`,
        ].join(` `),
    });
export type DuelDetail = z.infer<typeof duelDetailSchema>;

export const duelListQuerySchema = z.strictObject({
    bot: z
        .string()
        .min(1)
        .max(nameMaxLength)
        .optional()
        .meta({ param: { description: `A bot's name, matched case-folded: only the duels it plays.` } }),
    mine: z
        .literal(`1`)
        .optional()
        .meta({ param: { description: `Present as 1, only duels the signed-in caller started or one of whose bots they own; none for a caller signed out.` } }),
    // The bare values, so the parameter does not repeat the component's description.
    kind: z.enum(duelKindSchema.options).optional().meta({ param: { description: `Only duels between two owners' bots, or only tests.` } }),
});
export type DuelListQuery = z.infer<typeof duelListQuerySchema>;

export const duelQuotaSchema = z
    .object({
        live: z.number().int().min(0).max(duelLiveCap).meta({ description: `Duels and tests the caller started that run now, of ${String(duelLiveCap)}.` }),
        today: z.number().int().min(0).max(duelDailyCap).meta({ description: `Duels and tests the caller started this UTC day, of ${String(duelDailyCap)}.` }),
    })
    .meta({ id: `DuelQuota` });
export type DuelQuota = z.infer<typeof duelQuotaSchema>;

export const duelListSchema = z
    .object({
        running: z.array(duelSummarySchema).max(duelListCap).meta({ description: `Running duels, the newest first.` }),
        past: z.array(duelSummarySchema).max(duelListCap).meta({ description: `Duels over, the latest to end first.` }),
        quota: duelQuotaSchema.optional().meta({ description: `Present when mine names a signed-in caller.` }),
    })
    .meta({ id: `DuelList` });
export type DuelList = z.infer<typeof duelListSchema>;

export const duelBotStateSchema = z
    .object({
        name: z.string(),
        duelsByOthers: z.boolean().meta({ description: `False keeps duels with the bot to those its owner starts.` }),
        dueling: z.array(z.string()).max(duelPerBotCap).meta({ description: `The bots it plays a running duel with.` }),
    })
    .meta({ id: `DuelBotState`, description: `What a duel's setup reads of a listed bot beside the bot list.` });
export type DuelBotState = z.infer<typeof duelBotStateSchema>;

export const duelBotStatesSchema = z.array(duelBotStateSchema).meta({ id: `DuelBotStates` });

const score = (summary: Pick<DuelSummary, `first` | `second` | `score`>) => `${String(summary.score.first)}-${String(summary.score.second)}`;

/** A duel's page title and description, its status in a few words. */
export function duelMeta(duel: DuelSummary): PageMeta {
    const pair = `${duel.first.name} vs ${duel.second.name}`;
    const length = `${String(duel.terms.games)} ${plural(duel.terms.games, `game`, `games`)}`;
    const kind = duel.kind === `test` ? `Test` : `Duel`;
    const leader = duel.score.first === duel.score.second ? null : duel.score.first > duel.score.second ? duel.first.name : duel.second.name;
    const state = {
        running: leader === null ? `running, level at ${score(duel)}` : `running; ${leader} leads ${score(duel)}`,
        finished: leader === null ? `ended level, ${score(duel)}` : `${leader} won ${score(duel)}`,
        cut_short: `cut short at ${score(duel)}`,
        stopped: `stopped at ${score(duel)}`,
    }[duel.status];
    return { title: pageTitle(pair), description: `${kind} of ${length} between two bots, ${clockText(duel.terms.timeControl)}; ${state}` };
}

/** The Bot duel place under Play, where a duel or a test starts. */
export const duelsMeta: PageMeta = { title: pageTitle(`Bot duel`), description: `Put two bots on the board and watch them play, or test two of your own` };

/** The duels under Games, live and past. */
export const duelListMeta: PageMeta = { title: pageTitle(`Duels`), description: `Duels between two bots on ${siteName}, live and past` };
