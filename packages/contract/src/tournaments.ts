import { z } from 'zod';
import { botVersionSchema } from './api';
import { estimateMoreGames, likelyStrongerChance, strongerChance } from './estimate';
import { gameCellSchema, liveGameEntrySchema, scheduledClockSchema, tournamentFormatSchema, tournamentLegsMax, tournamentPairGamesMax, type TournamentFormat } from './games';
import { provisionalSchema } from './leaderboard';
import { levelIdSchema, seatLevelSchema } from './levels';
import { clockText, pageTitle, plural, siteName, type PageMeta } from './meta';
import { deletedBotName, deletedMarkSchema, deletedPlayerName, nameKeyOf, nameMaxLength, nameSyntaxSchema } from './names';
import { finishReasonSchema, openingPliesRequestSchema, openingPliesSchema, timeControlSchema, type TimeControl } from './stream';

/** Bots that must be connected at the start, or the tournament is called off. */
export const tournamentMinPresent = 3;

/** Entries one tournament takes at most, and the default cap the operator sets. */
export const tournamentMaxEntrants = 12;

/** Pairings missed in a row that withdraw a bot. */
export const tournamentMissesToWithdraw = 2;

/** The pause between the last pairing of a round and the next round. */
export const tournamentRoundGapMs = 30_000;

/** Tournaments waiting to start at once. */
export const tournamentWaitingCap = 3;

/** How far ahead a tournament is scheduled: at least an hour, at most 14 days. */
export const tournamentLeadMs = 3_600_000;
export const tournamentHorizonMs = 14 * 86_400_000;

/** A development server schedules a tournament this soon, so a seeded one starts within minutes. */
export const tournamentDevLeadMs = 60_000;

/** The fewest bots a tournament a person sets up takes: two play a duel, three or more a round robin. */
export const tournamentBotsMin = 2;

/** The most bots a tournament a person sets up takes. */
export const tournamentBotsMax = 8;

/** The games each pair plays in a tournament a person sets up: a single game, or one to five openings, each played twice with the sides swapped. */
export const tournamentGameCounts = [1, 2, 4, 6, 8, 10] as const;

/** The games each pair plays in a test, where one person owns every bot: a tournament's counts, and longer runs. */
export const tournamentTestGameCounts = [...tournamentGameCounts, 20, 30, 50] as const;

/** A tournament a person sets up plays one opening a pair unless asked for more. */
export const defaultTournamentGamesPerPair = 2;

/** The most games one bot plays in a tournament a person sets up, and in a test. */
export const tournamentBotGamesMax = { event: 30, test: 70 } as const;

/** The games each bot of a field plays: its pair's games against each other bot. */
export function gamesPerBot(bots: number, gamesPerPair: number): number {
    return (bots - 1) * gamesPerPair;
}

/** Whether a field of a person's bots may play a count a pair: one its kind offers, and no bot past its most games. */
export function gamesPerPairFits(bots: number, gamesPerPair: number, test: boolean): boolean {
    const counts: readonly number[] = test ? tournamentTestGameCounts : tournamentGameCounts;
    return counts.includes(gamesPerPair) && gamesPerBot(bots, gamesPerPair) <= (test ? tournamentBotGamesMax.test : tournamentBotGamesMax.event);
}

/** Running tournaments people set up that one bot plays in at once, so they fill at most half its game slots. */
export const tournamentPerBotCap = 2;

/** Tournaments one person runs at once, of any size; a live slot each, which a unique index holds. */
export const tournamentLiveCap = 2;

/** Tournaments one person sets up in a UTC day, of any size. */
export const tournamentDailyCap = 10;

/** Running tournaments the list holds at most, the operator's first. */
export const tournamentRunningListCap = 20;

/** The default opening of a tournament's games. */
export const defaultTournamentOpening = 5 as const;

// Printable ASCII, no space at either end.
export const tournamentNameSchema = z
    .string()
    .min(3)
    .max(40)
    .regex(/^[!-~](?:[ -~]*[!-~])?$/);

// A duel kept from the duels of old holds its d_ id, so its links still resolve.
export const tournamentIdSchema = z.string().regex(/^[td]_[a-z0-9]{12}$/);

export const tournamentStatusSchema = z.enum([`scheduled`, `running`, `finished`, `called_off`, `canceled`, `stopped`, `cut_short`]);
export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;

export const tournamentOriginSchema = z.enum([`operator`, `person`]).meta({
    id: `TournamentOrigin`,
    description: `operator: a tournament the operator scheduled, which owners enter, rated. person: a duel or round robin someone signed in set up from bots they picked, never rated.`,
});
export type TournamentOrigin = z.infer<typeof tournamentOriginSchema>;

