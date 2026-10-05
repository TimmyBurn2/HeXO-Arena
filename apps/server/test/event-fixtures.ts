import type { TimeControl } from '@hexo-arena/contract';
import { eq } from 'drizzle-orm';
import type { Query } from '../src/db';
import { bots, tournamentEntries, tournamentPairings, tournaments } from '../src/db/schema';
import type { BotGameTag } from '../src/game-store';

/** A duel as a test seeds it: its id, and its pairings by opening. */
export interface SeededDuel {
    readonly id: string;
    readonly legs: readonly string[];
}

/**
 * A duel stored as the setup stores one: a person's tournament of two,
 * running in a live slot, its first bot seated first and on x in each
 * opening's first game.
 */
export function seedDuel(
    query: Query,
    duel: {
        id: string;
        startedBy: string;
        first: string;
        second: string;
        games?: 1 | 2 | 4 | 6 | 8 | 10 | 20 | 30 | 50;
        test?: boolean;
        createdAt?: number;
        versions?: { first: string | null; second: string | null };
        timeControl?: TimeControl;
        liveSlot?: 1 | 2;
    },
): SeededDuel {
    const games = duel.games ?? 2;
    const createdAt = duel.createdAt ?? 1_790_000_000;
    query
        .insert(tournaments)
        .values({
            id: duel.id,
            name: null,
            origin: `person`,
            createdBy: duel.startedBy,
            status: `running`,
            startsAt: createdAt,
            startedAt: createdAt,
            timeControl: JSON.stringify(duel.timeControl ?? { mode: `turn`, turnTimeMs: 10_000 }),
            openingPlies: 5,
            maxEntrants: 2,
            rated: 0,
            test: duel.test === true ? 1 : 0,
            gamesPerPair: games,
            liveSlot: duel.liveSlot ?? 1,
            createdAt,
        })
        .run();
    const versions = duel.versions ?? { first: null, second: null };
    for (const [index, botId] of [duel.first, duel.second].entries()) {
        const ownerId = query.select({ ownerId: bots.ownerId }).from(bots).where(eq(bots.id, botId)).get()?.ownerId;
        if (ownerId === undefined) throw new Error(`a duel seats a bot no one holds: ${botId}`);
        query
            .insert(tournamentEntries)
            .values({
                tournamentId: duel.id,
                botId,
                ownerId,
                origin: `person`,
                state: `playing`,
                ratingAtStart: 1500,
                version: index === 0 ? versions.first : versions.second,
                seat: index + 1,
                enteredAt: createdAt,
            })
            .run();
    }
    const legs = Array.from({ length: Math.max(1, games / 2) }, (_, index) => `p_${duel.id}_${String(index + 1)}`);
    for (const [index, id] of legs.entries()) {
        query
            .insert(tournamentPairings)
            .values({ id, tournamentId: duel.id, round: 1, firstBotId: duel.first, secondBotId: duel.second, leg: index + 1, gamesPerPair: games, ...(games === 1 ? { game2: `none` } : {}) })
            .run();
    }
    return { id: duel.id, legs };
}

/** The tag of a duel's game by its number from 1, each opening's two games in turn. */
export function duelGame(duel: SeededDuel, game: number): BotGameTag {
    const pairingId = duel.legs[Math.ceil(game / 2) - 1];
    if (pairingId === undefined) throw new Error(`the duel plays no game ${String(game)}`);
    return { pairingId, game: game % 2 === 1 ? 1 : 2 };
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
                gamesPerPair: 2,
            })
            .run();
    }
}
