import {
    analysisLinesMax,
    forcedWinner,
    forcedWinsAround,
    judgeTurn,
    judgmentRuns,
    playerOf,
    sideValue,
    turnsOnBoard,
    valueWords,
    type AnalysisList,
    type AnalysisTurn,
    type AnalyzerValues,
    type AxialCoord,
    type BoardFacts,
    type GameCell,
    type ForcedWin,
    type ForcedWinsAround,
    type HtttxPositionEvaluation,
    type Judgment,
    type JudgmentRun,
    type JudgmentSeverity,
    type OwnAnalysis,
    type Side,
} from '@hexo-arena/contract';
import { otherPlayer, positionKey, sixesBlockable, winner, winsThisTurn, type Setup } from '@hexo-arena/rules';
import { afterWords, drawnValue, shownLinesOf, type AfterReading, type ShownLine } from './reading-view';
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

/** What the board says around a played turn, as judging reads it under every analyzer. */
export function boardFactsOf(line: GameLine, turn: number): BoardFacts {
    const { stones, toMove } = setupBefore(line, turn);
    const opponent = otherPlayer(toMove);
    const after = [...stones, ...turnCells(line, turn).map((cell) => ({ ...cell, player: toMove }))];
    return { sixOnBoard: winsThisTurn(stones, toMove), sixLeft: winsThisTurn(after, opponent), sixesUnblockable: !sixesBlockable(stones, opponent) };
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
    /** The value after the turn in words, on its analyzer's scale; null where the reading has none yet. */
    readonly value: string | null;
    readonly judgment: Judgment | null;
    /** The forced wins before and after the turn, from the board's facts and the reading; null where either reading is missing. */
    readonly forced: ForcedWinsAround | null;
    /** On a value drop, how far the mover's value fell on its analyzer's scale. */
    readonly drop: number | null;
    /** How the values of the reading that read this turn read. */
    readonly values: AnalyzerValues;
}

/** The lines of a turn's reading as the board and the explanation name them, A first, on its analyzer's scale. */
export function turnLines(line: GameLine, read: TurnRead): ShownLine[] {
    return shownLinesOf(read.options, setupBefore(line, read.turn), read.side, read.options.length, read.values);
}

/**
 * A point of the graph: the value of the board after a turn as it draws, x-positive on -1 to 1,
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

/** A turn whose position held a forced win for its mover, which the graph shades on that side's half. */
export interface GraphHold {
    readonly turn: number;
    readonly side: Side;
}

/** Judged turns by side and severity. */
export type MarkCounts = Readonly<Record<Side, Readonly<Record<JudgmentSeverity, number>>>>;

/**
 * One reading of a whole game, turn by turn, as the drawer, the graph, and the board show it:
 * its points and marks, the turns that held a forced win for their mover, the runs its marks fold into,
 * and what its values mean, which decides how the graph draws them.
 */
export interface GameReading {
    readonly turns: ReadonlyMap<number, TurnRead>;
    readonly points: readonly GraphPoint[];
    readonly marks: readonly GraphMark[];
    readonly counts: MarkCounts;
    readonly holds: readonly GraphHold[];
    readonly runs: readonly JudgmentRun[];
    readonly meaning: AnalyzerValues[`meaning`];
}

/**
 * A community analyzer's reading of a game, from the positions it has read so far.
 * Each turn's value after it is the played turn's own evaluation where the reading lists it,
 * else the best line's at the next position, a forced win there counting that line's own turn;
 * a turn that completed six is its mover's win.
 * The board after the opening is the first point, so the graph starts where play does.
 * Turns are judged only when `judged`, as a reading still running may yet change its mind,
 * by the board's facts and the reading's forced wins, and by its value drops on the `values` its analyzer declared.
 */