// zod takes a numeric enum as an object, so the keys are names only; an
// enum renders as an integer enum in OpenAPI, where a literal list does not.
export const tournamentGamesPerPairSchema = z.enum({ one: 1, two: 2, four: 4, six: 6, eight: 8, ten: 10, twenty: 20, thirty: 30, fifty: 50 }).meta({
    id: `TournamentGamesPerPair`,
    description: [
        `The games each pair plays: a single game with sides drawn by lot, or openings each played twice with the sides swapped.`,
        `More than ${String(Math.max(...tournamentGameCounts))} only in a test, where one person owns every bot; no bot plays more than ${String(tournamentBotGamesMax.event)} games, or ${String(tournamentBotGamesMax.test)} in a test.`,
    ].join(` `),
});
export type TournamentGamesPerPair = z.infer<typeof tournamentGamesPerPairSchema>;

/** A tournament's format: a person's of two bots is a duel, every other a round robin. */
export function tournamentFormatOf(tournament: { readonly origin: TournamentOrigin; readonly maxEntrants: number }): TournamentFormat {
    return tournament.origin === `person` && tournament.maxEntrants === tournamentBotsMin ? `duel` : `round_robin`;
}

/** A tournament a person set up, named for them by its format, since no one names one freely. */
export function personTournamentName(createdBy: string, format: TournamentFormat): string {
    return `${format === `duel` ? `Duel` : `Round robin`} by ${createdBy}`;
}

/** A running or scheduled tournament as the admin status lists it. */
export const adminTournamentSchema = z.object({
    id: tournamentIdSchema,
    name: z.string(),
    status: tournamentStatusSchema,
    startsAt: z.number().int(),
    entrants: z.number().int().min(0),
});
export type AdminTournament = z.infer<typeof adminTournamentSchema>;

/** The weekdays a weekly rule starts on, Monday first. */
export const tournamentWeekdays = [`mon`, `tue`, `wed`, `thu`, `fri`, `sat`, `sun`] as const;
export const tournamentWeekdaySchema = z.enum(tournamentWeekdays);
export type TournamentWeekday = z.infer<typeof tournamentWeekdaySchema>;

/** A weekly rule's UTC time of day, HH:MM on the 24-hour clock. */
export const tournamentTimeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

/** How many days before its start a weekly rule creates its tournament, opening it for entries, and the default. */
export const tournamentDaysAhead = { min: 1, max: 14, default: 7 } as const;

/** What a weekly rule's name pattern writes for the start's UTC date. */
export const tournamentDateToken = `{date}`;

/** A weekly rule's tournament name for one start: each date token becomes the start's UTC date, YYYY-MM-DD. */
export function expandTournamentName(pattern: string, startsAtMs: number): string {
    return pattern.replaceAll(tournamentDateToken, new Date(startsAtMs).toISOString().slice(0, 10));
}

// Every date expands to the same ten digits and dashes, so one sample
// date stands for all of them.
export const tournamentNamePatternSchema = z
    .string()
    .refine((pattern) => tournamentNameSchema.safeParse(expandTournamentName(pattern, 0)).success, {
        message: `the name, with {date} written as YYYY-MM-DD, must be 3 to 40 printable ASCII characters with no space at either end`,
    });

export const tournamentRuleIdSchema = z.number().int().min(1);

/** A weekly rule as the admin status and list show it, with its next start in seconds. */
export const adminTournamentRuleSchema = z.object({
    id: tournamentRuleIdSchema,
    weekday: tournamentWeekdaySchema,
    time: tournamentTimeOfDaySchema,
    namePattern: z.string(),
    timeControl: timeControlSchema,
    openingPlies: openingPliesSchema,
    maxEntrants: z.number().int().min(tournamentMinPresent).max(tournamentMaxEntrants),
    daysAhead: z.number().int().min(tournamentDaysAhead.min).max(tournamentDaysAhead.max),
    nextStartsAt: z.number().int(),
});
export type AdminTournamentRule = z.infer<typeof adminTournamentRuleSchema>;

/**
 * The admin form of a clock: `turn:<seconds>` or
 * `match:<minutes>+<seconds>`; null for anything else.
 */
export function parseClockArg(text: string): TimeControl | null {
    const turn = /^turn:(\d{1,3})$/.exec(text);
    if (turn?.[1] !== undefined) return { mode: `turn`, turnTimeMs: Number(turn[1]) * 1_000 };
    const match = /^match:(\d{1,3})\+(\d{1,3})$/.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
        return { mode: `match`, mainTimeMs: Number(match[1]) * 60_000, incrementMs: Number(match[2]) * 1_000 };
    }
    return null;
}

