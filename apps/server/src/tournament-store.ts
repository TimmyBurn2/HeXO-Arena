import {
    deletedPlayerName,
    roundRobinName,
    tournamentHorizonMs,
    tournamentWaitingCap,
    type AdminTournament,
    type OpeningPlies,
    type SeatLevel,
    type TimeControl,
    type TournamentGamesPerPair,
    type TournamentStatus,
} from '@hexo-arena/contract';
import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Query } from './db';
import { tournamentEntries, tournamentPairings, tournaments, users } from './db/schema';
import { shortId } from './random';
import { roundRobin } from './round-robin';
import { shownUser } from './shown-names';

interface NewTournament {
    readonly name: string;
    readonly startsAt: number;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly maxEntrants: number;
    readonly ruleId?: number;
}

type CreateTournamentResult =
    | { kind: `created`; id: string }
    | { kind: `too_soon` }
    | { kind: `too_far` }
    | { kind: `waiting_full` };

/**
 * Schedules a tournament between the lead and the horizon from now, while
 * fewer than the cap are waiting; times are in seconds.
 */
export function createTournament(query: Query, tournament: NewTournament, now: number, leadMs: number): CreateTournamentResult {
    if (tournament.startsAt * 1000 < now * 1000 + leadMs) return { kind: `too_soon` };
    if (tournament.startsAt * 1000 > now * 1000 + tournamentHorizonMs) return { kind: `too_far` };
    const waiting = query.select({ n: count() }).from(tournaments).where(eq(tournaments.status, `scheduled`)).get()?.n ?? 0;
    if (waiting >= tournamentWaitingCap) return { kind: `waiting_full` };
    const id = shortId(`t_`);
    query
        .insert(tournaments)
        .values({
            id,
            name: tournament.name,
            status: `scheduled`,
            startsAt: tournament.startsAt,
            timeControl: JSON.stringify(tournament.timeControl),
            openingPlies: tournament.openingPlies,
            maxEntrants: tournament.maxEntrants,
            createdAt: now,
            ruleId: tournament.ruleId ?? null,
        })
        .run();
    return { kind: `created`, id };
}

/** A bot a person picked for a round robin, as it stood at the start. */
export interface RoundRobinEntrant {
    readonly botId: string;
    readonly ownerId: string;
    readonly name: string;
    readonly rating: number;
    readonly level: SeatLevel | null;
    readonly version: string | null;
}

interface NewRoundRobin {
    readonly createdBy: string;
    readonly entrants: readonly RoundRobinEntrant[];
    readonly test: boolean;
    readonly gamesPerPair: TournamentGamesPerPair;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
}

/**
 * Stores a person's round robin as running from now, with its field and
 * every pairing drawn: the circle method over the bots by rating, ties by
 * name, and one row per opening each pair plays. Times are in seconds.
 */
export function insertRoundRobin(query: Query, values: NewRoundRobin, now: number): string {
    const id = shortId(`t_`);
    query
        .insert(tournaments)
        .values({
            id,
            name: null,
            origin: `person`,
            createdBy: values.createdBy,
            status: `running`,
            startsAt: now,
            startedAt: now,
            timeControl: JSON.stringify(values.timeControl),
            openingPlies: values.openingPlies,
            maxEntrants: values.entrants.length,
            rated: 0,
            test: values.test ? 1 : 0,
            gamesPerPair: values.gamesPerPair,
            createdAt: now,
        })
        .run();
    for (const entrant of values.entrants) {
        query
            .insert(tournamentEntries)
            .values({
                tournamentId: id,
                botId: entrant.botId,
                ownerId: entrant.ownerId,
                origin: `person`,
                state: `playing`,
                ratingAtStart: entrant.rating,
                level: entrant.level === null ? null : JSON.stringify(entrant.level),
                version: entrant.version,
                enteredAt: now,
            })
            .run();
    }
    const order = [...values.entrants].sort((one, two) => two.rating - one.rating || one.name.localeCompare(two.name)).map((entrant) => entrant.botId);
    insertPairings(query, id, order, values.gamesPerPair / 2);
    return id;
}

/** Draws a field's pairings: the first bot of the order takes the schedule's fixed seat, and each pair meets once per leg. */
export function insertPairings(query: Query, tournamentId: string, order: readonly string[], legs: number): void {
    for (const round of roundRobin(order)) {
        for (const pairing of round.pairings) {
            for (let leg = 1; leg <= legs; leg++) {
                query
                    .insert(tournamentPairings)
                    .values({ id: `p_${randomUUID()}`, tournamentId, round: round.round, firstBotId: pairing.first, secondBotId: pairing.second, leg })
                    .run();
            }
        }
    }
}

type CancelTournamentResult = { kind: `canceled`; status: TournamentStatus } | { kind: `over` } | { kind: `not_found` };

