import { analysisTurnCap, type AnalysisFailure, type AnalysisLine, type AnalysisStatus, type AnalysisTurn, type AnalyzerValues, type Side } from '@hexo-arena/contract';
import type { Player, Setup, Stone } from '@hexo-arena/rules';
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { analyzerColumns, storedAnalyzer, storedValues, valueColumns, type StoredAnalyzer } from './bots';
import type { Query } from './db';
import { analyses, analysisLines, bots, games, moves, ownLines, ownValues, users } from './db/schema';
import { findGame, findMoves, type GameRecord } from './game-store';
import { shownBot, shownUser } from './shown-names';

/** A bot that declares an analyzer and may read: listed, not deleted, its owner not banned. */
export interface AnalyzerInfo {
    readonly id: string;
    readonly name: string;
    readonly version: string | null;
    readonly ownerId: string;
    readonly ownerName: string;
    readonly analyzer: StoredAnalyzer;
}

const owners = alias(users, `owners`);

/** The analyzers among `botIds`, in the order given; a bot that may not analyze is left out. */
export function analyzersAmong(query: Query, botIds: readonly string[]): AnalyzerInfo[] {
    if (botIds.length === 0) return [];
    const rows = query
        .select({
            id: bots.id,
            name: bots.name,
            version: bots.version,
            ownerId: bots.ownerId,
            ownerName: owners.name,
            ...analyzerColumns,
        })
        .from(bots)
        .innerJoin(owners, eq(bots.ownerId, owners.id))
        .where(and(inArray(bots.id, [...botIds]), isNull(bots.delistedAt), isNull(bots.deletedAt), isNull(owners.bannedAt)))
        .all();
    const byId = new Map(
        rows.flatMap((row) => {
            const analyzer = storedAnalyzer(row);
            return analyzer === null ? [] : [[row.id, { id: row.id, name: row.name, version: row.version, ownerId: row.ownerId, ownerName: row.ownerName, analyzer }] as const];
        }),
    );
    return botIds.flatMap((botId) => byId.get(botId) ?? []);
}

/** A finished game as a whole-game reading needs it: who sat, and the positions to read. */
export interface AnalysableGame {
    readonly gameId: string;
    /** Users seated in the game, and the owners of the bots seated in it. */
    readonly owners: readonly string[];
    readonly bots: readonly string[];
    /** Users seated in the game, whose opt-out covers it. */
    readonly users: readonly string[];
    /** The position before each turn from the first after the opening, and the final board when no six ended the game. */
    readonly positions: readonly { readonly turn: number; readonly setup: Setup }[];
    /** Turns on the board at the finish, the opening's included, and those the players played. */
    readonly turns: number;
    readonly played: number;
}

/** The stored game by id, finished, with what a reading of it needs; undefined for any other id. */
export function analysableGame(query: Query, gameId: string): AnalysableGame | undefined {
    const record = findGame(query, gameId);
    if (record === undefined || record.finishReason === null) return undefined;
    const seatedBots = botsOf(record);
    const seatedUsers = record.kind === `human` ? [record.userId] : [];
    const botOwners = seatedBots.length === 0 ? [] : query.select({ ownerId: bots.ownerId }).from(bots).where(inArray(bots.id, seatedBots)).all().map((row) => row.ownerId);
    const stones: Stone[] = record.opening.map((cell) => ({ x: cell.x, y: cell.y, player: cell.player }));
    const firstTurn = (record.opening.length + 1) / 2;
    const played = findMoves(query, gameId);
    for (const move of played) {
        const player: Player = move.side === `x` ? 0 : 1;
        stones.push(...move.cells.map((cell) => ({ ...cell, player })));
    }
    const lastTurn = firstTurn + played.length - 1;
    const endTurn = record.finishReason === `six-in-a-row` ? lastTurn : lastTurn + 1;
    const positions: { turn: number; setup: Setup }[] = [];
    for (let turn = firstTurn; turn <= endTurn; turn += 1) {
        // Turn t opens on ply 2t - 1, o playing the odd turns.
        const toMove: Player = turn % 2 === 1 ? 1 : 0;
        positions.push({ turn, setup: { stones: stones.slice(0, 2 * turn - 1), toMove } });
    }
    return { gameId, owners: [...new Set([...seatedUsers, ...botOwners])], bots: seatedBots, users: seatedUsers, positions, turns: Math.max(lastTurn, 0), played: played.length };
}