export const tournamentsPath = `/api/tournaments`;
export const tournamentBotsPath = `/api/tournaments/bots`;
export const tournamentPath = `/api/tournaments/{id}`;
export const tournamentEntryPath = `/api/tournaments/{id}/entry`;
export const tournamentExportPath = `/api/tournaments/{id}/export`;
export const tournamentStopPath = `/api/tournaments/{id}/stop`;
export const tournamentWithdrawPath = `/api/tournaments/{id}/withdraw`;

export const tournamentPickSchema = z
    .strictObject({
        name: nameSyntaxSchema,
        level: levelIdSchema.optional().meta({ description: `The bot's declared level to play at, its default when absent.` }),
    })
    .meta({ id: `TournamentPick` });
export type TournamentPick = z.infer<typeof tournamentPickSchema>;

// Restating the component id keeps the $ref and renders this default beside it.
export const createTournamentRequestSchema = z
    .strictObject({
        bots: z.array(tournamentPickSchema).min(tournamentBotsMin).max(tournamentBotsMax).meta({ description: `The bots in the order named; of two, the first named stands first.` }),
        gamesPerPair: tournamentGamesPerPairSchema.default(defaultTournamentGamesPerPair).meta({ id: `TournamentGamesPerPair`, default: defaultTournamentGamesPerPair }),
        openingPlies: openingPliesRequestSchema,
        timeControl: timeControlSchema,
    })
    .refine((request) => new Set(request.bots.map((bot) => nameKeyOf(bot.name))).size === request.bots.length, { message: `the bots are distinct`, path: [`bots`] })
    .refine((request) => scheduledClockSchema.safeParse(request.timeControl).success, { message: `a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s`, path: [`timeControl`] })
    .refine((request) => request.openingPlies > 1 || request.gamesPerPair <= 2, { message: `a 1-ply opening allows a single game or one opening a pair` })
    .meta({
        id: `CreateTournamentRequest`,
        description: [
            `${String(tournamentBotsMin)} to ${String(tournamentBotsMax)} distinct bots: two play a duel, three or more a round robin.`,
            `The clock is a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s, never unlimited.`,
            `A 1-ply opening allows a single game or one opening a pair, since a bot that plays alike every time would replay the bare origin identically.`,
        ].join(` `),
    });
export type CreateTournamentRequest = z.infer<typeof createTournamentRequestSchema>;

// Each bot's gates in the caller's order, then the tournament's own limits:
// a length only a test takes, a bot past its most games, and the caller's
// running tournaments.
export const tournamentCreateErrorCodes = [`not_open`, `duel_refused`, `clock_not_accepted`, `unknown_level`, `bot_busy`, `test_only`, `too_many_games`, `tournament_busy`] as const;

// A delisted bot, or one whose owner is banned, plays in no new tournament.
export const tournamentCreateForbiddenErrorCodes = [`delisted`, `banned`] as const;

// The daily cap, which the UTC day's turn lifts, so it answers 429 with the wait.
export const tournamentQuotaErrorCodes = [`daily_tournament_cap`] as const;

// Only the person who set a tournament up stops it, and only while it runs.
export const tournamentStopForbiddenErrorCodes = [`not_yours`] as const;
export const tournamentStopConflictErrorCodes = [`over`] as const;

// Only a bot's owner withdraws it, and only while it plays a running tournament a person set up.
export const tournamentWithdrawForbiddenErrorCodes = [`not_owner`] as const;
export const tournamentWithdrawConflictErrorCodes = [`over`, `not_playing`] as const;

export const tournamentBotStateSchema = z
    .object({
        name: z.string(),
        duelsByOthers: z.boolean().meta({ description: `False keeps the bot to the duels and round robins its owner sets up.` }),
        running: z
            .number()
            .int()
            .min(0)
            .max(tournamentPerBotCap)
            .meta({ description: `Running duels and round robins people set up that it plays in, at most ${String(tournamentPerBotCap)}.` }),
    })
    .meta({ id: `TournamentBotState`, description: `What a duel's or round robin's setup reads of a listed bot beside the bot list.` });
export type TournamentBotState = z.infer<typeof tournamentBotStateSchema>;

export const tournamentBotStatesSchema = z.array(tournamentBotStateSchema).meta({ id: `TournamentBotStates` });

export const tournamentWithdrawRequestSchema = z.strictObject({ bot: nameSyntaxSchema }).meta({ id: `TournamentWithdrawRequest` });
export type TournamentWithdrawRequest = z.infer<typeof tournamentWithdrawRequestSchema>;

// The most games a test of any field size plays: every pair meeting at the most games a pair its bots' cap allows.
const testGamesMax = Math.max(
    ...Array.from({ length: tournamentBotsMax - tournamentBotsMin + 1 }, (_, index) => index + tournamentBotsMin).flatMap((bots) =>
        tournamentTestGameCounts.filter((count) => gamesPerPairFits(bots, count, true)).map((count) => ((bots * (bots - 1)) / 2) * count),
    ),
);

