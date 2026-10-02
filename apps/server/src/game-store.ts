import {
    boardCellSchema,
    timeControlSchema,
    turnsOnBoard,
    type FinishReason,
    type GameHeadline,
    type GameTournament,
    type Side,
    type TimeControl,
} from '@hexo-arena/contract';
import { and, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { replay, type Coord, type Position } from '@hexo-arena/rules';
import { nowSeconds, type Query } from './db';
import { alias } from 'drizzle-orm/sqlite-core';
import { bots, games, moves, tournamentPairings, tournaments, users } from './db/schema';
import { applyFinishedGame, countedGameOf, seatColumns } from './rating-store';
import { shownBot, shownUser, type ShownName } from './shown-names';

// The position a game starts from: the origin stone plus the server-placed
// opening stones, in placement order.
export interface OpeningCell extends Coord {
    readonly player: 0 | 1;
}

export interface StoredMove {
    readonly seq: number;
    readonly side: Side;
    readonly cells: readonly [Coord, Coord];
}

export interface HumanGameRecord {
    readonly kind: `human`;
    readonly id: string;
    readonly userId: string;
    readonly user: ShownName;
    readonly botId: string;
    readonly bot: ShownName;
    readonly userSide: Side;
    readonly timeControl: TimeControl;
    readonly opening: readonly OpeningCell[];
    readonly winner: Side | null;
    readonly finishReason: FinishReason | null;
    readonly voided: boolean;
}

/** A game a guest played: the guest is its label alone, and the game rates nobody. */
export interface GuestGameRecord {
    readonly kind: `guest`;
    readonly id: string;
    readonly guestName: string;
    readonly botId: string;
    readonly bot: ShownName;
    readonly guestSide: Side;
    readonly createdAt: number;
    readonly timeControl: TimeControl;
    readonly opening: readonly OpeningCell[];
    readonly winner: Side | null;
    readonly finishReason: FinishReason | null;
    readonly voided: boolean;
}

export interface BotGameRecord {
    readonly kind: `bots`;
    readonly id: string;
    readonly challengerBotId: string;
    readonly challenger: ShownName;
    readonly destBotId: string;
    readonly dest: ShownName;
    readonly challengerSide: Side;
    readonly timeControl: TimeControl;
    readonly opening: readonly OpeningCell[];
    readonly winner: Side | null;
    readonly finishReason: FinishReason | null;
    readonly voided: boolean;
}

export type GameRecord = HumanGameRecord | GuestGameRecord | BotGameRecord;

/** A game a person plays against a bot: a user by id, a guest by its label alone. */
export function insertGame(
    query: Query,
    game: ({ userId: string } | { guestName: string }) & {
        botId: string;
        userSide: Side;
        timeControl: TimeControl;
        opening: readonly OpeningCell[];
    },
): string {
    const id = `g_${randomUUID()}`;
    query.insert(games)
        .values({
            id,
            ...(`userId` in game ? { userId: game.userId } : { guestName: game.guestName }),
            botId: game.botId,
            userSide: game.userSide,
            timeControl: JSON.stringify(game.timeControl),
            openingCells: JSON.stringify(game.opening),
            createdAt: nowSeconds(),
        })
        .run();
    return id;
}

export function insertMove(
    query: Query,
    move: { gameId: string; seq: number; side: Side; cells: readonly [Coord, Coord] },
): void {
    query.insert(moves)
        .values({
            gameId: move.gameId,
            seq: move.seq,
            side: move.side,
            firstX: move.cells[0].x,
            firstY: move.cells[0].y,
            secondX: move.cells[1].x,
            secondY: move.cells[1].y,
            createdAt: nowSeconds(),
        })
        .run();
}

export function insertBotGame(
    query: Query,
    game: {
        challengerBotId: string;
        destBotId: string;
        challengerSide: Side;
        timeControl: TimeControl;
        opening: readonly OpeningCell[];
        pairing?: { id: string; game: 1 | 2 };
    },
): string {
    const id = `g_${randomUUID()}`;
    query.insert(games)
        .values({
            id,
            challengerBotId: game.challengerBotId,
            destBotId: game.destBotId,
            challengerSide: game.challengerSide,
            timeControl: JSON.stringify(game.timeControl),
            openingCells: JSON.stringify(game.opening),
            createdAt: nowSeconds(),
            ...(game.pairing === undefined ? {} : { pairingId: game.pairing.id, pairingGame: game.pairing.game }),
        })
        .run();
    return id;
}

// The subquery runs once per statement, so each finish is its own update:
// a bulk update would hand every row the same number.
const nextFinishSeq = sql`(select coalesce(max(${games.finishSeq}), 0) + 1 from ${games})`;

/** Writes a game's result and its ratings in one transaction; answers whether the game was voided while live. */
export function recordFinish(
    query: Query,
    gameId: string,
    finish: { winner: Side | null; reason: FinishReason },
): { voided: boolean } {
    return query.transaction((tx) => {
        const [finished] = tx
            .update(games)
            .set({ winner: finish.winner, finishReason: finish.reason, finishedAt: nowSeconds(), finishSeq: nextFinishSeq })
            .where(and(eq(games.id, gameId), isNull(games.finishedAt)))
            .returning({ ...seatColumns, voidedAt: games.voidedAt, guestName: games.guestName })
            .all();
        // A game voided while live finishes on the record but never rates,
        // and a guest's game rates nobody, the bot included.
        if (finished?.finishSeq != null && finished.guestName === null) applyFinishedGame(tx, gameId, finished.finishSeq, countedGameOf(finished));
        return { voided: finished?.voidedAt != null };
    });
}

// Live games die with the process that ran their clocks and sockets, so a
// boot sweep closes whatever a crash or restart left open.
export function abortUnfinishedGames(query: Query): void {
    query.transaction((tx) => {
        const open = tx.select({ id: games.id }).from(games).where(isNull(games.finishedAt)).orderBy(games.createdAt).all();
        for (const { id } of open) recordFinish(tx, id, { winner: null, reason: `aborted` });
    });
}

const challengerBots = alias(bots, `challenger_bot`);
const destBots = alias(bots, `dest_bot`);

export function findGame(query: Query, gameId: string): GameRecord | undefined {
    const row = query
        .select({
            id: games.id,
            userId: games.userId,
            userName: users.name,
            userDeletedAt: users.deletedAt,
            guestName: games.guestName,
            botId: games.botId,
            botName: bots.name,
            botDeletedAt: bots.deletedAt,
            userSide: games.userSide,
            createdAt: games.createdAt,
            challengerBotId: games.challengerBotId,
            challengerName: challengerBots.name,
            challengerDeletedAt: challengerBots.deletedAt,
            destBotId: games.destBotId,
            destName: destBots.name,
            destDeletedAt: destBots.deletedAt,
            challengerSide: games.challengerSide,
            timeControl: games.timeControl,
            openingCells: games.openingCells,
            winner: games.winner,
            finishReason: games.finishReason,
            voidedAt: games.voidedAt,
        })
        .from(games)
        .leftJoin(users, eq(games.userId, users.id))
        .leftJoin(bots, eq(games.botId, bots.id))
        .leftJoin(challengerBots, eq(games.challengerBotId, challengerBots.id))
        .leftJoin(destBots, eq(games.destBotId, destBots.id))
        .where(eq(games.id, gameId))
        .get();
    if (row === undefined) return undefined;
    const voided = row.voidedAt !== null;
    // Rows are written through the schemas that read them back; a parse
    // failure means the store itself is broken.
    const timeControl = timeControlSchema.parse(JSON.parse(row.timeControl));
    const opening = boardCellSchema.array().parse(JSON.parse(row.openingCells));
    const winner = (row.winner as Side | null) ?? null;
    const finishReason = (row.finishReason as FinishReason | null) ?? null;
    if (
        row.userId !== null &&
        row.userName !== null &&
        row.botId !== null &&
        row.botName !== null &&
        row.userSide !== null
    ) {
        return {
            kind: `human`,
            id: row.id,
            userId: row.userId,
            user: shownUser(row.userName, row.userDeletedAt),
            botId: row.botId,
            bot: shownBot(row.botName, row.botDeletedAt),
            // The seats constraint admits only x and o here.
            userSide: row.userSide as Side,
            timeControl,
            opening,
            winner,
            finishReason,
            voided,
        };
    }
    if (row.guestName !== null && row.botId !== null && row.botName !== null && row.userSide !== null) {
        return {
            kind: `guest`,
            id: row.id,
            guestName: row.guestName,
            botId: row.botId,
            bot: shownBot(row.botName, row.botDeletedAt),
            // The seats constraint admits only x and o here.
            guestSide: row.userSide as Side,
            createdAt: row.createdAt,
            timeControl,
            opening,
            winner,
            finishReason,
            voided,
        };
    }
    if (
        row.challengerBotId !== null &&
        row.challengerName !== null &&
        row.destBotId !== null &&
        row.destName !== null &&
        row.challengerSide !== null
    ) {
        return {
            kind: `bots`,
            id: row.id,
            challengerBotId: row.challengerBotId,
            challenger: shownBot(row.challengerName, row.challengerDeletedAt),
            destBotId: row.destBotId,
            dest: shownBot(row.destName, row.destDeletedAt),
            // The seats constraint admits only x and o here.
            challengerSide: row.challengerSide as Side,
            timeControl,
            opening,
            winner,
            finishReason,
            voided,
        };
    }
    throw new Error(`stored game row seats nobody: ${row.id}`);
}

// Only finished games answer from the log: a live one is the registry's,
// and an unfinished row without it belongs to an earlier process.
export function findFinishedHeadline(query: Query, gameId: string): GameHeadline | undefined {
    const row = query
        .select({
            userName: users.name,
            userDeletedAt: users.deletedAt,
            guestName: games.guestName,
            botName: bots.name,
            botDeletedAt: bots.deletedAt,
            userSide: games.userSide,
            challengerName: challengerBots.name,
            challengerDeletedAt: challengerBots.deletedAt,
            destName: destBots.name,
            destDeletedAt: destBots.deletedAt,
            challengerSide: games.challengerSide,
            winner: games.winner,
            finishReason: games.finishReason,
            openingCells: games.openingCells,
            moves: sql<number>`(SELECT count(*) FROM ${moves} WHERE ${moves.gameId} = ${games.id})`,
        })
        .from(games)
        .leftJoin(users, eq(games.userId, users.id))
        .leftJoin(bots, eq(games.botId, bots.id))
        .leftJoin(challengerBots, eq(games.challengerBotId, challengerBots.id))
        .leftJoin(destBots, eq(games.destBotId, destBots.id))
        .where(eq(games.id, gameId))
        .get();
    if (row === undefined || row.finishReason === null) return undefined;
    // The seats, side, winner, and reason checks admit only these values.
    const seated = (firstSide: Side, first: string, second: string): Record<Side, string> =>
        firstSide === `x` ? { x: first, o: second } : { x: second, o: first };
    const human = row.userName === null ? row.guestName : shownUser(row.userName, row.userDeletedAt).name;
    const names =
        human !== null && row.botName !== null && row.userSide !== null
            ? seated(row.userSide as Side, human, shownBot(row.botName, row.botDeletedAt).name)
            : row.challengerName !== null && row.destName !== null && row.challengerSide !== null
              ? seated(
                    row.challengerSide as Side,
                    shownBot(row.challengerName, row.challengerDeletedAt).name,
                    shownBot(row.destName, row.destDeletedAt).name,
                )
              : undefined;
    if (names === undefined) throw new Error(`stored game row seats nobody: ${gameId}`);
    return {
        status: `finished`,
        names,
        winner: (row.winner as Side | null) ?? null,
        reason: row.finishReason as FinishReason,
        turns: turnsOnBoard(boardCellSchema.array().parse(JSON.parse(row.openingCells)).length) + row.moves,
    };
}

// The creation cooldown reads the log rather than memory, so a restart
// does not reset a human's clock between creations.
export function lastHumanGameCreatedAt(query: Query, userId: string): number | null {
    const row = query
        .select({ createdAt: games.createdAt })
        .from(games)
        .where(eq(games.userId, userId))
        .orderBy(desc(games.createdAt))
        .limit(1)
        .get();
    return row === undefined ? null : row.createdAt;
}

// A signed-in human's games against one bot since an epoch second, which
// the daily pair cap counts as it counts two bots'.
export function countHumanPairGamesSince(query: Query, pair: { userId: string; botId: string }, sinceSeconds: number): number {
    const [row] = query
        .select({ n: count() })
        .from(games)
        .where(and(eq(games.userId, pair.userId), eq(games.botId, pair.botId), gte(games.createdAt, sinceSeconds)))
        .all();
    return row?.n ?? 0;
}

// Bot-vs-bot caps count games the log already holds, from the start of
// the current UTC day.
export function countPairBotGamesSince(
    query: Query,
    pair: { one: string; two: string },
    sinceSeconds: number,
): number {
    const [row] = query
        .select({ n: count() })
        .from(games)
        .where(
            and(
                gte(games.createdAt, sinceSeconds),
                or(
                    and(eq(games.challengerBotId, pair.one), eq(games.destBotId, pair.two)),
                    and(eq(games.challengerBotId, pair.two), eq(games.destBotId, pair.one)),
                ),
            ),
        )
        .all();
    return row?.n ?? 0;
}

/** The tournament a game belongs to, with its round and game number. */
export function findGameTournament(query: Query, gameId: string): GameTournament | undefined {
    const row = query
        .select({ id: tournaments.id, name: tournaments.name, round: tournamentPairings.round, game: games.pairingGame })
        .from(games)
        .innerJoin(tournamentPairings, eq(tournamentPairings.id, games.pairingId))
        .innerJoin(tournaments, eq(tournaments.id, tournamentPairings.tournamentId))
        .where(eq(games.id, gameId))
        .get();
    if (row === undefined || (row.game !== 1 && row.game !== 2)) return undefined;
    return { id: row.id, name: row.name, round: row.round, game: row.game };
}

export function countBotBotGamesSince(query: Query, botId: string, sinceSeconds: number): number {
    const [row] = query
        .select({ n: count() })
        .from(games)
        .where(
            and(
                gte(games.createdAt, sinceSeconds),
                or(eq(games.challengerBotId, botId), eq(games.destBotId, botId)),
            ),
        )
        .all();
    return row?.n ?? 0;
}

export function findMoves(query: Query, gameId: string): StoredMove[] {
    return query
        .select()
        .from(moves)
        .where(eq(moves.gameId, gameId))
        .orderBy(moves.seq)
        .all()
        .map((row) => ({
            seq: row.seq,
            side: row.side as Side,
            cells: [
                { x: row.firstX, y: row.firstY },
                { x: row.secondX, y: row.secondY },
            ] as [Coord, Coord],
        }));
}

// Rebuilding a position replays the stored log,
// so a snapshot never depends on live state.
// A winning placement ends the replay:
// the game ended the instant the line completed,
// so the second cell of that move was never applied.
export function replayPosition(query: Query, record: GameRecord): Position {
    const replayed = replay([...record.opening, ...findMoves(query, record.id).flatMap((move) => move.cells)]);
    if (!replayed.ok) throw new Error(`stored cell is illegal: ${record.id}`);
    return replayed.position;
}