/** Whether a game is short enough to read whole, and holds a turn a player chose. */
export function isAnalysable(game: AnalysableGame): boolean {
    return game.played > 0 && game.turns <= analysisTurnCap;
}

function botsOf(record: GameRecord): string[] {
    return record.kind === `bots` ? [record.challengerBotId, record.destBotId] : [record.botId];
}

/** Whether any user seated in the game keeps their games out of public analysis. */
export function gameOptedOut(query: Query, userIds: readonly string[]): boolean {
    if (userIds.length === 0) return false;
    return query.select({ n: count() }).from(users).where(and(inArray(users.id, [...userIds]), eq(users.analysisOptOut, 1))).get()?.n !== 0;
}

export function userOptedOut(query: Query, userId: string): boolean {
    return query.select({ out: users.analysisOptOut }).from(users).where(eq(users.id, userId)).get()?.out === 1;
}

/**
 * Sets a user's opt-out; opting out deletes the community readings of every
 * game they played. Answers the ids deleted, so pending work can stop.
 */
export function setOptOut(query: Query, userId: string, optedOut: boolean): string[] {
    return query.transaction((tx) => {
        tx.update(users)
            .set({ analysisOptOut: optedOut ? 1 : 0 })
            .where(eq(users.id, userId))
            .run();
        if (!optedOut) return [];
        return tx
            .delete(analyses)
            .where(inArray(analyses.gameId, tx.select({ id: games.id }).from(games).where(eq(games.userId, userId))))
            .returning({ id: analyses.id })
            .all()
            .map((row) => row.id);
    });
}

/** A whole-game reading's stored row. */
export interface AnalysisRow {
    readonly id: string;
    readonly gameId: string;
    readonly analyzerBotId: string | null;
    readonly analyzerName: string | null;
    readonly analyzerVersion: string | null;
    /** How the analyzer's heuristic read, as it declared when it took the reading. */
    readonly analyzerValues: AnalyzerValues;
    /** Whether the analyzer's owner sat in the game when the analyzer took it. */
    readonly involved: boolean;
    readonly ownerName: string | null;
    readonly namedBotId: string | null;
    readonly requestedBy: string | null;
    readonly status: AnalysisStatus;
    readonly failure: AnalysisFailure | null;
    readonly failedTurn: number | null;
    readonly seconds: number;
    readonly createdAt: number;
    readonly finishedAt: number | null;
}

function rowsWhere(query: Query, condition: ReturnType<typeof and>): AnalysisRow[] {
    return query
        .select({
            id: analyses.id,
            gameId: analyses.gameId,
            analyzerBotId: analyses.analyzerBotId,
            botName: bots.name,
            botDeletedAt: bots.deletedAt,
            analyzerVersion: analyses.analyzerVersion,
            analyzerScale: analyses.analyzerScale,
            analyzerCutInaccuracy: analyses.analyzerCutInaccuracy,
            analyzerCutMistake: analyses.analyzerCutMistake,
            analyzerCutBlunder: analyses.analyzerCutBlunder,
            analyzerMeaning: analyses.analyzerMeaning,
            involved: analyses.involved,
            ownerName: owners.name,
            ownerDeletedAt: owners.deletedAt,
            namedBotId: analyses.namedBotId,
            requestedBy: analyses.requestedBy,
            status: analyses.status,
            failure: analyses.failure,
            failedTurn: analyses.failedTurn,
            seconds: analyses.seconds,
            createdAt: analyses.createdAt,
            finishedAt: analyses.finishedAt,
        })
        .from(analyses)
        .leftJoin(bots, eq(analyses.analyzerBotId, bots.id))
        .leftJoin(owners, eq(bots.ownerId, owners.id))
        .where(condition)
        .orderBy(asc(analyses.createdAt), asc(analyses.id))
        .all()
        .map((row) => ({
            id: row.id,
            gameId: row.gameId,
            analyzerBotId: row.analyzerBotId,
            analyzerName: row.botName === null ? null : shownBot(row.botName, row.botDeletedAt).name,
            analyzerVersion: row.analyzerVersion,
            analyzerValues: storedValues({
                scale: row.analyzerScale,
                inaccuracy: row.analyzerCutInaccuracy,
                mistake: row.analyzerCutMistake,
                blunder: row.analyzerCutBlunder,
                meaning: row.analyzerMeaning,
            }),
            involved: row.involved === 1,
            ownerName: row.ownerName === null || row.ownerDeletedAt !== null ? null : shownUser(row.ownerName, row.ownerDeletedAt).name,
            namedBotId: row.namedBotId,
            requestedBy: row.requestedBy,
            // The status and failure checks admit only these values.
            status: row.status as AnalysisStatus,
            failure: row.failure as AnalysisFailure | null,
            failedTurn: row.failedTurn,
            seconds: row.seconds,
            createdAt: row.createdAt,
            finishedAt: row.finishedAt,
        }));
}