/**
 * The most games one tournament plays:
 * the larger of the weekly's largest field, every pair meeting twice, and the longest test a person sets up.
 */
export const tournamentGamesMax = Math.max(tournamentMaxEntrants * (tournamentMaxEntrants - 1), testGamesMax);

/** Tournaments over that the list holds, the latest first. */
export const tournamentListPastCap = 20;

// Every reader of one tournament within this window gets the one body
// serialized for it.
export const tournamentDetailMemoMs = 2_000;

/** How often a tournament's page reads it again: while it runs, and while it waits. */
export const tournamentRunningPollMs = 5_000;
export const tournamentWaitingPollMs = 60_000;

const tournamentTime = z.iso.datetime();

export const tournamentWinnerSchema = z.object({ name: z.string(), ownerName: z.string(), deleted: deletedMarkSchema.optional() }).meta({ id: `TournamentWinner` });

export const tournamentEntryStateSchema = z.enum([`entered`, `playing`, `absent`, `left_out`, `withdrawn`]);

export const tournamentEntryReasonSchema = z.enum([`daily_cap`, `clock`, `missed`, `banned`, `delisted`, `deleted`, `owner`, `refused`, `tournament`]);
export type TournamentEntryReason = z.infer<typeof tournamentEntryReasonSchema>;

const entryReasonDescription = [
    `Why a bot was left out at the start (daily_cap: too few bot games left that day; clock: it does not accept the clock)`,
    `or withdrawn (missed: two openings missed in a row; banned, delisted, deleted; and from a tournament a person set up,`,
    `owner: by its owner; refused: its owner turned duels by others off; tournament: the weekly tournament it entered began).`,
].join(` `);

export const tournamentPlaceSchema = z
    .object({
        state: tournamentEntryStateSchema,
        reason: tournamentEntryReasonSchema.optional(),
        rank: z
            .number()
            .int()
            .min(1)
            .nullable()
            .meta({ description: `Its place in the standings, so far while it runs; null for a bot outside the field: before the start, absent, or left out.` }),
        points: z.number().int().min(0).nullable(),
    })
    .meta({ id: `TournamentPlace`, description: `A bot's entry in a tournament and where it stands, on each summary of a list that names the bot.` });
export type TournamentPlace = z.infer<typeof tournamentPlaceSchema>;

export const tournamentYoursSchema = z
    .object({ bot: z.string(), deleted: deletedMarkSchema.optional(), place: tournamentPlaceSchema })
    .meta({
        id: `TournamentYours`,
        description: `The caller's bot in the tournament and where it stands, the best placed where a round robin holds several; on the list of every bot alone.`,
    });
export type TournamentYours = z.infer<typeof tournamentYoursSchema>;

export const tournamentListQuerySchema = z.object({
    bot: z
        .string()
        .min(1)
        .max(nameMaxLength)
        .optional()
        .meta({ param: { description: `A bot's name, matched case-folded: only the tournaments it entered, each with its place.` } }),
    mine: z
        .literal(`1`)
        .optional()
        .meta({ param: { description: `Present as 1, only the tournaments the signed-in caller set up and those one of their bots plays; none for a caller signed out.` } }),
    kind: z.literal(`test`).optional().meta({ param: { description: `Only tests, duels and round robins of one person's bots.` } }),
});
export type TournamentListQuery = z.infer<typeof tournamentListQuerySchema>;

/** Why a tournament a person set up was stopped: by its creator, by the operator, or as the creator's account was banned or deleted. */
export const tournamentStopReasons = [`creator`, `operator`, `banned`, `deleted`] as const;

/** Why the bot that left a tournament a person set up, leaving fewer than two to play, was withdrawn. */
export const tournamentCutReasons = [`owner`, `missed`, `refused`, `tournament`, `banned`, `delisted`, `deleted`] as const;

/**
 * Why a duel kept from the duels of old was cut short, which the scheduler never writes:
 * a bot offline, connected but not open, outside its clocks, or at its game cap for the whole grace;
 * a rated game at a daily cap; or a game the operator aborted.
 */
export const duelCutReasons = [`offline`, `closed`, `clock`, `busy`, `daily_cap`, `aborted`] as const;

export const tournamentEndReasonSchema = z.enum([
    `creator`,
    `operator`,
    `owner`,
    `missed`,
    `refused`,
    `tournament`,
    `banned`,
    `delisted`,
    `deleted`,
    `offline`,
    `closed`,
    `clock`,
    `busy`,
    `daily_cap`,
    `aborted`,
]);
export type TournamentEndReason = z.infer<typeof tournamentEndReasonSchema>;

