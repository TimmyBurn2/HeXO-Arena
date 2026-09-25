import {
    boardCellSchema,
    timeControlSchema,
    type FinishReason,
    type Side,
    type TimeControl,
} from '@hexarena/contract';
import { and, count, desc, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { emptyPosition, place, type Coord, type Position } from '@hexarena/rules';
import { nowSeconds, type Query } from './db';
import { bots, games, moves } from './db/schema';
import { applyFinishedGame, finishedGameOf, seatColumns } from './rating-store';

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
    readonly botId: string;
    readonly botName: string;
    readonly userSide: Side;
    readonly timeControl: TimeControl;
    readonly opening: readonly OpeningCell[];
    readonly winner: Side | null;
    readonly finishReason: FinishReason | null;
}

export interface BotGameRecord {
    readonly kind: `bots`;
    readonly id: string;
    readonly challengerBotId: string;
    readonly destBotId: string;
    readonly challengerSide: Side;
    readonly timeControl: TimeControl;
    readonly opening: readonly OpeningCell[];
    readonly winner: Side | null;
    readonly finishReason: FinishReason | null;
}

export type GameRecord = HumanGameRecord | BotGameRecord;

export function insertGame(
    query: Query,
    game: {
        userId: string;
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
            userId: game.userId,
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
        })
        .run();
    return id;
}

// The subquery runs once per statement, so each finish is its own update:
// a bulk update would hand every row the same number.
const nextFinishSeq = sql`(select coalesce(max(${games.finishSeq}), 0) + 1 from ${games})`;

export function recordFinish(
    query: Query,
    gameId: string,
    finish: { winner: Side | null; reason: FinishReason },
): void {
    query.transaction((tx) => {
        const [finished] = tx
            .update(games)
            .set({ winner: finish.winner, finishReason: finish.reason, finishedAt: nowSeconds(), finishSeq: nextFinishSeq })
            .where(and(eq(games.id, gameId), isNull(games.finishedAt)))
            .returning(seatColumns)
            .all();
        if (finished !== undefined) applyFinishedGame(tx, finishedGameOf(finished));
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

export function findGame(query: Query, gameId: string): GameRecord | undefined {
    const row = query
        .select({
            id: games.id,
            userId: games.userId,
            botId: games.botId,
            botName: bots.name,
            userSide: games.userSide,
            challengerBotId: games.challengerBotId,
            destBotId: games.destBotId,
            challengerSide: games.challengerSide,
            timeControl: games.timeControl,
            openingCells: games.openingCells,
            winner: games.winner,
            finishReason: games.finishReason,
        })
        .from(games)
        .leftJoin(bots, eq(games.botId, bots.id))
        .where(eq(games.id, gameId))
        .get();
    if (row === undefined) return undefined;
    // Rows are written through the schemas that read them back; a parse
    // failure means the store itself is broken.
    const timeControl = timeControlSchema.parse(JSON.parse(row.timeControl));
    const opening = boardCellSchema.array().parse(JSON.parse(row.openingCells));
    const winner = (row.winner as Side | null) ?? null;
    const finishReason = (row.finishReason as FinishReason | null) ?? null;
    if (row.userId !== null && row.botId !== null && row.botName !== null && row.userSide !== null) {
        return {
            kind: `human`,
            id: row.id,
            userId: row.userId,
            botId: row.botId,
            botName: row.botName,
            // The seats constraint admits only x and o here.
            userSide: row.userSide as Side,
            timeControl,
            opening,
            winner,
            finishReason,
        };
    }
    if (row.challengerBotId !== null && row.destBotId !== null && row.challengerSide !== null) {
        return {
            kind: `bots`,
            id: row.id,
            challengerBotId: row.challengerBotId,
            destBotId: row.destBotId,
            // The seats constraint admits only x and o here.
            challengerSide: row.challengerSide as Side,
            timeControl,
            opening,
            winner,
            finishReason,
        };
    }
    throw new Error(`stored game row seats nobody: ${row.id}`);
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

// Rebuilding a position replays the stored log through the same engine that
// vetted every entry, so a snapshot never depends on live state. A winning
// placement ends the replay: the game ended the instant the line completed,
// so the second cell of that move was never applied.
export function replayPosition(query: Query, record: GameRecord): Position {
    let position = emptyPosition;
    for (const cell of record.opening) {
        const placed = place(position, cell);
        if (!placed.ok) throw new Error(`stored opening cell is illegal: ${record.id}`);
        position = placed.position;
    }
    for (const move of findMoves(query, record.id)) {
        for (const cell of move.cells) {
            const placed = place(position, cell);
            if (!placed.ok) throw new Error(`stored move is illegal: ${record.id}`);
            position = placed.position;
            if (placed.win !== null) return position;
        }
    }
    return position;
}
