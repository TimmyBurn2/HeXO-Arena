import type { LeaderboardQuery, Side, StreamPlayer } from '@hexarena/contract';
import { and, asc, desc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Query } from './db';
import { bots, games, ratings, users } from './db/schema';
import {
    foldRatings,
    isProvisional,
    playerKey,
    rankableDeviation,
    rateGame,
    seedRating,
    type FinishedGame,
    type PlayerRating,
    type PlayerRef,
    type RatedPlayer,
} from './rating';

/**
 * The games columns that name who sat where and who won.
 */
export const seatColumns = {
    userId: games.userId,
    botId: games.botId,
    userSide: games.userSide,
    challengerBotId: games.challengerBotId,
    destBotId: games.destBotId,
    challengerSide: games.challengerSide,
    winner: games.winner,
};

export interface SeatRow {
    userId: string | null;
    botId: string | null;
    userSide: string | null;
    challengerBotId: string | null;
    destBotId: string | null;
    challengerSide: string | null;
    winner: string | null;
}

function seated(firstSide: Side, first: PlayerRef, second: PlayerRef): Record<Side, PlayerRef> {
    return firstSide === `x` ? { x: first, o: second } : { x: second, o: first };
}

// The winner and side checks admit only x and o, which makes the casts
// below sound.
export function finishedGameOf(row: SeatRow): FinishedGame {
    const winner = row.winner as Side | null;
    if (row.userId !== null && row.botId !== null && row.userSide !== null) {
        const human: PlayerRef = { kind: `human`, id: row.userId };
        return { ...seated(row.userSide as Side, human, { kind: `bot`, id: row.botId }), winner };
    }
    if (row.challengerBotId !== null && row.destBotId !== null && row.challengerSide !== null) {
        const challenger: PlayerRef = { kind: `bot`, id: row.challengerBotId };
        return { ...seated(row.challengerSide as Side, challenger, { kind: `bot`, id: row.destBotId }), winner };
    }
    throw new Error(`stored game row seats nobody`);
}

// Voided games stay in the log for the record and drop out of the fold.
export function finishedGameLog(query: Query): FinishedGame[] {
    return query
        .select(seatColumns)
        .from(games)
        .where(and(isNotNull(games.finishSeq), isNull(games.voidedAt)))
        .orderBy(asc(games.finishSeq))
        .all()
        .map(finishedGameOf);
}

export function readRating(query: Query, player: PlayerRef): PlayerRating {
    const owner = player.kind === `human` ? ratings.userId : ratings.botId;
    const row = query
        .select({ rating: ratings.rating, deviation: ratings.deviation, volatility: ratings.volatility })
        .from(ratings)
        .where(eq(owner, player.id))
        .get();
    return row ?? seedRating(player.kind);
}

export function streamPlayerOf(query: Query, player: PlayerRef, name: string): StreamPlayer {
    const rating = readRating(query, player);
    return { name, rating: Math.round(rating.rating), provisional: isProvisional(rating) };
}

function saveRating(query: Query, player: PlayerRef, rating: PlayerRating): void {
    const values = { rating: rating.rating, deviation: rating.deviation, volatility: rating.volatility };
    if (player.kind === `human`) {
        query.insert(ratings)
            .values({ userId: player.id, ...values })
            .onConflictDoUpdate({ target: ratings.userId, set: values })
            .run();
    } else {
        query.insert(ratings)
            .values({ botId: player.id, ...values })
            .onConflictDoUpdate({ target: ratings.botId, set: values })
            .run();
    }
}

// Callers run this in the transaction that records the finish, so the
// table never holds a game the log does not.
export function applyFinishedGame(query: Query, game: FinishedGame): void {
    if (game.winner === null) return;
    const after = rateGame(game, { x: readRating(query, game.x), o: readRating(query, game.o) });
    saveRating(query, game.x, after.x);
    saveRating(query, game.o, after.o);
}

function ratedPlayerOf(row: { userId: string | null; botId: string | null }): PlayerRef {
    if (row.userId !== null) return { kind: `human`, id: row.userId };
    if (row.botId !== null) return { kind: `bot`, id: row.botId };
    throw new Error(`stored rating row names nobody`);
}

export function storedRatings(query: Query): Map<string, RatedPlayer> {
    const table = new Map<string, RatedPlayer>();
    for (const row of query.select().from(ratings).all()) {
        const player = ratedPlayerOf(row);
        const rating = { rating: row.rating, deviation: row.deviation, volatility: row.volatility };
        table.set(playerKey(player), { player, rating });
    }
    return table;
}

/**
 * Rebuilds the stored ratings from the game log alone; the answer to any
 * rating dispute, and idempotent on a table the live path kept.
 * Answers how many rated games the fold went through.
 */
export function recomputeRatings(query: Query): number {
    return query.transaction((tx) => {
        const log = finishedGameLog(tx);
        const folded = foldRatings(log);
        tx.delete(ratings).run();
        for (const { player, rating } of folded.values()) saveRating(tx, player, rating);
        return log.filter((game) => game.winner !== null).length;
    });
}

export interface RankedPlayer {
    readonly name: string;
    readonly kind: PlayerRef[`kind`];
    readonly rating: number;
}

const botOwners = alias(users, `bot_owner`);

export function rankablePlayers(query: Query, kind: LeaderboardQuery[`kind`]): RankedPlayer[] {
    const narrowed =
        kind === `bots` ? isNotNull(ratings.botId) : kind === `humans` ? isNotNull(ratings.userId) : undefined;
    return query
        .select({ rating: ratings.rating, userName: users.name, botName: bots.name })
        .from(ratings)
        .leftJoin(users, eq(ratings.userId, users.id))
        .leftJoin(bots, eq(ratings.botId, bots.id))
        .leftJoin(botOwners, eq(bots.ownerId, botOwners.id))
        .where(
            and(
                lte(ratings.deviation, rankableDeviation),
                narrowed,
                // Delisted and deleted bots, banned and deleted humans, and
                // banned owners' bots are hidden wherever players are listed.
                isNull(users.bannedAt),
                isNull(users.deletedAt),
                or(
                    isNull(ratings.botId),
                    and(isNull(bots.delistedAt), isNull(bots.deletedAt), isNull(botOwners.bannedAt)),
                ),
            ),
        )
        .orderBy(desc(ratings.rating), sql`coalesce(${users.nameKey}, ${bots.nameKey})`)
        .all()
        .map((row): RankedPlayer => {
            if (row.userName !== null) return { name: row.userName, kind: `human`, rating: row.rating };
            if (row.botName !== null) return { name: row.botName, kind: `bot`, rating: row.rating };
            throw new Error(`stored rating row names nobody`);
        });
}
