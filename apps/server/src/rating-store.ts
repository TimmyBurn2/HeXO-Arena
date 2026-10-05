import { rankableDeviation, type LeaderboardQuery, type Side, type StreamPlayer } from '@hexo-arena/contract';
import { and, asc, count, desc, eq, isNotNull, isNull, lt, lte, notExists, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Query } from './db';
import { bots, gameRatings, games, ratings, users } from './db/schema';
import { otherSide, seated, seatsOf, type GameSeat } from './game-seats';
import {
    foldRatings,
    humanSideOf,
    isProvisional,
    playerKey,
    rateGame,
    seedRating,
    type FinishedGame,
    type Opponent,
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
    createdAt: games.createdAt,
    finishedAt: games.finishedAt,
};

interface SeatRow {
    userId: string | null;
    botId: string | null;
    userSide: Side | null;
    challengerBotId: string | null;
    destBotId: string | null;
    challengerSide: Side | null;
    winner: Side | null;
    finishSeq: number | null;
    createdAt: number;
    finishedAt: number | null;
}

function finishedGameOf(row: SeatRow): FinishedGame {
    const { winner, createdAt: startedAt, finishedAt } = row;
    if (finishedAt === null) throw new Error(`stored game row has not finished`);
    if (row.userId !== null && row.botId !== null && row.userSide !== null) {
        const human: PlayerRef = { kind: `human`, id: row.userId };
        return { ...seated(row.userSide, human, { kind: `bot`, id: row.botId }), winner, startedAt, finishedAt };
    }
    if (row.challengerBotId !== null && row.destBotId !== null && row.challengerSide !== null) {
        const challenger: PlayerRef = { kind: `bot`, id: row.challengerBotId };
        return { ...seated(row.challengerSide, challenger, { kind: `bot`, id: row.destBotId }), winner, startedAt, finishedAt };
    }
    throw new Error(`stored game row seats nobody`);
}

/**
 * The games of the log that can move a rating, as a condition on the games table.
 * A guest's game, one carrying the unrated mark, and one against a bot at a
 * level other than its default rate nobody; a level has no rating of its own
 * to count against, and the bot's would flatter a win over a weakened bot.
 */
export const ratable = sql`${games.guestName} is null and ${games.xLevel} is null and ${games.oLevel} is null and ${games.unratedByChoice} = 0`;

/** Whether a game of the log can move a rating, as {@link ratable} reads it. */
export function ratesSomebody(row: { guestName: string | null; xLevel: string | null; oLevel: string | null; unratedByChoice: number }): boolean {
    return row.guestName === null && row.xLevel === null && row.oLevel === null && row.unratedByChoice === 0;
}

/** The game as the fold counts it: a voided one stays on the record and rates nobody, as a game without a winner. */
export function countedGameOf(row: SeatRow & { voidedAt: number | null }): FinishedGame {
    const game = finishedGameOf(row);
    return row.voidedAt === null ? game : { ...game, winner: null };
}

// A finished game of the log, as the fold counts it, by its id.
interface LoggedGame extends FinishedGame {
    readonly id: string;
}