/** A game's whole-game readings, oldest first. */
export function analysesOfGame(query: Query, gameId: string): AnalysisRow[] {
    return rowsWhere(query, and(eq(analyses.gameId, gameId)));
}

/** Readings queued or running, as a process left them, oldest first. */
export function pendingAnalyses(query: Query): AnalysisRow[] {
    return rowsWhere(query, and(inArray(analyses.status, [`queued`, `running`])));
}

export function insertAnalysis(query: Query, row: { id: string; gameId: string; namedBotId: string | null; requestedBy: string; seconds: number; createdAt: number }): void {
    query.insert(analyses).values({ ...row, status: `queued` }).run();
}

// Each write answers whether the reading is still there: the operator, an
// opt-out, or a deleted analyzer may have removed it meanwhile.

export function startAnalysis(
    query: Query,
    id: string,
    analyzer: { botId: string; version: string | null; values: AnalyzerValues; involved: boolean; seconds: number },
    at: number,
): boolean {
    return (
        query
            .update(analyses)
            .set({
                status: `running`,
                analyzerBotId: analyzer.botId,
                analyzerVersion: analyzer.version,
                ...analysisValueColumns(analyzer.values),
                involved: analyzer.involved ? 1 : 0,
                seconds: analyzer.seconds,
                startedAt: at,
            })
            .where(eq(analyses.id, id))
            .run().changes > 0
    );
}

export function requeueAnalysis(query: Query, id: string): boolean {
    return (
        query
            .update(analyses)
            .set({ status: `queued`, analyzerBotId: null, analyzerVersion: null, ...analysisValueColumns(null), involved: 0, startedAt: null })
            .where(eq(analyses.id, id))
            .run().changes > 0
    );
}

export function failAnalysis(query: Query, id: string, failure: AnalysisFailure, failedTurn: number | null, at: number): boolean {
    return (
        query
            .update(analyses)
            .set({
                status: `failed`,
                failure,
                failedTurn,
                finishedAt: at,
                ...(failure === `expired` ? { analyzerBotId: null, analyzerVersion: null, ...analysisValueColumns(null), involved: 0 } : {}),
            })
            .where(eq(analyses.id, id))
            .run().changes > 0
    );
}

/** Marks a reading done and writes its lines, in one transaction. */
export function finishAnalysis(query: Query, id: string, turns: readonly AnalysisTurn[], at: number): boolean {
    return query.transaction((tx) => {
        if (tx.update(analyses).set({ status: `done`, finishedAt: at }).where(eq(analyses.id, id)).run().changes === 0) return false;
        const rows = turns.flatMap((turn) => turn.lines.map((line, rank) => ({ analysisId: id, turn: turn.turn, rank, ...lineColumns(line) })));
        // A statement binds at most so many values, so the lines go in batches.
        for (let start = 0; start < rows.length; start += 100) tx.insert(analysisLines).values(rows.slice(start, start + 100)).run();
        return true;
    });
}

