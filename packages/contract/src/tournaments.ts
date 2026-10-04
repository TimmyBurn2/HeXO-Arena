import { z } from 'zod';
import { botVersionSchema } from './api';
import { duelEstimateSchema } from './duels';
import { liveGameEntrySchema, scheduledClockSchema } from './games';
import { levelIdSchema, seatLevelSchema } from './levels';
import { clockText, pageTitle, plural, siteName, type PageMeta } from './meta';
import { deletedBotName, deletedMarkSchema, deletedPlayerName, nameKeyOf, nameMaxLength, nameSyntaxSchema } from './names';
import { openingPliesRequestSchema, openingPliesSchema, timeControlSchema, type TimeControl } from './stream';

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

/** The most bots a round robin a person sets up takes; the fewest is {@link tournamentMinPresent}. */
export const roundRobinMaxBots = 8;

/** The games each pair plays in a round robin a person sets up: one opening twice, or two. */
export const roundRobinGamesPerPair = [2, 4] as const;

/** The games each pair plays in a test, a round robin of one person's bots alone. */
export const roundRobinTestGamesPerPair = [2, 4, 6, 10] as const;

/** A round robin a person sets up plays one opening a pair unless asked for more. */
export const defaultRoundRobinGamesPerPair = 2;

/** Round robins one person runs at once; a unique index holds it. */
export const roundRobinLiveCap = 1;

/** Round robins one person sets up in a UTC day. */
export const roundRobinDailyCap = 3;

/** Openings one pair plays at most, each twice with the sides swapped: a test's ten games. */
export const tournamentLegsMax = 5;

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

export const tournamentIdSchema = z.string().regex(/^t_[a-z0-9]{12}$/);

export const tournamentStatusSchema = z.enum([`scheduled`, `running`, `finished`, `called_off`, `canceled`, `stopped`]);
export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;

export const tournamentOriginSchema = z.enum([`operator`, `person`]).meta({
    id: `TournamentOrigin`,
    description: `operator: a tournament the operator scheduled, which owners enter, rated. person: a round robin someone signed in set up from bots they picked, never rated.`,
});
export type TournamentOrigin = z.infer<typeof tournamentOriginSchema>;

// zod takes a numeric enum as an object, so the keys are names only; an
// enum renders as an integer enum in OpenAPI, where a literal list does not.
export const tournamentGamesPerPairSchema = z.enum({ two: 2, four: 4, six: 6, ten: 10 }).meta({
    id: `TournamentGamesPerPair`,
    description: `The games each pair plays: each opening twice, sides swapped. More than 4 only in a test, where one person owns every bot.`,
});
export type TournamentGamesPerPair = z.infer<typeof tournamentGamesPerPairSchema>;