export function communityReading(line: GameLine, turns: readonly AnalysisTurn[], judged: boolean, values: AnalyzerValues): GameReading {
    const byTurn = linesByTurn(turns);
    const reads = new Map<number, TurnRead>();
    const points: GraphPoint[] = [];
    const holds: GraphHold[] = [];
    const opening = byTurn.get(line.firstTurn)?.[0];
    if (opening !== undefined) points.push(pointOf(line.firstTurn - 1, opening.evaluation, null, values));
    for (let turn = line.firstTurn; turn <= line.lastTurn; turn += 1) {
        const options = byTurn.get(turn) ?? [];
        const side = moverOf(turn);
        const played = turnCells(line, turn);
        const completesSix = line.sixAtEnd && turn === line.lastTurn;
        const nextBest = byTurn.get(turn + 1)?.[0]?.evaluation ?? null;
        const listed = options.find((option) => sameCells(option.cells, played))?.evaluation;
        const source: AfterReading | null = completesSix ? null : listed !== undefined ? { kind: `played`, evaluation: listed } : nextBest === null ? null : { kind: `next`, evaluation: nextBest, mover: moverOf(turn + 1) };
        const after = source?.evaluation ?? null;
        // A six is known from the board, but it joins the graph only once the reading reaches it.
        const read = completesSix ? options.length > 0 : after !== null;
        // The board is read only for a turn the reading reaches on both sides, as long games make it the costliest part.
        const readings = !completesSix && options.length > 0 && after !== null ? { before: options, nextBest, board: boardFactsOf(line, turn), values } : null;
        const playedTurn = { turn, side, cells: played, opening: false, completesSix };
        const forced = readings === null ? null : forcedWinsAround(playedTurn, readings);
        const judgment = judged && readings !== null ? judgeTurn(playedTurn, readings) : null;
        const best = options[0];
        const drop = judgment?.reason === `value-drop` && best !== undefined && after !== null ? dropOf(best.evaluation, after, side, values) : null;
        // A forced win after the turn, the board's first, as a six left, decides its value and pins its point.
        const decided = forced?.after ?? null;
        const value = !read ? null : completesSix ? sixWords(side) : decided !== null ? winWords(decided) : source === null ? null : afterWords(source, values);
        reads.set(turn, { turn, side, options, after, completesSix, value, judgment, forced, drop, values });
        // The turn that completes six held its mover's win as surely as any.
        if (forced?.before?.winner === side || (completesSix && read)) holds.push({ turn, side });
        if (completesSix && read) points.push({ turn, value: side === `x` ? 1 : -1, forced: side, series: null });
        else if (decided !== null) points.push({ turn, value: decided.winner === `x` ? 1 : -1, forced: decided.winner, series: null });
        else if (after !== null) points.push(pointOf(turn, after, null, values));
    }
    return { turns: reads, points, ...marksOf(reads, points), holds, runs: judgmentRuns(reads.values()), meaning: values.meaning };
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
            const value = completesSix ? sixWords(view.side) : after === null ? null : afterWords({ kind: `played`, evaluation: after }, view.values);
            reads.set(turn.turn, { turn: turn.turn, side: view.side, options, after, completesSix, value, judgment: null, forced: null, drop: null, values: view.values });
            if (after !== null) points.push(pointOf(turn.turn, after, view.side, view.values));
        }
    }
    points.sort((a, b) => a.turn - b.turn);
    // Two seats' views may read differently; the graph names them raw unless both read as expected.
    const meaning = views.length > 0 && views.every((view) => view.values.meaning === `expected`) ? `expected` : `raw`;
    return { turns: reads, points, marks: [], counts: noCounts(), holds: [], runs: [], meaning };
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
                    reading: { by: botAuthor(analyzer), values: analyzer.values, lines, seconds: analysis.seconds, final: true, elapsedMs: null },
                    ask: { lines: analysisLinesMax, seconds: analysis.seconds },
                });
            } else if (analysis.kind === `own`) {
                kept.push({
                    ids: [ownSourceId(gameId, analysis.side)],
                    key,
                    reading: { by: { kind: `own`, name: analysis.player, side: analysis.side }, values: analysis.values, lines, seconds: 0, final: true, elapsedMs: null },
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

function pointOf(turn: number, evaluation: HtttxPositionEvaluation, series: Side | null, values: AnalyzerValues): GraphPoint {
    return { turn, value: drawnValue(evaluation, values), forced: forcedWinner(evaluation), series };
}

// How far the mover's value fell from its analyzer's best line to the board after the turn, on its declared scale.
function dropOf(best: HtttxPositionEvaluation, after: HtttxPositionEvaluation, side: Side, values: AnalyzerValues): number | null {
    const before = sideValue(best, side, values.scale);
    const now = sideValue(after, side, values.scale);
    return before === null || now === null ? null : Math.round((before - now) * 100) / 100;
}

// A forced win in words, as a board evaluation of it reads: an odd count of turns, its winner's first, wins in its own turns.
function winWords(win: ForcedWin): string | null {
    return valueWords({ win_in: (win.winner === `x` ? 1 : -1) * (2 * win.turns - 1) }, { kind: `board` });
}

function sixWords(side: Side): string | null {
    return valueWords({}, { kind: `line`, mover: side, completesSix: true });
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