/** Deletes a reading with its lines, answering its game; undefined when there was none. */
export function deleteAnalysis(query: Query, id: string): { gameId: string } | undefined {
    return query.delete(analyses).where(eq(analyses.id, id)).returning({ gameId: analyses.gameId }).get();
}

/** Finished readings' lines, by reading and then turn. */
export function linesOf(query: Query, ids: readonly string[]): Map<string, AnalysisTurn[]> {
    const turns = new Map<string, AnalysisTurn[]>();
    if (ids.length === 0) return turns;
    const rows = query
        .select()
        .from(analysisLines)
        .where(inArray(analysisLines.analysisId, [...ids]))
        .orderBy(asc(analysisLines.analysisId), asc(analysisLines.turn), asc(analysisLines.rank))
        .all();
    for (const row of rows) {
        const list = turns.get(row.analysisId) ?? [];
        turns.set(row.analysisId, list);
        const last = list.at(-1);
        const line = lineOf(row);
        if (last?.turn === row.turn) last.lines.push(line);
        else list.push({ turn: row.turn, toMove: sideToMove(row.turn), lines: [line] });
    }
    return turns;
}

/** Each bot seat's own lines, by side and turn, for a finished game. */
export function ownLinesOf(query: Query, gameId: string, openingPlies: number): Record<Side, AnalysisTurn[]> {
    const firstTurn = (openingPlies + 1) / 2;
    const rows = query
        .select({ seq: ownLines.seq, rank: ownLines.rank, side: moves.side, firstX: ownLines.firstX, firstY: ownLines.firstY, secondX: ownLines.secondX, secondY: ownLines.secondY, heuristic: ownLines.heuristic, winIn: ownLines.winIn })
        .from(ownLines)
        .innerJoin(moves, and(eq(ownLines.gameId, moves.gameId), eq(ownLines.seq, moves.seq)))
        .where(eq(ownLines.gameId, gameId))
        .orderBy(asc(ownLines.seq), asc(ownLines.rank))
        .all();
    const views: Record<Side, AnalysisTurn[]> = { x: [], o: [] };
    for (const row of rows) {
        // The side check admits only x and o.
        const list = views[row.side as Side];
        const turn = firstTurn + row.seq - 1;
        const last = list.at(-1);
        const line = lineOf(row);
        if (last?.turn === turn) last.lines.push(line);
        else list.push({ turn, toMove: sideToMove(turn), lines: [line] });
    }
    return views;
}

/** Each bot seat's values for a game, by side: scale 1 and no cuts where it published no evaluation or declared none. */
export function ownValuesOf(query: Query, gameId: string): Record<Side, AnalyzerValues> {
    const rows = query.select().from(ownValues).where(eq(ownValues.gameId, gameId)).all();
    const of = (side: Side) => {
        const row = rows.find((each) => each.side === side);
        return storedValues({ scale: row?.scale ?? null, inaccuracy: row?.cutInaccuracy ?? null, mistake: row?.cutMistake ?? null, blunder: row?.cutBlunder ?? null, meaning: row?.meaning ?? null });
    };
    return { x: of(`x`), o: of(`o`) };
}

/**
 * Stores a bot's own lines for the turn it played as `seq`, and, at its first, how its heuristic reads
 * as its analyzer declaration stands, so a later declaration never rereads the game.
 */
export function insertOwnLines(query: Query, turn: { gameId: string; seq: number; side: Side; botId: string }, lines: readonly AnalysisLine[]): void {
    if (lines.length === 0) return;
    query.transaction((tx) => {
        tx.insert(ownLines)
            .values(lines.map((line, rank) => ({ gameId: turn.gameId, seq: turn.seq, rank, ...lineColumns(line) })))
            .run();
        const declared = tx.select(analyzerColumns).from(bots).where(eq(bots.id, turn.botId)).get();
        const values = declared === undefined ? null : storedAnalyzer(declared)?.values;
        const columns = valueColumns(values);
        tx.insert(ownValues)
            .values({ gameId: turn.gameId, side: turn.side, scale: columns.scale, cutInaccuracy: columns.inaccuracy, cutMistake: columns.mistake, cutBlunder: columns.blunder, meaning: columns.meaning })
            .onConflictDoNothing()
            .run();
    });
}

