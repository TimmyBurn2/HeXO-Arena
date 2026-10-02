import {
    analysisLinesMax,
    forcedWinner,
    judgeTurn,
    playerOf,
    turnsOnBoard,
    valueWords,
    type AnalysisList,
    type AnalysisTurn,
    type AxialCoord,
    type GameCell,
    type HtttxPositionEvaluation,
    type Judgment,
    type JudgmentSeverity,
    type OwnAnalysis,
    type Side,
} from '@hexo-arena/contract';
import { positionKey, winner, type Setup } from '@hexo-arena/rules';
import { botAuthor, botSourceId, readingLineOf, type Reading, type ReadingAsk, type ReadingLine } from './sources';

/** A finished game's main line, as its readings are laid against it. */
export interface GameLine {
    readonly cells: readonly GameCell[];
    /** The first turn a player chose, the one after the opening. */
    readonly firstTurn: number;
    readonly lastTurn: number;
    /** Whether the last turn completed six, which leaves no board after it to read. */
    readonly sixAtEnd: boolean;
}

/** The main line of a game whose stones are `cells` in placement order, the first `openingPlies` of them its opening. */
export function gameLineOf(cells: readonly GameCell[], openingPlies: number): GameLine {
    const firstTurn = (openingPlies + 1) / 2;
    const lastTurn = turnsOnBoard(cells.length);
    const stones = cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) }));
    return { cells, firstTurn, lastTurn, sixAtEnd: lastTurn >= firstTurn && winner({ stones }) !== null };
}

/** The side that plays a turn: o the odd ones, after the origin x placed as turn 0. */
export function moverOf(turn: number): Side {
    return turn % 2 === 1 ? `o` : `x`;
}

/** The stones a turn placed: two, or one when its first completed six. */
export function turnCells(line: GameLine, turn: number): AxialCoord[] {
    return line.cells.slice(2 * turn - 1, 2 * turn + 1).map((cell) => ({ x: cell.x, y: cell.y }));
}

/** The position a turn was played from. */
export function setupBefore(line: GameLine, turn: number): Setup {
    return {
        stones: line.cells.slice(0, Math.max(1, 2 * turn - 1)).map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })),
        toMove: playerOf(moverOf(turn)),
    };
}

/** What one reading says of one played turn. */
export interface TurnRead {
    readonly turn: number;
    readonly side: Side;
    /** The reading's lines at the position the turn was played from, best first; empty where it read none. */
    readonly options: readonly ReadingLine[];
    /** The evaluation of the board after the turn: the played turn's own where a line names it, else the next position's best. */
    readonly after: HtttxPositionEvaluation | null;
    readonly completesSix: boolean;
    /** The value after the turn in words; null where the reading has none yet. */
    readonly value: string | null;
    readonly judgment: Judgment | null;
}

/**
 * A point of the graph: the value of the board after a turn, x-positive and held to -1 to 1,
 * with the side a forced win belongs to, which pins it to that side's edge.
 * `series` names the side whose own view it is, or null on a community reading's one trace.
 */
export interface GraphPoint {
    readonly turn: number;
    readonly value: number;
    readonly forced: Side | null;
    readonly series: Side | null;
}

/** A judged turn as the graph marks it. */
export interface GraphMark {
    readonly turn: number;
    readonly severity: JudgmentSeverity;
    readonly value: number;
}

/** Judged turns by side and severity. */
export type MarkCounts = Readonly<Record<Side, Readonly<Record<JudgmentSeverity, number>>>>;

/** One reading of a whole game, turn by turn, as the drawer, the graph, and the board show it. */
export interface GameReading {
    readonly turns: ReadonlyMap<number, TurnRead>;
    readonly points: readonly GraphPoint[];
    readonly marks: readonly GraphMark[];
    readonly counts: MarkCounts;
}

/**
 * Where an evaluation plots, x-positive: a forced win at its winner's edge,
 * a heuristic held to -1 to 1, where a reading's scale ends.
 */
export function plotValue(evaluation: HtttxPositionEvaluation): number {
    const winner = forcedWinner(evaluation);
    if (winner !== null) return winner === `x` ? 1 : -1;
    const heuristic = evaluation.heuristic ?? 0;
    return Number.isFinite(heuristic) ? Math.max(-1, Math.min(1, heuristic)) : 0;
}

/**
 * A community analyzer's reading of a game, from the positions it has read so far.
 * Each turn's value after it is the played turn's own evaluation where the reading lists it,
 * else the best line's at the next position; a turn that completed six is its mover's win.
 * The board after the opening is the first point, so the graph starts where play does.
 * Turns are judged only when `judged`, as a reading still running may yet change its mind.
 */
export function communityReading(line: GameLine, turns: readonly AnalysisTurn[], judged: boolean): GameReading {
    const byTurn = linesByTurn(turns);
    const reads = new Map<number, TurnRead>();
    const points: GraphPoint[] = [];
    const opening = byTurn.get(line.firstTurn)?.[0];
    if (opening !== undefined) points.push(pointOf(line.firstTurn - 1, opening.evaluation, null));
    for (let turn = line.firstTurn; turn <= line.lastTurn; turn += 1) {
        const options = byTurn.get(turn) ?? [];
        const side = moverOf(turn);
        const played = turnCells(line, turn);
        const completesSix = line.sixAtEnd && turn === line.lastTurn;
        const nextBest = byTurn.get(turn + 1)?.[0]?.evaluation ?? null;
        const after = completesSix ? null : (options.find((option) => sameCells(option.cells, played))?.evaluation ?? nextBest);
        // A six is known from the board, but it joins the graph only once the reading reaches it.
        const read = completesSix ? options.length > 0 : after !== null;
        const judgment = judged ? judgeTurn({ turn, side, cells: played, opening: false, completesSix }, { before: options, nextBest }) : null;
        reads.set(turn, { turn, side, options, after, completesSix, value: read ? afterWords(after, side, completesSix) : null, judgment });
        if (completesSix && read) points.push({ turn, value: side === `x` ? 1 : -1, forced: side, series: null });
        else if (after !== null) points.push(pointOf(turn, after, null));
    }
    return { turns: reads, points, ...marksOf(reads, points) };
}