/** A round robin a person set up, named for them, since no one names one freely. */
export function roundRobinName(createdBy: string): string {
    return `Round robin by ${createdBy}`;
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
export const tournamentPath = `/api/tournaments/{id}`;
export const tournamentEntryPath = `/api/tournaments/{id}/entry`;
export const tournamentExportPath = `/api/tournaments/{id}/export`;
export const tournamentStopPath = `/api/tournaments/{id}/stop`;
export const tournamentWithdrawPath = `/api/tournaments/{id}/withdraw`;

export const roundRobinBotSchema = z
    .strictObject({
        name: nameSyntaxSchema,
        level: levelIdSchema.optional().meta({ description: `The bot's declared level to play at, its default when absent.` }),
    })
    .meta({ id: `RoundRobinBot` });
export type RoundRobinBot = z.infer<typeof roundRobinBotSchema>;

// Restating the component id keeps the $ref and renders this default beside it.
export const createRoundRobinRequestSchema = z
    .strictObject({
        bots: z.array(roundRobinBotSchema).min(tournamentMinPresent).max(roundRobinMaxBots),
        gamesPerPair: tournamentGamesPerPairSchema.default(defaultRoundRobinGamesPerPair).meta({ id: `TournamentGamesPerPair`, default: defaultRoundRobinGamesPerPair }),
        openingPlies: openingPliesRequestSchema,
        timeControl: timeControlSchema,
    })
    .refine((request) => new Set(request.bots.map((bot) => nameKeyOf(bot.name))).size === request.bots.length, { message: `the bots are distinct`, path: [`bots`] })
    .refine((request) => scheduledClockSchema.safeParse(request.timeControl).success, { message: `a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s`, path: [`timeControl`] })
    .refine((request) => request.openingPlies > 1 || request.gamesPerPair === 2, { message: `a 1-ply opening allows one opening a pair` })
    .meta({
        id: `CreateRoundRobinRequest`,
        description: [
            `${String(tournamentMinPresent)} to ${String(roundRobinMaxBots)} distinct bots.`,
            `The clock is a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s, never unlimited.`,
            `A 1-ply opening allows one opening a pair, since a bot that plays alike every time would replay the bare origin identically.`,
        ].join(` `),
    });
export type CreateRoundRobinRequest = z.infer<typeof createRoundRobinRequestSchema>;

// Each bot's gates in the caller's order, then the round robin's own limits:
// a length only a test takes, and the caller's running round robin.
export const roundRobinCreateErrorCodes = [`not_open`, `duel_refused`, `clock_not_accepted`, `unknown_level`, `bot_busy`, `test_only`, `round_robin_busy`] as const;

// A delisted bot, or one whose owner is banned, plays no new round robin.
export const roundRobinForbiddenErrorCodes = [`delisted`, `banned`] as const;

// The daily cap, which the UTC day's turn lifts, so it answers 429 with the wait.
export const roundRobinQuotaErrorCodes = [`daily_round_robin_cap`] as const;

// Only the person who set a round robin up stops it, and only while it runs.
export const tournamentStopForbiddenErrorCodes = [`not_yours`] as const;
export const tournamentStopConflictErrorCodes = [`over`] as const;

// Only a bot's owner withdraws it, and only while it plays a running round robin.
export const tournamentWithdrawForbiddenErrorCodes = [`not_owner`] as const;
export const tournamentWithdrawConflictErrorCodes = [`over`, `not_playing`] as const;

export const tournamentWithdrawRequestSchema = z.strictObject({ bot: nameSyntaxSchema }).meta({ id: `TournamentWithdrawRequest` });
export type TournamentWithdrawRequest = z.infer<typeof tournamentWithdrawRequestSchema>;

/** The most games one tournament plays: every pair of the weekly's largest field meets twice, more than a round robin a person sets up holds. */
export const tournamentGamesMax = tournamentMaxEntrants * (tournamentMaxEntrants - 1);

/** Tournaments the list holds: the running one, the next waiting ones, the latest over. */
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
export type TournamentEntryState = z.infer<typeof tournamentEntryStateSchema>;

export const tournamentEntryReasonSchema = z.enum([`daily_cap`, `clock`, `missed`, `banned`, `delisted`, `deleted`, `owner`, `refused`, `tournament`]);
export type TournamentEntryReason = z.infer<typeof tournamentEntryReasonSchema>;

const entryReasonDescription = [
    `Why a bot was left out at the start (daily_cap: too few bot games left that day; clock: it does not accept the clock)`,
    `or withdrawn (missed: two pairings missed in a row; banned, delisted, deleted; and from a round robin a person set up,`,
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
        .meta({ param: { description: `Present as 1, only the round robins the signed-in caller set up and the tournaments one of their bots plays; none for a caller signed out.` } }),
    kind: z.literal(`test`).optional().meta({ param: { description: `Only tests, round robins of one person's bots.` } }),
});
export type TournamentListQuery = z.infer<typeof tournamentListQuerySchema>;

// Shared by the list and the detail, so their descriptions live on the
// two components rather than on fields the document would repeat.
const tournamentKindFields = {
    origin: tournamentOriginSchema,
    createdBy: z.string().nullable(),
    rated: z.boolean(),
    test: z.boolean(),
    gamesPerPair: tournamentGamesPerPairSchema,
};

const kindDescription = [
    `createdBy names who set a person's round robin up, ${deletedPlayerName} once their account is deleted, and is null on the operator's, whose name the operator chose;`,
    `a person's is named for its creator.`,
    `test: one person owns every bot.`,
].join(` `);

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
        maxEntrants: z.number().int().min(tournamentMinPresent).max(tournamentMaxEntrants),
        winner: tournamentWinnerSchema.nullable().meta({ description: `The bot first in the final standings, once finished.` }),
        round: z
            .object({ current: z.number().int().min(1), of: z.number().int().min(1) })
            .nullable()
            .meta({ description: `While it runs, the round under way or the next to start, and how many there are; null otherwise.` }),
        endedAt: tournamentTime.optional().meta({ description: `When it ended: finished, called off, or canceled.` }),
        bot: tournamentPlaceSchema.optional(),
        yours: tournamentYoursSchema.optional(),
    })
    .meta({ id: `TournamentSummary`, description: kindDescription });
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;

export const tournamentQuotaSchema = z
    .object({
        live: z.number().int().min(0).max(roundRobinLiveCap).meta({ description: `Round robins the caller set up that run now, of ${String(roundRobinLiveCap)}.` }),
        today: z.number().int().min(0).max(roundRobinDailyCap).meta({ description: `Round robins the caller set up this UTC day, of ${String(roundRobinDailyCap)}.` }),
    })
    .meta({ id: `TournamentQuota` });
export type TournamentQuota = z.infer<typeof tournamentQuotaSchema>;

export const tournamentListSchema = z
    .object({
        running: z.array(tournamentSummarySchema).max(tournamentRunningListCap).meta({ description: `Every running one, the operator's first, then the newest.` }),
        scheduled: z.array(tournamentSummarySchema).max(tournamentWaitingCap).meta({ description: `Soonest first.` }),
        past: z.array(tournamentSummarySchema).max(tournamentListPastCap).meta({ description: `Finished, stopped, called off, or canceled, latest first.` }),
        quota: tournamentQuotaSchema.optional().meta({ description: `Present when mine names a signed-in caller, whose round robins it counts.` }),
    })
    .meta({ id: `TournamentList` });
