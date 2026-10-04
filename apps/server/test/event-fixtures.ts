import type { TimeControl } from '@hexo-arena/contract';
import type { Query } from '../src/db';
import { tournamentEntries, tournamentPairings, tournaments } from '../src/db/schema';
import { insertDuel, type DuelKey } from '../src/duel-store';

/** A duel stored as the setup stores one, its first bot playing x in game 1. */
export function seedDuel(
    query: Query,
    duel: {
        startedBy: string;
        first: string;
        second: string;
        games?: 1 | 2 | 4 | 6 | 8 | 10 | 20 | 30 | 50;
        test?: boolean;
        createdAt?: number;
        versions?: { first: string | null; second: string | null };
        timeControl?: TimeControl;
    },
): string {
    // The pair is stored in one order, its ids sorted.
    const firstIsA = duel.first < duel.second;
    const firstKey: DuelKey = firstIsA ? `a` : `b`;
    const versions = duel.versions ?? { first: null, second: null };
    return insertDuel(query, {
        startedBy: duel.startedBy,
        botIds: firstIsA ? { a: duel.first, b: duel.second } : { a: duel.second, b: duel.first },
        first: firstKey,
        xInGame1: firstKey,
        test: duel.test ?? false,
        games: duel.games ?? 2,
        timeControl: duel.timeControl ?? { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        levels: { a: null, b: null },
        ratings: { a: 1500, b: 1500 },
        versions: firstIsA ? { a: versions.first, b: versions.second } : { a: versions.second, b: versions.first },
        rated: false,
        createdAt: duel.createdAt ?? 1_790_000_000,
    });
}

/** A pairing as stored: its round, its two bots, and each game's state and seat. */
export interface SeededPairing {
    readonly id: string;
    readonly round: number;
    readonly first: string;
    readonly second: string;
    readonly game1?: string;
    readonly game1Seat?: `first` | `second` | `both` | null;
    readonly game2?: string;
    readonly game2Seat?: `first` | `second` | `both` | null;
}

/** A tournament with its entries and pairings, written as the scheduler leaves them; times in seconds. */
export function seedTournament(
    query: Query,
    tournament: {
        id: string;
        name: string;
        status: `scheduled` | `running` | `finished` | `called_off` | `canceled`;
        startsAt: number;
        endedAt?: number;
        entries: readonly { botId: string; ownerId: string; state: string; reason?: string; enteredAt?: number }[];
        pairings?: readonly SeededPairing[];
        timeControl?: TimeControl;
    },
): void {
    const started = tournament.status === `running` || tournament.status === `finished`;
    query
        .insert(tournaments)
        .values({
            id: tournament.id,
            name: tournament.name,
            status: tournament.status,
            startsAt: tournament.startsAt,
            timeControl: JSON.stringify(tournament.timeControl ?? { mode: `turn`, turnTimeMs: 10_000 }),
            openingPlies: 5,
            maxEntrants: 12,
            createdAt: tournament.startsAt - 86_400,
            startedAt: started ? tournament.startsAt : null,
            endedAt: tournament.status === `scheduled` || tournament.status === `running` ? null : (tournament.endedAt ?? tournament.startsAt + 3_600),
        })
        .run();
    for (const [index, entry] of tournament.entries.entries()) {
        query
            .insert(tournamentEntries)
            .values({
                tournamentId: tournament.id,
                botId: entry.botId,
                ownerId: entry.ownerId,
                state: entry.state,
                reason: entry.reason ?? null,
                ratingAtStart: started ? 1500 : null,
                enteredAt: entry.enteredAt ?? tournament.startsAt - 3_600 + index,
            })
            .run();
    }
    for (const pairing of tournament.pairings ?? []) {
        query
            .insert(tournamentPairings)
            .values({
                id: pairing.id,
                tournamentId: tournament.id,
                round: pairing.round,
                firstBotId: pairing.first,
                secondBotId: pairing.second,
                game1: pairing.game1 ?? `pending`,
                game1Seat: pairing.game1Seat ?? null,
                game2: pairing.game2 ?? `pending`,
                game2Seat: pairing.game2Seat ?? null,
            })
            .run();
    }
}