/**
 * The bots' own views of a game: each seat's evaluation of the board after its own turns,
 * its played turn first among its lines, then what it considered.
 * Each side is its own series, and nothing is judged: a bot judging itself is no judgment.
 */
export function ownReading(line: GameLine, views: readonly OwnAnalysis[]): GameReading {
    const reads = new Map<number, TurnRead>();
    const points: GraphPoint[] = [];
    for (const view of views) {
        for (const turn of view.turns) {
            if (turn.turn < line.firstTurn || turn.turn > line.lastTurn || moverOf(turn.turn) !== view.side) continue;
            const options = turn.lines.map(readingLineOf);
            const after = options[0]?.evaluation ?? null;
            const completesSix = line.sixAtEnd && turn.turn === line.lastTurn;
            reads.set(turn.turn, { turn: turn.turn, side: view.side, options, after, completesSix, value: afterWords(after, view.side, completesSix), judgment: null });
            if (after !== null) points.push(pointOf(turn.turn, after, view.side));
        }
    }
    points.sort((a, b) => a.turn - b.turn);
    return { turns: reads, points, marks: [], counts: noCounts() };
}

/** The source id of a bot's own view of the turns it played in a game, one seat's. */
export function ownSourceId(gameId: string, side: Side): string {
    return `own:${gameId}:${side}`;
}

/** A reading kept with a game, to file under each of `ids` that holds none for its position yet. */
export interface StoredReading {
    readonly ids: readonly string[];
    readonly key: string;
    readonly reading: Reading;
    readonly ask: ReadingAsk;
}

/**
 * Every reading a game's list holds, by the key of the position it reads, so any line reaching that position finds it:
 * a community analyzer's under its name, and under any analyzer for the first that read a position,
 * so a stored reading answers whoever the analysis board asks;
 * a bot's own view under its seat.
 * A whole game is read for as many lines as its analyzer gives, so asking again for more would gain none.
 * A turn the line does not reach, or whose side to move disagrees, is left out.
 */
export function storedReadings(list: AnalysisList, gameId: string, line: GameLine): StoredReading[] {
    const keys = new Map<number, string>();
    const keyOf = (turn: number) => {
        const known = keys.get(turn);
        if (known !== undefined) return known;
        const key = positionKey(setupBefore(line, turn));
        keys.set(turn, key);
        return key;
    };
    const kept: StoredReading[] = [];
    for (const analysis of list.analyses) {
        const analyzer = analysis.kind === `community` ? analysis.analyzer : null;
        if (analysis.kind === `community` && analyzer === null) continue;
        for (const turn of analysis.turns) {
            if (turn.turn < 1 || turn.turn > line.lastTurn + (line.sixAtEnd ? 0 : 1) || turn.toMove !== moverOf(turn.turn)) continue;
            const lines = turn.lines.map(readingLineOf);
            const key = keyOf(turn.turn);
            if (analysis.kind === `community` && analyzer !== null) {
                kept.push({
                    ids: [botSourceId(analyzer.name), botSourceId(null)],
                    key,
                    reading: { by: botAuthor(analyzer), lines, seconds: analysis.seconds, final: true, elapsedMs: null },
                    ask: { lines: analysisLinesMax, seconds: analysis.seconds },
                });
            } else if (analysis.kind === `own`) {
                kept.push({
                    ids: [ownSourceId(gameId, analysis.side)],
                    key,
                    reading: { by: { kind: `own`, name: analysis.player, side: analysis.side }, lines, seconds: 0, final: true, elapsedMs: null },
                    ask: { lines: analysisLinesMax, seconds: 0 },
                });
            }
        }
    }
    return kept;
}

function linesByTurn(turns: readonly AnalysisTurn[]): Map<number, ReadingLine[]> {
    return new Map(turns.map((turn) => [turn.turn, turn.lines.map(readingLineOf)]));
}

function pointOf(turn: number, evaluation: HtttxPositionEvaluation, series: Side | null): GraphPoint {
    return { turn, value: plotValue(evaluation), forced: forcedWinner(evaluation), series };
}

function afterWords(after: HtttxPositionEvaluation | null, side: Side, completesSix: boolean): string | null {
    if (completesSix) return valueWords({}, { kind: `line`, mover: side, completesSix: true });
    return after === null ? null : valueWords(after, { kind: `board` });
}

function marksOf(reads: ReadonlyMap<number, TurnRead>, points: readonly GraphPoint[]): { marks: GraphMark[]; counts: MarkCounts } {
    const counts = noCounts();
    const marks: GraphMark[] = [];
    for (const read of reads.values()) {
        if (read.judgment === null) continue;
        counts[read.side][read.judgment.severity] += 1;
        const point = points.find((each) => each.turn === read.turn);
        if (point !== undefined) marks.push({ turn: read.turn, severity: read.judgment.severity, value: point.value });
    }
    return { marks, counts };
}

function noCounts(): Record<Side, Record<JudgmentSeverity, number>> {
    return { x: { inaccuracy: 0, mistake: 0, blunder: 0 }, o: { inaccuracy: 0, mistake: 0, blunder: 0 } };
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