// A bot's number within one tournament, by which its pages name it; a
// deleted bot reads as its label alone, so two deleted bots stay apart only
// by this, and it means nothing outside the tournament.
const tournamentKeySchema = z
    .number()
    .int()
    .min(1)
    .meta({ id: `TournamentKey`, description: `A bot's number within this tournament, its entries counted in the order they came; it means nothing outside the tournament.` });

/** A bot as a tournament's round lines name it: its number in the tournament, its name, and the mark if it was deleted. */
export const tournamentBotSchema = z
    .object({ key: tournamentKeySchema, name: z.string(), deleted: deletedMarkSchema.optional() })
    .meta({ id: `TournamentBot` });
export type TournamentBot = z.infer<typeof tournamentBotSchema>;

export const tournamentEndSchema = z
    .object({
        reason: tournamentEndReasonSchema.meta({
            description: [
                `Stopped by the person who set it up (creator), or as their account was banned or deleted; canceled or stopped by the operator (operator);`,
                `or cut short once fewer than two bots still played, for why the last to leave was withdrawn:`,
                `by its owner (owner), two openings missed in a row (missed), its owner turning duels by others off (refused), the weekly it entered beginning (tournament), or it or its owner taken out (banned, delisted, deleted).`,
                `A duel kept from the duels of old may also have been cut short with a bot offline, connected but not open (closed), outside its clocks (clock), or at its game cap (busy) for the whole grace, a rated game at a daily cap (daily_cap), or a game aborted (aborted).`,
            ].join(` `),
        }),
        round: z.number().int().min(1).nullable().meta({ description: `The round under way, or the last one begun; null before any.` }),
        bot: tournamentBotSchema.optional().meta({ description: `The bot whose leaving cut it short, or that a duel's reason names.` }),
    })
    .meta({ id: `TournamentEnd`, description: `Why a tournament ended before its last game: stopped, canceled, or cut short.` });
export type TournamentEnd = z.infer<typeof tournamentEndSchema>;

const halvesSchema = z.number().min(0).multipleOf(0.5);
const ratingPointsSchema = z.number().int();

export const estimateSchema = z
    .object({
        games: z.number().int().min(1).max(tournamentBotGamesMax.test),
        points: z.object({ first: halvesSchema, second: halvesSchema }).meta({ description: `Each side's points, a game without a winner a half to each.` }),
        rating: ratingPointsSchema.meta({ description: `How many rating points stronger the first is; below zero, weaker.` }),
        low: ratingPointsSchema.nullable().meta({ description: `The 95% range's lower end; null where it runs past any finite difference.` }),
        high: ratingPointsSchema.nullable().meta({ description: `The 95% range's upper end; null where it runs past any finite difference.` }),
        chance: z.number().min(0).max(1).meta({ description: `The chance the first is the stronger.` }),
        favored: z.enum([`first`, `second`]).nullable().meta({ description: `The side the chance favors, null at even.` }),
        verdict: z.enum([`stronger`, `likely_stronger`, `too_close`]).meta({
            description: `For the favored side: stronger at a chance of ${String(strongerChance * 100)}% or more, likely_stronger from ${String(likelyStrongerChance * 100)}%, else too_close.`,
        }),
        narrowed: ratingPointsSchema.nullable().meta({
            description: `How far the range would reach either way after another ${String(estimateMoreGames)} games; null where it would still run past any finite difference.`,
        }),
    })
    .meta({
        id: `Estimate`,
        description: `A test's estimate over the games played so far, counted by openings since an opening's two games share it, with one opening won and one lost added so a short run or a sweep stays finite.`,
    });

export const tournamentLeadSchema = z
    .object({ bot: z.string(), deleted: deletedMarkSchema.optional(), estimate: estimateSchema })
    .meta({
        id: `TournamentLead`,
        description: `A test's bot first in the final standings, once a game was played, and its estimate against all the others together: first is the bot, second the rest.`,
    });
export type TournamentLead = z.infer<typeof tournamentLeadSchema>;

// Shared by the list and the detail, so their descriptions live on the
// two components rather than on fields the document would repeat.
const tournamentKindFields = {
    origin: tournamentOriginSchema,
    format: tournamentFormatSchema,
    createdBy: z.string().nullable(),
    rated: z.boolean(),
    test: z.boolean(),
    gamesPerPair: tournamentGamesPerPairSchema,
};

const kindDescription = [
    `createdBy names who set a person's duel or round robin up, ${deletedPlayerName} once their account is deleted, and is null on the operator's, whose name the operator chose;`,
    `a person's is named for its creator.`,
    `rated: the operator's, and a duel rated under the duels of old; test: one person owns every bot.`,
].join(` `);

