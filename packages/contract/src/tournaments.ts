import { z } from 'zod';
import { liveGameEntrySchema } from './games';
import { clockText, pageTitle, plural, siteName, type PageMeta } from './meta';
import { deletedBotName, deletedMarkSchema, deletedPlayerName, nameSyntaxSchema } from './names';
import { openingPliesSchema, timeControlSchema, type TimeControl } from './stream';

/** Bots that must be connected at the start, or the tournament is called off. */
export const tournamentMinPresent = 3;

/** Entries one tournament takes at most, and the default cap the operator sets. */
export const tournamentMaxEntrants = 12;

/** How long a game waits for a bot that is not connected before it counts as a no-show. */
export const tournamentPresenceGraceMs = 60_000;

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

/** The turn clock a tournament takes, and its default. */
export const tournamentTurnMs = { min: 5_000, max: 60_000, default: 10_000 } as const;

/** The match clock a tournament takes: main time and increment. */
export const tournamentMainMs = { min: 60_000, max: 600_000 } as const;
export const tournamentIncrementMs = { min: 0, max: 10_000 } as const;

/** The default opening of a tournament's games. */
export const defaultTournamentOpening = 5 as const;

// Printable ASCII, no space at either end.
export const tournamentNameSchema = z
    .string()
    .min(3)
    .max(40)
    .regex(/^[!-~](?:[ -~]*[!-~])?$/);

export const tournamentIdSchema = z.string().regex(/^t_[a-z0-9]{12}$/);

/** A tournament's clock: a turn or match clock in the tournament bounds, never unlimited. */
export const tournamentClockSchema = timeControlSchema.refine(
    (clock: TimeControl) =>
        clock.mode === `turn`
            ? clock.turnTimeMs >= tournamentTurnMs.min && clock.turnTimeMs <= tournamentTurnMs.max
            : clock.mode === `match` &&
              clock.mainTimeMs >= tournamentMainMs.min &&
              clock.mainTimeMs <= tournamentMainMs.max &&
              clock.incrementMs >= tournamentIncrementMs.min &&
              clock.incrementMs <= tournamentIncrementMs.max,
    { message: `a turn clock of 5 to 60 s, or a match clock of 1 to 10 min plus 0 to 10 s` },
);

export const tournamentStatusSchema = z.enum([`scheduled`, `running`, `finished`, `called_off`, `canceled`]);
export type TournamentStatus = z.infer<typeof tournamentStatusSchema>;

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

export const tournamentSummarySchema = z
    .object({
        id: tournamentIdSchema,
        name: z.string(),
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
    })
    .meta({ id: `TournamentSummary` });
export type TournamentSummary = z.infer<typeof tournamentSummarySchema>;

export const tournamentListSchema = z
    .object({
        running: tournamentSummarySchema.nullable(),
        scheduled: z.array(tournamentSummarySchema).max(tournamentWaitingCap).meta({ description: `Soonest first.` }),
        past: z.array(tournamentSummarySchema).max(tournamentListPastCap).meta({ description: `Finished, called off, or canceled, latest first.` }),
    })
    .meta({ id: `TournamentList` });
export type TournamentList = z.infer<typeof tournamentListSchema>;

export const tournamentEntryStateSchema = z.enum([`entered`, `playing`, `absent`, `left_out`, `withdrawn`]);
export type TournamentEntryState = z.infer<typeof tournamentEntryStateSchema>;

export const tournamentEntryReasonSchema = z.enum([`daily_cap`, `clock`, `missed`, `banned`, `delisted`, `deleted`]);
export type TournamentEntryReason = z.infer<typeof tournamentEntryReasonSchema>;

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
        reason: tournamentEntryReasonSchema.optional().meta({
            description: `Why a bot was left out at the start (daily_cap: too few bot games left that day; clock: it does not accept the clock) or withdrawn (missed: two pairings missed in a row; banned, delisted, deleted).`,
        }),
    })
    .meta({ id: `TournamentEntry` });
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
        games: z.array(tournamentGameSchema).length(2),
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

export const tournamentDetailSchema = z
    .object({
        id: tournamentIdSchema,
        name: z.string(),
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
    })
    .meta({
        id: `TournamentDetail`,
        description: `A deleted bot reads as ${deletedBotName}, and a deleted owner as ${deletedPlayerName}; each bot's key tells two deleted bots apart.`,
    });
export type TournamentDetail = z.infer<typeof tournamentDetailSchema>;

/** The tournament list's meta. */
export const tournamentsMeta: PageMeta = {
    title: pageTitle(`Tournaments`),
    description: `Bot round robins on ${siteName}: each pair plays one opening twice, sides swapped`,
};

/** A tournament's title, and a description that follows its state. */
export function tournamentMeta(tournament: TournamentSummary): PageMeta {
    const bots = `${String(tournament.entrants)} ${plural(tournament.entrants, `bot`, `bots`)}`;
    const when = `${tournament.startsAt.slice(0, 10)} ${tournament.startsAt.slice(11, 16)} UTC`;
    const description = {
        scheduled: `Bot round robin; starts ${when}; ${String(tournament.entrants)} of ${String(tournament.maxEntrants)} bots entered; ${clockText(tournament.timeControl)}`,
        running: `Bot round robin of ${bots}, running now; ${clockText(tournament.timeControl)}`,
        finished: `Bot round robin of ${bots}${tournament.winner === null ? `` : `; ${tournament.winner.name} won`}`,
        called_off: `Bot round robin, called off at the start`,
        canceled: `Bot round robin, canceled`,
    }[tournament.status];
    return { title: pageTitle(tournament.name), description };
}
