import { rankableDeviation, type LeaderboardQuery, type Side, type StreamPlayer } from '@hexo-arena/contract';
import { and, asc, count, desc, eq, isNotNull, isNull, lt, lte, notExists, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Query } from './db';
import { bots, gameRatings, games, ratings, users } from './db/schema';
import {
    foldRatings,
    isProvisional,
    playerKey,
    rateGame,
    seedRating,
    type FinishedGame,
    type PlayerRating,
    type PlayerRef,
    type RatedPlayer,
    type RatingStep,
    type Standing,
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
    finishSeq: games.finishSeq,
    finishedAt: games.finishedAt,
};

export interface SeatRow {
    userId: string | null;
    botId: string | null;
    userSide: string | null;
    challengerBotId: string | null;
    destBotId: string | null;
    challengerSide: string | null;
    winner: string | null;
    finishSeq: number | null;
    finishedAt: number | null;
}

function seated(firstSide: Side, first: PlayerRef, second: PlayerRef): Record<Side, PlayerRef> {
    return firstSide === `x` ? { x: first, o: second } : { x: second, o: first };
}

// The winner and side checks admit only x and o, which makes the casts
// below sound.
export function finishedGameOf(row: SeatRow): FinishedGame {
    const winner = row.winner as Side | null;
    const finishedAt = row.finishedAt;
    if (finishedAt === null) throw new Error(`stored game row has not finished`);
    if (row.userId !== null && row.botId !== null && row.userSide !== null) {
        const human: PlayerRef = { kind: `human`, id: row.userId };
        return { ...seated(row.userSide as Side, human, { kind: `bot`, id: row.botId }), winner, finishedAt };
    }
    if (row.challengerBotId !== null && row.destBotId !== null && row.challengerSide !== null) {
        const challenger: PlayerRef = { kind: `bot`, id: row.challengerBotId };
        return { ...seated(row.challengerSide as Side, challenger, { kind: `bot`, id: row.destBotId }), winner, finishedAt };
    }
    throw new Error(`stored game row seats nobody`);
}

/** The game as the fold counts it: a voided one stays on the record and rates nobody, as a game without a winner. */
export function countedGameOf(row: SeatRow & { voidedAt: number | null }): FinishedGame {
    const game = finishedGameOf(row);
    return row.voidedAt === null ? game : { ...game, winner: null };
}

/** A finished game of the log, as the fold counts it, by its id. */
export interface LoggedGame extends FinishedGame {
    readonly id: string;
}

export function finishedGameLog(query: Query): LoggedGame[] {
    return query
        .select({ id: games.id, voidedAt: games.voidedAt, ...seatColumns })
        .from(games)
        .where(isNotNull(games.finishSeq))
        .orderBy(asc(games.finishSeq))
        .all()
        .map((row) => ({ id: row.id, ...countedGameOf(row) }));
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

function saveGameRatings(query: Query, gameId: string, step: RatingStep): void {
    query.insert(gameRatings)
        .values(
            ([`x`, `o`] as const).map((side) => ({
                gameId,
                side,
                ratingBefore: step.before[side].rating,
                ratingAfter: step.after[side].rating,
                deviationAfter: step.after[side].deviation,
            })),
        )
        .run();
}

function seatsOf(player: PlayerRef) {
    return player.kind === `human` ? [games.userId] : [games.botId, games.challengerBotId, games.destBotId];
}

// A rated game is one with a winner that was never voided, as the fold
// counts it; each seat column leads an index with the finish order, so
// the newest such game before a finish is one short walk per column.
function lastRatedIn(query: Query, seat: ReturnType<typeof seatsOf>[number], playerId: string, finishSeq: number) {
    return query
        .select({ finishSeq: games.finishSeq, finishedAt: games.finishedAt })
        .from(games)
        .where(and(eq(seat, playerId), lt(games.finishSeq, finishSeq), isNotNull(games.winner), isNull(games.voidedAt)))
        .orderBy(desc(games.finishSeq))
        .limit(1);
}

function ratedAtBefore(query: Query, player: PlayerRef, finishSeq: number): number | null {
    let latest: { finishSeq: number; finishedAt: number } | undefined;
    for (const seat of seatsOf(player)) {
        const row = lastRatedIn(query, seat, player.id, finishSeq).get();
        if (row?.finishSeq == null || row.finishedAt === null) continue;
        if (latest === undefined || row.finishSeq > latest.finishSeq) latest = { finishSeq: row.finishSeq, finishedAt: row.finishedAt };
    }
    return latest?.finishedAt ?? null;
}

/** The query plan of each seat's read of a player's previous rated game, for tests that pin it to an index. */
export function explainRatedAtBefore(query: Query, player: PlayerRef, finishSeq: number): string[] {
    return seatsOf(player).flatMap((seat) =>
        query.all<{ detail: string }>(sql`explain query plan select * from ${lastRatedIn(query, seat, player.id, finishSeq)}`).map((row) => row.detail),
    );
}

// Callers run this in the transaction that records the finish, so neither
// table ever holds a game the log does not.
export function applyFinishedGame(query: Query, gameId: string, finishSeq: number, game: FinishedGame): void {
    const standing = (player: PlayerRef): Standing => ({ rating: readRating(query, player), ratedAt: ratedAtBefore(query, player, finishSeq) });
    const before = { x: standing(game.x), o: standing(game.o) };
    const after = rateGame(game, before);
    if (game.winner !== null) {
        saveRating(query, game.x, after.x);
        saveRating(query, game.o, after.o);
    }
    saveGameRatings(query, gameId, { before: { x: before.x.rating, o: before.o.rating }, after });
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
 * Rebuilds the stored ratings and the game ratings from the game log
 * alone; the answer to any rating dispute, and idempotent on tables the
 * live path kept.
 * Answers how many rated games the fold went through.
 */
export function recomputeRatings(query: Query): number {
    return query.transaction((tx) => {
        const log = finishedGameLog(tx);
        tx.delete(gameRatings).run();
        const folded = foldRatings(log, (game, step) => {
            saveGameRatings(tx, game.id, step);
        });
        tx.delete(ratings).run();
        for (const { player, rating } of folded.values()) saveRating(tx, player, rating);
        return log.filter((game) => game.winner !== null).length;
    });
}

/**
 * Writes the game ratings a database from before them lacks, from the fold
 * of the log, and leaves the stored ratings as they stand.
 * Answers how many finished games had none.
 */
export function fillGameRatings(query: Query): number {
    return query.transaction((tx) => {
        const cached = tx.select({ gameId: gameRatings.gameId }).from(gameRatings).where(eq(gameRatings.gameId, games.id));
        const missing = tx.select({ n: count() }).from(games).where(and(isNotNull(games.finishSeq), notExists(cached))).get()?.n ?? 0;
        if (missing === 0) return 0;
        tx.delete(gameRatings).run();
        foldRatings(finishedGameLog(tx), (game, step) => {
            saveGameRatings(tx, game.id, step);
        });
        return missing;
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