export type TournamentList = z.infer<typeof tournamentListSchema>;

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
    })
    .meta({
        id: `TournamentEntry`,
        description: `level is present on a bot a round robin plays at a level other than its default, whose rating at the start is then null; version, where the bot declared one as a round robin began.`,
    });
export type TournamentEntry = z.infer<typeof tournamentEntrySchema>;

export const tournamentGameOutcomeSchema = z.enum([`pending`, `live`, `played`, `no_show`, `forfeit`, `not_played`, `aborted`]);
export type TournamentGameOutcome = z.infer<typeof tournamentGameOutcomeSchema>;

export const tournamentGameSchema = z
    .object({
        x: tournamentKeySchema.meta({ description: `The bot playing x: the pairing's first in game 1, its second in game 2.` }),
        gameId: z.string().nullable(),
        outcome: tournamentGameOutcomeSchema,
        point: tournamentKeySchema.nullable().meta({ description: `The bot the game scored for: the winner, or the bot that came or stayed when the other did not.` }),
        missing: z.array(tournamentKeySchema).meta({ description: `The bots that did not show for a no-show, or were withdrawn for a forfeit.` }),
    })
    .meta({ id: `TournamentGame` });
export type TournamentGame = z.infer<typeof tournamentGameSchema>;

export const tournamentPairingSchema = z
    .object({
        first: tournamentBotSchema,
        second: tournamentBotSchema,
        games: z
            .array(tournamentGameSchema)
            .min(2)
            .max(2 * tournamentLegsMax)
            .meta({ description: `Its games in order: each opening twice, the first bot on x and then the second, and the next opening once both are over.` }),
    })
    .meta({ id: `TournamentPairing` });
export type TournamentPairing = z.infer<typeof tournamentPairingSchema>;

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

export const tournamentEndSchema = z
    .object({
        reason: z.enum([`creator`, `banned`, `deleted`, `operator`]).meta({
            description: `Stopped by the person who set it up (creator), or as their account was banned or deleted; or canceled by the operator.`,
        }),
        round: z.number().int().min(1).nullable().meta({ description: `The round under way, or the last one begun; null before any.` }),
    })
    .meta({ id: `TournamentEnd`, description: `Why a tournament ended before its last game: stopped or canceled.` });
export type TournamentEnd = z.infer<typeof tournamentEndSchema>;

export const tournamentWaitingSchema = z
    .object({ key: tournamentKeySchema, until: tournamentTime })
    .meta({ id: `TournamentWaiting`, description: `A bot a game waits for, and when it is scored a no-show unless it is ready.` });
export type TournamentWaiting = z.infer<typeof tournamentWaitingSchema>;

export const tournamentEstimateSchema = z
    .object({ key: tournamentKeySchema, estimate: duelEstimateSchema })
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
        maxEntrants: z.number().int().min(tournamentMinPresent).max(tournamentMaxEntrants),
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
    description: `Bot round robins on ${siteName}: the weekly tournament, rated, and those people set up, unrated`,
};

/** The Tournament place under Play, where an owner enters a bot in the next one and anyone signed in sets a round robin up. */
export const playTournamentMeta: PageMeta = {
    title: pageTitle(`Tournament`),
    description: `Enter the weekly tournament, or set up a round robin of bots`,
};

/** A tournament's title, and a description that follows its state. */
export function tournamentMeta(tournament: TournamentSummary): PageMeta {
    const bots = `${String(tournament.entrants)} ${plural(tournament.entrants, `bot`, `bots`)}`;
    if (tournament.origin === `person`) {
        const kind = tournament.test ? `Bot test` : `Bot round robin`;
        const tag = tournament.test ? `test` : `unrated`;
        const round = tournament.round === null ? `` : `round ${String(tournament.round.current)} of ${String(tournament.round.of)} live; `;
        const state = {
            scheduled: ``,
            running: round,
            finished: tournament.winner === null ? `finished; ` : `${tournament.winner.name} won; `,
            called_off: ``,
            canceled: `canceled; `,
            stopped: `stopped; `,
        }[tournament.status];
        return { title: pageTitle(tournament.name), description: `${kind} of ${bots} set up by ${tournament.createdBy ?? deletedPlayerName}; ${state}${tag}` };
    }
    const when = `${tournament.startsAt.slice(0, 10)} ${tournament.startsAt.slice(11, 16)} UTC`;
    const description = {
        scheduled: `Bot round robin; starts ${when}; ${String(tournament.entrants)} of ${String(tournament.maxEntrants)} bots entered; ${clockText(tournament.timeControl)}`,
        running: `Bot round robin of ${bots}, running now; ${clockText(tournament.timeControl)}`,
        finished: `Bot round robin of ${bots}${tournament.winner === null ? `` : `; ${tournament.winner.name} won`}`,
        called_off: `Bot round robin, called off at the start`,
        canceled: `Bot round robin, canceled`,
        stopped: `Bot round robin of ${bots}, stopped`,
    }[tournament.status];
    return { title: pageTitle(tournament.name), description };
}