export const tournamentEntrySchema = z
    .object({
        key: tournamentKeySchema,
        bot: z.string(),
        ownerName: z.string(),
        deleted: deletedMarkSchema.optional(),
        online: z.boolean(),
        ratingAtStart: z.number().int().nullable(),
        state: tournamentEntryStateSchema,
        reason: tournamentEntryReasonSchema.optional().meta({ description: entryReasonDescription }),
        level: seatLevelSchema.optional(),
        version: botVersionSchema.optional(),
        now: z
            .object({ rating: z.number().int(), provisional: provisionalSchema })
            .nullable()
            .optional()
            .meta({ description: `On a duel's entries: its rating on the ladder now, which its page shows; null once deleted.` }),
    })
    .meta({
        id: `TournamentEntry`,
        description: `level is present on a bot a tournament a person set up plays at a level other than its default, whose rating at the start is then null; version, where the bot declared one as it began.`,
    });
export type TournamentEntry = z.infer<typeof tournamentEntrySchema>;

export const tournamentGameOutcomeSchema = z.enum([`pending`, `live`, `played`, `no_show`, `forfeit`, `not_played`, `aborted`]);

export const tournamentGameSchema = z
    .object({
        x: tournamentKeySchema.meta({ description: `The bot playing x: the pairing's first in game 1, its second in game 2.` }),
        gameId: z.string().nullable(),
        outcome: tournamentGameOutcomeSchema,
        point: tournamentKeySchema.nullable().meta({ description: `The bot the game scored for: the winner, or the bot that came or stayed when the other did not.` }),
        missing: z.array(tournamentKeySchema).meta({ description: `The bots that did not show for a no-show, or were withdrawn for a forfeit.` }),
        reason: finishReasonSchema.nullable().optional().meta({ description: `On a duel's games: how a game played or aborted ended; null before, and for a game never played.` }),
        turns: z.number().int().min(0).nullable().optional().meta({ description: `On a duel's games: turns on the board once played, the opening's included; null otherwise.` }),
        opening: z
            .array(gameCellSchema)
            .nullable()
            .optional()
            .meta({ description: `On a duel's games: the opening's stones, the origin included, once drawn at its first game, which its second replays.` }),
    })
    .meta({ id: `TournamentGame` });
export type TournamentGame = z.infer<typeof tournamentGameSchema>;

export const tournamentPairingSchema = z
    .object({
        first: tournamentBotSchema,
        second: tournamentBotSchema,
        games: z
            .array(tournamentGameSchema)
            .min(1)
            .max(2 * tournamentLegsMax)
            .meta({
                description: `Its games in order: each opening twice, the first bot on x and then the second, and the next opening once both are over; or a single game, the first bot drawn by lot to play x.`,
            }),
    })
    .meta({ id: `TournamentPairing` });
export type TournamentPairing = z.infer<typeof tournamentPairingSchema>;

const pointsSchema = z.number().int().min(0);

export const tournamentPairSchema = z
    .object({
        first: tournamentBotSchema.extend({ points: pointsSchema }),
        second: tournamentBotSchema.extend({ points: pointsSchema }),
        games: z.array(tournamentGameSchema).min(1).max(tournamentPairGamesMax),
    })
    .meta({ id: `TournamentPair`, description: `A duel's two bots, the first named first, with their points, and every game in order.` });
export type TournamentPair = z.infer<typeof tournamentPairSchema>;

export const tournamentLeadersSchema = z
    .object({
        bots: z.array(z.object({ name: z.string(), deleted: deletedMarkSchema.optional() })).min(1),
        points: z.number().int().min(0),
        games: z.number().int().min(0).meta({ description: `The games each of them played that scored for someone: played, no-shows, and forfeits.` }),
    })
    .meta({ id: `TournamentLeaders`, description: `The bots first in the standings, so far or at the end, and their points.` });
export type TournamentLeaders = z.infer<typeof tournamentLeadersSchema>;

export const tournamentSummarySchema = z
    .object({
        id: tournamentIdSchema,
        name: z.string(),
        ...tournamentKindFields,
        status: tournamentStatusSchema,
        startsAt: tournamentTime,
        timeControl: timeControlSchema,
        openingPlies: openingPliesSchema,
        entrants: z.number().int().min(0).meta({ description: `Bots entered; once it starts, the bots that played.` }),
        maxEntrants: z.number().int().min(tournamentBotsMin).max(tournamentMaxEntrants),
        winner: tournamentWinnerSchema.nullable().meta({ description: `The bot first in the final standings, once finished.` }),
        round: z
            .object({ current: z.number().int().min(1), of: z.number().int().min(1) })
            .nullable()
            .meta({ description: `While it runs, the round under way or the next to start, and how many there are; null otherwise.` }),
        endedAt: tournamentTime.optional().meta({ description: `When it ended: finished, stopped, cut short, called off, or canceled.` }),
        end: tournamentEndSchema.optional(),
        lead: tournamentLeadSchema.optional(),
        pair: tournamentPairSchema.optional().meta({ description: `A duel's bots, points, and games, as a row's score cells draw them.` }),
        leaders: tournamentLeadersSchema.optional().meta({ description: `A round robin's leaders, once a point is scored.` }),
        bot: tournamentPlaceSchema.optional(),
        yours: tournamentYoursSchema.optional(),
    })
    .meta({ id: `TournamentSummary`, description: kindDescription });
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;

