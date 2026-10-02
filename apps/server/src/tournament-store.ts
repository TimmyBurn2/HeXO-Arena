import {
    tournamentHorizonMs,
    tournamentWaitingCap,
    type AdminTournament,
    type OpeningPlies,
    type TimeControl,
    type TournamentStatus,
} from '@hexo-arena/contract';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Query } from './db';
import { tournamentEntries, tournaments } from './db/schema';
import { randomIndex } from './random';

// Lowercase letters and digits without the look-alikes, as a tournament's
// address carries them.
const idAlphabet = `abcdefghijkmnopqrstuvwxyz0123456789`;

function tournamentId(): string {
    return `t_${Array.from({ length: 12 }, () => idAlphabet[randomIndex(idAlphabet.length)] ?? `a`).join(``)}`;
}

export interface NewTournament {
    readonly name: string;
    readonly startsAt: number;
    readonly timeControl: TimeControl;
    readonly openingPlies: OpeningPlies;
    readonly maxEntrants: number;
    readonly ruleId?: number;
}

export type CreateTournamentResult =
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
    const id = tournamentId();
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

export type CancelTournamentResult = { kind: `canceled`; status: TournamentStatus } | { kind: `over` } | { kind: `not_found` };

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

/** The running and waiting tournaments, soonest first, with their entry counts. */
export function openTournaments(query: Query): AdminTournament[] {
    const entrants = sql<number>`(select count(*) from ${tournamentEntries} where ${tournamentEntries.tournamentId} = ${tournaments.id})`;
    return query
        .select({ id: tournaments.id, name: tournaments.name, status: tournaments.status, startsAt: tournaments.startsAt, entrants })
        .from(tournaments)
        .where(inArray(tournaments.status, [`scheduled`, `running`]))
        .orderBy(asc(tournaments.startsAt))
        .all()
        // The status check admits only the contract's statuses.
        .map((row) => ({ ...row, status: row.status as TournamentStatus }));
}