/** The number of finished readings of each game among `gameIds`. */
export function doneCounts(query: Query, gameIds: readonly string[]): Map<string, number> {
    if (gameIds.length === 0) return new Map();
    const rows = query
        .select({ gameId: analyses.gameId, n: count() })
        .from(analyses)
        .where(and(inArray(analyses.gameId, [...gameIds]), eq(analyses.status, `done`)))
        .groupBy(analyses.gameId)
        .all();
    return new Map(rows.map((row) => [row.gameId, row.n]));
}

/** A game's readings that count against new ones: finished and pending, with their analyzers' owners. */
export function standingOf(query: Query, gameId: string): { done: number; pending: number; analyzers: string[]; owners: string[] } {
    const rows = query
        .select({ status: analyses.status, botId: analyses.analyzerBotId, ownerId: bots.ownerId })
        .from(analyses)
        .leftJoin(bots, eq(analyses.analyzerBotId, bots.id))
        .where(and(eq(analyses.gameId, gameId), ne(analyses.status, `failed`)))
        .all();
    return {
        done: rows.filter((row) => row.status === `done`).length,
        pending: rows.filter((row) => row.status !== `done`).length,
        analyzers: rows.flatMap((row) => (row.botId === null ? [] : [row.botId])),
        owners: rows.flatMap((row) => (row.ownerId === null ? [] : [row.ownerId])),
    };
}

/** The whole-game readings a user asked for since `since`, and those still pending. */
export function userRequests(query: Query, userId: string, since: number): { today: number; pending: number } {
    const today = query.select({ n: count() }).from(analyses).where(and(eq(analyses.requestedBy, userId), gte(analyses.createdAt, since))).get()?.n ?? 0;
    const pending = query
        .select({ n: count() })
        .from(analyses)
        .where(and(eq(analyses.requestedBy, userId), or(eq(analyses.status, `queued`), eq(analyses.status, `running`))))
        .get()?.n;
    return { today, pending: pending ?? 0 };
}

/** The games with a finished reading, as a filter on the games table. */
export const analyzedGame = sql`exists (select 1 from ${analyses} where ${analyses.gameId} = ${games.id} and ${analyses.status} = 'done')`;

/** Readings a user asked for, as their export lists them. */
export function requestsOf(query: Query, userId: string): { id: string; gameId: string; status: AnalysisStatus; createdAt: number }[] {
    return query
        .select({ id: analyses.id, gameId: analyses.gameId, status: analyses.status, createdAt: analyses.createdAt })
        .from(analyses)
        .where(eq(analyses.requestedBy, userId))
        .orderBy(desc(analyses.createdAt))
        .all()
        // The status check admits only these values.
        .map((row) => ({ ...row, status: row.status as AnalysisStatus }));
}

function analysisValueColumns(values: AnalyzerValues | null) {
    const columns = valueColumns(values);
    return {
        analyzerScale: columns.scale,
        analyzerCutInaccuracy: columns.inaccuracy,
        analyzerCutMistake: columns.mistake,
        analyzerCutBlunder: columns.blunder,
        analyzerMeaning: columns.meaning,
    };
}

function sideToMove(turn: number): Side {
    return turn % 2 === 1 ? `o` : `x`;
}

function lineColumns(line: AnalysisLine) {
    const [first, second] = line.cells;
    return {
        firstX: first?.x ?? 0,
        firstY: first?.y ?? 0,
        secondX: second?.x ?? 0,
        secondY: second?.y ?? 0,
        heuristic: line.heuristic ?? null,
        winIn: line.winIn ?? null,
    };
}

function lineOf(row: { firstX: number; firstY: number; secondX: number; secondY: number; heuristic: number | null; winIn: number | null }): AnalysisLine {
    return {
        cells: [
            { x: row.firstX, y: row.firstY },
            { x: row.secondX, y: row.secondY },
        ],
        ...(row.heuristic === null ? {} : { heuristic: row.heuristic }),
        ...(row.winIn === null ? {} : { winIn: row.winIn }),
    };
}