export const tournamentQuotaSchema = z
    .object({
        live: z.number().int().min(0).max(tournamentLiveCap).meta({ description: `Duels and round robins the caller set up that run now, of ${String(tournamentLiveCap)}.` }),
        today: z.number().int().min(0).max(tournamentDailyCap).meta({ description: `Duels and round robins the caller set up this UTC day, of ${String(tournamentDailyCap)}.` }),
    })
    .meta({ id: `TournamentQuota` });
export type TournamentQuota = z.infer<typeof tournamentQuotaSchema>;

export const tournamentListSchema = z
    .object({
        running: z.array(tournamentSummarySchema).max(tournamentRunningListCap).meta({ description: `Every running one, the operator's first, then the newest.` }),
        scheduled: z.array(tournamentSummarySchema).max(tournamentWaitingCap).meta({ description: `Soonest first.` }),
        past: z.array(tournamentSummarySchema).max(tournamentListPastCap).meta({ description: `Finished, stopped, cut short, called off, or canceled, latest first.` }),
        quota: tournamentQuotaSchema.optional().meta({ description: `Present when mine names a signed-in caller, whose tournaments it counts.` }),
    })
    .meta({ id: `TournamentList` });
export type TournamentList = z.infer<typeof tournamentListSchema>;


export const tournamentRoundSchema = z
    .object({
        round: z.number().int().min(1),
        pairings: z.array(tournamentPairingSchema),
        rest: tournamentBotSchema.nullable().meta({ description: `The bot sitting the round out, in an odd field.` }),
    })
    .meta({ id: `TournamentRound` });
export type TournamentRound = z.infer<typeof tournamentRoundSchema>;

export const tournamentStandingSchema = z
    .object({
        rank: z.number().int().min(1),
        key: tournamentKeySchema,
        bot: z.string(),
        ownerName: z.string(),
        deleted: deletedMarkSchema.optional(),
        points: z.number().int().min(0),
        asX: z.number().int().min(0),
        asO: z.number().int().min(0),
        withdrawn: z.boolean(),
    })
    .meta({ id: `TournamentStanding` });
export type TournamentStanding = z.infer<typeof tournamentStandingSchema>;

export const tournamentEntryRequestSchema = z.strictObject({ bot: nameSyntaxSchema }).meta({ id: `TournamentEntryRequest` });
export type TournamentEntryRequest = z.infer<typeof tournamentEntryRequestSchema>;

export const tournamentWaitingSchema = z
    .object({ key: tournamentKeySchema, until: tournamentTime })
    .meta({ id: `TournamentWaiting`, description: `A bot a game waits for, and when it is scored a no-show unless it is ready.` });
export type TournamentWaiting = z.infer<typeof tournamentWaitingSchema>;

export const tournamentEstimateSchema = z
    .object({ key: tournamentKeySchema, estimate: estimateSchema })
    .meta({
        id: `TournamentEstimate`,
        description: `A test's estimate of one bot against all the others together: first is the bot, second the rest, counted by each pair's openings.`,
    });
export type TournamentEstimate = z.infer<typeof tournamentEstimateSchema>;

export const tournamentDetailSchema = z
    .object({
        id: tournamentIdSchema,
        name: z.string(),
        ...tournamentKindFields,
        status: tournamentStatusSchema,
        startsAt: tournamentTime,
        startedAt: tournamentTime.nullable(),
        endedAt: tournamentTime.nullable(),
        timeControl: timeControlSchema,
        openingPlies: openingPliesSchema,
        maxEntrants: z.number().int().min(tournamentBotsMin).max(tournamentMaxEntrants),
        entries: z.array(tournamentEntrySchema).meta({ description: `Every bot entered, its state, and once it starts, its rating then.` }),
        rounds: z.array(tournamentRoundSchema).meta({ description: `Every round with its pairings, drawn at the start.` }),
        standings: z.array(tournamentStandingSchema).meta({
            description: `One point per game won; a no-show or a withdrawal scores for the opponent; ties go to the points between the tied bots, then Sonneborn-Berger, and are otherwise shared.`,
        }),
        live: z.array(liveGameEntrySchema),
        end: tournamentEndSchema.optional(),
        waiting: z.array(tournamentWaitingSchema).meta({ description: `The bots the games about to start wait for.` }),
        nextRoundAt: tournamentTime.nullable().meta({ description: `When the next round starts, while it waits out the gap after the last; null otherwise.` }),
        estimates: z.array(tournamentEstimateSchema).optional().meta({ description: `A test's, one per bot in its field, once a game is over.` }),
    })
    .meta({
        id: `TournamentDetail`,
        description: [
            kindDescription,
            `A deleted bot reads as ${deletedBotName}, and a deleted owner as ${deletedPlayerName}; each bot's key tells two deleted bots apart.`,
        ].join(` `),
    });
