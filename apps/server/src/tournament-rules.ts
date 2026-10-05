import {
    openingPliesSchema,
    timeControlSchema,
    tournamentWeekdays,
    type AdminTournamentRule,
    type OpeningPlies,
    type TimeControl,
    type TournamentWeekday,
} from '@hexo-arena/contract';
import { and, asc, eq, min } from 'drizzle-orm';
import type { Query } from './db';
import { tournamentRules, tournaments } from './db/schema';

const daySeconds = 86_400;
const weekSeconds = 7 * daySeconds;

// When a weekly rule's tournaments start: weekday 0 is Monday, and the minute is UTC.
interface RuleSlot {
    readonly weekday: number;
    readonly minuteOfDay: number;
}

// A weekly rule as stored.
interface TournamentRule extends RuleSlot {
    readonly id: number;
    readonly namePattern: string;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly maxEntrants: number;
    readonly daysAhead: number;
}

type NewTournamentRule = Omit<TournamentRule, `id`>;

/** The slot of a weekday and an HH:MM time the request schema has checked. */
export function ruleSlot(weekday: TournamentWeekday, time: string): RuleSlot {
    const [hours = 0, minutes = 0] = time.split(`:`).map(Number);
    return { weekday: tournamentWeekdays.indexOf(weekday), minuteOfDay: hours * 60 + minutes };
}

// Day 0 of the epoch was a Thursday, three days after a Monday.
function weekdayOfDay(day: number): number {
    return (day + 3) % 7;
}

function firstStartAtOrAfter(slot: RuleSlot, fromSeconds: number): number {
    const day = Math.floor(fromSeconds / daySeconds);
    const start = (day + ((slot.weekday - weekdayOfDay(day) + 7) % 7)) * daySeconds + slot.minuteOfDay * 60;
    return start >= fromSeconds ? start : start + weekSeconds;
}

function firstStartAfterLead(slot: RuleSlot, nowMs: number, leadMs: number): number {
    return firstStartAtOrAfter(slot, Math.ceil((nowMs + leadMs) / 1000));
}

/**
 * The starts whose tournaments a rule creates now, soonest first:
 * each at least the lead away, with its entry window open.
 * A start already inside the lead never comes back,
 * so a server that was down or a clock that jumped skips that week
 * instead of creating its event late.
 */
export function dueRuleStarts(rule: TournamentRule, nowMs: number, leadMs: number): number[] {
    const starts: number[] = [];
    for (let start = firstStartAfterLead(rule, nowMs, leadMs); (start - rule.daysAhead * daySeconds) * 1000 <= nowMs; start += weekSeconds) {
        starts.push(start);
    }
    return starts;
}

/** Every weekly rule, in the order of the week. */
export function readTournamentRules(query: Query): TournamentRule[] {
    return query
        .select()
        .from(tournamentRules)
        .orderBy(asc(tournamentRules.weekday), asc(tournamentRules.minuteOfDay))
        .all()
        .map((row) => ({
            id: row.id,
            weekday: row.weekday,
            minuteOfDay: row.minuteOfDay,
            namePattern: row.namePattern,
            timeControl: timeControlSchema.parse(JSON.parse(row.timeControl)),
            openingPlies: openingPliesSchema.parse(row.openingPlies),
            maxEntrants: row.maxEntrants,
            daysAhead: row.daysAhead,
        }));
}

type AddTournamentRuleResult = { kind: `added`; id: number } | { kind: `same`; id: number } | { kind: `slot_taken`; id: number };

/** Adds a weekly rule unless one holds its slot already, answering that one as the same rule or another. */
export function addTournamentRule(query: Query, rule: NewTournamentRule, now: number): AddTournamentRuleResult {
    const timeControl = JSON.stringify(rule.timeControl);
    const holder = query
        .select()
        .from(tournamentRules)
        .where(and(eq(tournamentRules.weekday, rule.weekday), eq(tournamentRules.minuteOfDay, rule.minuteOfDay)))
        .get();
    if (holder !== undefined) {
        const same =
            holder.namePattern === rule.namePattern &&
            holder.timeControl === timeControl &&
            holder.openingPlies === rule.openingPlies &&
            holder.maxEntrants === rule.maxEntrants &&
            holder.daysAhead === rule.daysAhead;
        return { kind: same ? `same` : `slot_taken`, id: holder.id };
    }
    const { id } = query
        .insert(tournamentRules)
        .values({ ...rule, timeControl, createdAt: now })
        .returning({ id: tournamentRules.id })
        .get();
    return { kind: `added`, id };
}

type RemoveTournamentRuleResult = { kind: `removed`; waiting: string[] } | { kind: `not_found` };

/** Removes a weekly rule; the tournaments it created stay, and the waiting ones are answered. */
export function removeTournamentRule(query: Query, id: number): RemoveTournamentRuleResult {
    const waiting = query
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(and(eq(tournaments.ruleId, id), eq(tournaments.status, `scheduled`)))
        .orderBy(asc(tournaments.startsAt))
        .all()
        .map((row) => row.id);
    const removed = query.delete(tournamentRules).where(eq(tournamentRules.id, id)).run();
    return removed.changes === 0 ? { kind: `not_found` } : { kind: `removed`, waiting };
}

/** Whether a rule has its tournament for a start already, in any state. */
export function hasRuleTournament(query: Query, ruleId: number, startsAt: number): boolean {
    return (
        query
            .select({ id: tournaments.id })
            .from(tournaments)
            .where(and(eq(tournaments.ruleId, ruleId), eq(tournaments.startsAt, startsAt)))
            .get() !== undefined
    );
}

/**
 * A rule's next start: its soonest waiting tournament's,
 * or the first start at least the lead away that has no tournament yet,
 * whichever comes first.
 */
export function nextRuleStart(query: Query, rule: TournamentRule, nowMs: number, leadMs: number): number {
    const waiting = query
        .select({ startsAt: min(tournaments.startsAt) })
        .from(tournaments)
        .where(and(eq(tournaments.ruleId, rule.id), eq(tournaments.status, `scheduled`)))
        .get()?.startsAt;
    let start = firstStartAfterLead(rule, nowMs, leadMs);
    while (hasRuleTournament(query, rule.id, start)) start += weekSeconds;
    return waiting == null ? start : Math.min(waiting, start);
}

function timeOfDay(minuteOfDay: number): string {
    return [Math.floor(minuteOfDay / 60), minuteOfDay % 60].map((part) => String(part).padStart(2, `0`)).join(`:`);
}

/** The weekly rules as the admin status and list show them. */
export function adminTournamentRules(query: Query, nowMs: number, leadMs: number): AdminTournamentRule[] {
    return readTournamentRules(query).map((rule) => ({
        id: rule.id,
        // The weekday check holds the column to the seven indexes.
        weekday: tournamentWeekdays[rule.weekday] as TournamentWeekday,
        time: timeOfDay(rule.minuteOfDay),
        namePattern: rule.namePattern,
        timeControl: rule.timeControl,
        openingPlies: rule.openingPlies,
        maxEntrants: rule.maxEntrants,
        daysAhead: rule.daysAhead,
        nextStartsAt: nextRuleStart(query, rule, nowMs, leadMs),
    }));
}