/** Ends a waiting or running tournament as canceled, answering the status it had. */
export function cancelTournament(query: Query, id: string, now: number): CancelTournamentResult {
    const row = query.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)).get();
    if (row === undefined) return { kind: `not_found` };
    if (row.status !== `scheduled` && row.status !== `running`) return { kind: `over` };
    query
        .update(tournaments)
        .set({ status: `canceled`, endedAt: now })
        .where(and(eq(tournaments.id, id), isNull(tournaments.endedAt)))
        .run();
    // The status check admits only these values.
    return { kind: `canceled`, status: row.status as TournamentStatus };
}

/** Why a person's round robin was stopped. */
export type StopReason = `creator` | `banned` | `deleted`;

/** Stops a running round robin a person set up; answers whether it was running. */
export function stopRoundRobin(query: Query, id: string, reason: StopReason, now: number): boolean {
    return (
        query
            .update(tournaments)
            .set({ status: `stopped`, endReason: reason, endedAt: now })
            .where(and(eq(tournaments.id, id), eq(tournaments.origin, `person`), eq(tournaments.status, `running`)))
            .run().changes === 1
    );
}

/** The users table as a tournament's creator, so a query that joins a game's person as well can join both. */
export const creators = alias(users, `creators`);

/** The columns a tournament's name is built from, beside a left join of its creator. */
export const nameColumns = {
    name: tournaments.name,
    creatorName: creators.name,
    creatorDeletedAt: creators.deletedAt,
};

/** The join a tournament's name needs. */
export const creatorJoin = eq(creators.id, tournaments.createdBy);

/** What names a tournament: the operator's own name, or a person's round robin's creator. */
export interface NameParts {
    readonly name: string | null;
    readonly creatorName: string | null;
    readonly creatorDeletedAt: number | null;
}

/** Who set a person's round robin up, as public answers name them; a creator whose account is gone reads as the deleted placeholder. */
export function creatorOf(parts: NameParts): string {
    return parts.creatorName === null ? deletedPlayerName : shownUser(parts.creatorName, parts.creatorDeletedAt).name;
}

/** A tournament's name: the operator's as written, a person's round robin's built from its creator. */
export function tournamentNameOf(parts: NameParts): string {
    return parts.name ?? roundRobinName(creatorOf(parts));
}

/** The running and waiting tournaments, soonest first, with their entry counts. */
export function openTournaments(query: Query): AdminTournament[] {
    const entrants = sql<number>`(select count(*) from ${tournamentEntries} where ${tournamentEntries.tournamentId} = ${tournaments.id})`;
    return query
        .select({ id: tournaments.id, ...nameColumns, status: tournaments.status, startsAt: tournaments.startsAt, entrants })
        .from(tournaments)
        .leftJoin(creators, creatorJoin)
        .where(inArray(tournaments.status, [`scheduled`, `running`]))
        .orderBy(asc(tournaments.startsAt))
        .all()
        // The status check admits only the contract's statuses.
        .map((row) => ({ id: row.id, name: tournamentNameOf(row), status: row.status as TournamentStatus, startsAt: row.startsAt, entrants: row.entrants }));
}

const runningPerson = and(eq(tournaments.origin, `person`), eq(tournaments.status, `running`));

/** Every running round robin a person set up, as the operator's status counts them. */
export function countRunningRoundRobins(query: Query): number {
    return query.select({ n: count() }).from(tournaments).where(runningPerson).get()?.n ?? 0;
}

/** The running round robins one person set up. */
export function countRunningRoundRobinsBy(query: Query, userId: string): number {
    return query.select({ n: count() }).from(tournaments).where(and(runningPerson, eq(tournaments.createdBy, userId))).get()?.n ?? 0;
}

/** The round robins one person set up since an epoch second, over or not. */
export function countRoundRobinsSince(query: Query, userId: string, sinceSeconds: number): number {
    return query.select({ n: count() }).from(tournaments).where(and(eq(tournaments.createdBy, userId), gte(tournaments.createdAt, sinceSeconds))).get()?.n ?? 0;
}

/** The running round robins people set up that a bot still plays in. */
export function countRunningRoundRobinsOfBot(query: Query, botId: string): number {
    return (
        query
            .select({ n: count() })
            .from(tournamentEntries)
            .innerJoin(tournaments, eq(tournaments.id, tournamentEntries.tournamentId))
            .where(and(runningPerson, eq(tournamentEntries.botId, botId), eq(tournamentEntries.state, `playing`)))
            .get()?.n ?? 0
    );
}

/** The running round robins a person set up. */
export function runningRoundRobinsBy(query: Query, userId: string): string[] {
    return query
        .select({ id: tournaments.id })
        .from(tournaments)
        .where(and(runningPerson, eq(tournaments.createdBy, userId)))
        .all()
        .map((row) => row.id);
}