export type TournamentDetail = z.infer<typeof tournamentDetailSchema>;

/** The tournament list's meta. */
export const tournamentsMeta: PageMeta = {
    title: pageTitle(`Tournaments`),
    description: `Bot duels and round robins on ${siteName}: the weekly tournament, rated, and those people set up, unrated`,
};

/** The Tournament place under Play, where an owner enters a bot in the next one and anyone signed in sets a duel or round robin up. */
export const playTournamentMeta: PageMeta = {
    title: pageTitle(`Tournament`),
    description: `Enter the weekly tournament, or set up a duel or round robin of bots`,
};

// A duel's state in a few words, its score the leader's points first.
function duelState(tournament: TournamentSummary, pair: TournamentPair): string {
    const leader = pair.first.points === pair.second.points ? null : pair.first.points > pair.second.points ? pair.first : pair.second;
    const score = `${String(Math.max(pair.first.points, pair.second.points))}-${String(Math.min(pair.first.points, pair.second.points))}`;
    switch (tournament.status) {
        case `running`:
            return leader === null ? `running, level at ${score}; ` : `running; ${leader.name} leads ${score}; `;
        case `finished`:
            return leader === null ? `ended level, ${score}; ` : `${leader.name} won ${score}; `;
        case `stopped`:
            return `stopped at ${score}; `;
        case `cut_short`:
            return `cut short at ${score}; `;
        case `canceled`:
            return `canceled; `;
        case `scheduled`:
        case `called_off`:
            return ``;
    }
}

/** A tournament's title, and a description that follows its state. */
export function tournamentMeta(tournament: TournamentSummary): PageMeta {
    const bots = `${String(tournament.entrants)} ${plural(tournament.entrants, `bot`, `bots`)}`;
    if (tournament.origin === `person`) {
        const tag = tournament.test ? `test` : `unrated`;
        const creator = tournament.createdBy ?? deletedPlayerName;
        const pair = tournament.pair;
        if (pair !== undefined) {
            const kind = tournament.test ? `Bot test` : `Bot duel`;
            const games = `${String(tournament.gamesPerPair)} ${plural(tournament.gamesPerPair, `game`, `games`)}`;
            return {
                title: pageTitle(`${pair.first.name} vs ${pair.second.name}`),
                description: `${kind} of ${games} between two bots, set up by ${creator}; ${duelState(tournament, pair)}${tag}`,
            };
        }
        const kind = tournament.test ? `Bot test` : `Bot round robin`;
        const round = tournament.round === null ? `` : `round ${String(tournament.round.current)} of ${String(tournament.round.of)} live; `;
        const state = {
            scheduled: ``,
            running: round,
            finished: tournament.winner === null ? `finished; ` : `${tournament.winner.name} won; `,
            called_off: ``,
            canceled: `canceled; `,
            stopped: `stopped; `,
            cut_short: `cut short; `,
        }[tournament.status];
        return { title: pageTitle(tournament.name), description: `${kind} of ${bots} set up by ${creator}; ${state}${tag}` };
    }
    const when = `${tournament.startsAt.slice(0, 10)} ${tournament.startsAt.slice(11, 16)} UTC`;
    const description = {
        scheduled: `Bot round robin; starts ${when}; ${String(tournament.entrants)} of ${String(tournament.maxEntrants)} bots entered; ${clockText(tournament.timeControl)}`,
        running: `Bot round robin of ${bots}, running now; ${clockText(tournament.timeControl)}`,
        finished: `Bot round robin of ${bots}${tournament.winner === null ? `` : `; ${tournament.winner.name} won`}`,
        called_off: `Bot round robin, called off at the start`,
        canceled: `Bot round robin, canceled`,
        stopped: `Bot round robin of ${bots}, stopped`,
        cut_short: `Bot round robin of ${bots}, cut short`,
    }[tournament.status];
    return { title: pageTitle(tournament.name), description };
}