// The log the fold reads leaves out the games that rate nobody.
export function finishedGameLog(query: Query): LoggedGame[] {
    return query
        .select({ id: games.id, voidedAt: games.voidedAt, ...seatColumns })
        .from(games)
        .where(and(isNotNull(games.finishSeq), ratable))
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

// A bot's rated games are its bot games: a game against a human never
// moves the bot.
function ratedSeatsOf(player: PlayerRef): GameSeat[] {
    return seatsOf(player).filter((seat) => player.kind === `human` || seat.opponentKind === `bot`);
}

// A rated game is one with a winner that was never voided, as the fold
// counts it; each seat column leads an index with the finish order, so
// the newest such game before a finish is one short walk per column.
function lastRatedIn(query: Query, seat: GameSeat, playerId: string, finishSeq: number, by?: number) {
    return query
        .select({ finishSeq: games.finishSeq, finishedAt: games.finishedAt, gameId: games.id, side: sql<Side>`${seat.side}` })
        .from(games)
        .where(
            and(
                eq(seat.column, playerId),
                lt(games.finishSeq, finishSeq),
                isNotNull(games.winner),
                isNull(games.voidedAt),
                ratable,
                by === undefined ? undefined : lte(games.finishedAt, by),
            ),
        )
        .orderBy(desc(games.finishSeq))
        .limit(1);
}

function ratedAtBefore(query: Query, player: PlayerRef, finishSeq: number): number | null {
    let latest: { finishSeq: number; finishedAt: number } | undefined;
    for (const seat of ratedSeatsOf(player)) {
        const row = lastRatedIn(query, seat, player.id, finishSeq).get();
        if (row?.finishSeq == null || row.finishedAt === null) continue;
        if (latest === undefined || row.finishSeq > latest.finishSeq) latest = { finishSeq: row.finishSeq, finishedAt: row.finishedAt };
    }
    return latest?.finishedAt ?? null;
}

/** The query plan of each seat's read of a player's previous rated game, for tests that pin it to an index. */
export function explainRatedAtBefore(query: Query, player: PlayerRef, finishSeq: number): string[] {
    return ratedSeatsOf(player).flatMap((seat) =>
        query.all<{ detail: string }>(sql`explain query plan select * from ${lastRatedIn(query, seat, player.id, finishSeq)}`).map((row) => row.detail),
    );
}

/**
 * A bot as it stood when a human game began: after its last bot game that
 * finished by that second and before this game in the log, as the fold
 * finds it, read from that game's own rating rows.
 */
function botAtStart(query: Query, bot: PlayerRef, startedAt: number, finishSeq: number): Opponent {
    let latest: { finishSeq: number; gameId: string; side: Side } | undefined;
    for (const seat of ratedSeatsOf(bot)) {
        const row = lastRatedIn(query, seat, bot.id, finishSeq, startedAt).get();
        if (row?.finishSeq == null) continue;
        if (latest === undefined || row.finishSeq > latest.finishSeq) latest = { finishSeq: row.finishSeq, gameId: row.gameId, side: row.side };
    }
    if (latest === undefined) return seedRating(bot.kind);
    const after = query
        .select({ rating: gameRatings.ratingAfter, deviation: gameRatings.deviationAfter })
        .from(gameRatings)
        .where(and(eq(gameRatings.gameId, latest.gameId), eq(gameRatings.side, latest.side)))
        .get();
    if (after === undefined) throw new Error(`a rated bot game has no rating rows`);
    return after;
}

// Callers run this in the transaction that records the finish, so neither
// table ever holds a game the log does not.
export function applyFinishedGame(query: Query, gameId: string, finishSeq: number, game: FinishedGame): void {
    const standing = (player: PlayerRef): Standing => ({ rating: readRating(query, player), ratedAt: ratedAtBefore(query, player, finishSeq) });
    const before = { x: standing(game.x), o: standing(game.o) };
    const human = humanSideOf(game);
    const anchor = human === null || game.winner === null ? undefined : botAtStart(query, game[otherSide(human)], game.startedAt, finishSeq);
    const after = rateGame(game, before, anchor);
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
        const missing = tx.select({ n: count() }).from(games).where(and(isNotNull(games.finishSeq), ratable, notExists(cached))).get()?.n ?? 0;
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
    /** The rated games the player has played. */
    readonly games: number;
    /** When the latest of them finished, in epoch seconds. */
    readonly lastPlayedAt: number;
    /** The bot's id, for its presence; null for a human. */
    readonly botId: string | null;
    readonly ownerName: string | null;
}

const botOwners = alias(users, `bot_owner`);

// A rated game is one with a winner that no moderation voided, of those that rate anybody.
const ratedFinish = sql`${games.winner} is not null and ${games.voidedAt} is null and ${ratable}`;

// The rated games in one seat column, by count and latest finish, read
// through that seat's index; a column the player cannot sit in counts none.
function seatCount(column: SQLWrapper, id: SQLWrapper): SQL {
    return sql`(select count(*) from ${games} where ${column} = ${id} and ${ratedFinish})`;
}

function seatLatest(column: SQLWrapper, id: SQLWrapper): SQL {
    return sql`coalesce((select max(${games.finishedAt}) from ${games} where ${column} = ${id} and ${ratedFinish}), 0)`;
}

/**
 * The rankable players by rating, ties by name fold, each with their rated
 * games and the latest one's finish; `activeSince`, in epoch seconds, keeps
 * those whose latest rated game finished then or later.
 * A player with no rated game is never rankable, so none is listed.
 */
export function rankablePlayers(query: Query, filter: { kind: LeaderboardQuery[`kind`]; activeSince: number | null }): RankedPlayer[] {
    const { kind, activeSince } = filter;
    const narrowed =
        kind === `bots` ? isNotNull(ratings.botId) : kind === `humans` ? isNotNull(ratings.userId) : undefined;
    const seats = [
        [games.userId, ratings.userId],
        [games.botId, ratings.botId],
        [games.challengerBotId, ratings.botId],
        [games.destBotId, ratings.botId],
    ] as const;
    return query
        .select({
            rating: ratings.rating,
            userName: users.name,
            botName: bots.name,
            botId: bots.id,
            ownerName: botOwners.name,
            games: sql<number>`${sql.join(seats.map(([column, id]) => seatCount(column, id)), sql` + `)}`,
            lastPlayedAt: sql<number>`max(${sql.join(seats.map(([column, id]) => seatLatest(column, id)), sql`, `)})`,
        })
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
        .filter((row) => row.games > 0 && (activeSince === null || row.lastPlayedAt >= activeSince))
        .map((row): RankedPlayer => {
            const played = { rating: row.rating, games: row.games, lastPlayedAt: row.lastPlayedAt };
            if (row.userName !== null) return { name: row.userName, kind: `human`, ...played, botId: null, ownerName: null };
            if (row.botName !== null && row.botId !== null) return { name: row.botName, kind: `bot`, ...played, botId: row.botId, ownerName: row.ownerName };
            throw new Error(`stored rating row names nobody`);
        });
}
