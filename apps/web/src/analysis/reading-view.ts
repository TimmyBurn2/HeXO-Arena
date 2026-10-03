import { forcedWinner, playerOf, valueWords, type AnalyzerValues, type AxialCoord, type HtttxPositionEvaluation, type Side, type ValueText } from '@hexo-arena/contract';
import { playTurn, winsThisTurn, type Setup } from '@hexo-arena/rules';
import { cellText } from './notation';
import type { Reading, ReadingLine } from './sources';

/** The letters lines go by, best first. */
export const lineLetters = [`A`, `B`, `C`] as const;

/** A line as the panel and the board show it: its letter, the cells it plays, and its value in words and as it draws. */
export interface ShownLine {
    readonly letter: string;
    /** One cell when the first completes six, which ends the turn; else both. */
    readonly cells: readonly [AxialCoord] | readonly [AxialCoord, AxialCoord];
    readonly evaluation: HtttxPositionEvaluation;
    readonly completesSix: boolean;
    readonly value: ValueText;
    /** Where its value draws, x-positive, on -1 to 1, as `drawnValue` places it. */
    readonly drawn: number;
    readonly cellsText: string;
}

/** The share of each half a raw heuristic draws within, so that only a forced win reaches an edge. */
export const rawBand = 0.75;

/**
 * A reading's lines as they show at a position, at most `count` of them, best first:
 * each value read for the side to move, who plays the line, on the scale its analyzer declared.
 */
export function shownLines(reading: Reading, position: Setup, mover: Side, count: number): ShownLine[] {
    return shownLinesOf(reading.lines, position, mover, count, reading.values);
}

/**
 * Lines as they show at a position, at most `count` of them, best first, whoever read them, on `values`.
 * A line completes six with its first stone, which ends the turn, or with both.
 * Where the mover holds a six on the board, a line names the mover's forced win as the board's win in 1, never a longer one, as judging reads the board.
 */
export function shownLinesOf(lines: readonly ReadingLine[], position: Setup, mover: Side, count: number, values: AnalyzerValues): ShownLine[] {
    const sixHeld = winsThisTurn(position.stones, playerOf(mover));
    return lines.slice(0, Math.min(count, lineLetters.length)).map((line, index) => {
        const [first, second] = line.cells;
        const firstWins = playTurn(position, [first]).ok;
        const both = firstWins ? null : playTurn(position, [first, second]);
        const completesSix = firstWins || (both?.ok === true && both.win !== null);
        const cells: ShownLine[`cells`] = firstWins ? [first] : [first, second];
        return {
            letter: lineLetters[index] ?? ``,
            cells,
            evaluation: line.evaluation,
            completesSix,
            value: lineWords(line.evaluation, mover, completesSix, values, sixHeld) ?? { shown: ``, spoken: `` },
            drawn: completesSix ? (mover === `x` ? 1 : -1) : drawnValue(line.evaluation, values),
            cellsText: cells.map(cellText).join(` `),
        };
    });
}

/**
 * An evaluation as its analyzer means it: the heuristic divided by the scale it declared and held to -1 to 1,
 * where its values call a position decided; a forced win as it is.
 */
export function scaledEvaluation(evaluation: HtttxPositionEvaluation, values: AnalyzerValues): HtttxPositionEvaluation {
    const heuristic = evaluation.heuristic;
    if (heuristic === undefined || !Number.isFinite(heuristic)) return evaluation;
    return { ...evaluation, heuristic: Math.max(-1, Math.min(1, heuristic / values.scale)) };
}

/**
 * Where an evaluation draws, x-positive, on -1 to 1: a forced win at its winner's edge;
 * a heuristic on its analyzer's scale, an expected one as it is, the analyzer's win chance for x,
 * and a raw one, which only ranks, within the inner band.
 */
export function drawnValue(evaluation: HtttxPositionEvaluation, values: AnalyzerValues): number {
    const winner = forcedWinner(evaluation);
    if (winner !== null) return winner === `x` ? 1 : -1;
    const value = scaledEvaluation(evaluation, values).heuristic ?? 0;
    return values.meaning === `expected` ? value : value * rawBand;
}

/**
 * Where the value of the board after a turn comes from: the played turn's own line, whose evaluation describes that board,
 * or the next mover's best line from it, whose evaluation describes the board a turn later.
 */
export type AfterReading =
    | { readonly kind: `played`; readonly evaluation: HtttxPositionEvaluation }
    | { readonly kind: `next`; readonly evaluation: HtttxPositionEvaluation; readonly mover: Side };

/**
 * The value of the board after a turn in words, as its analyzer declared its values read,
 * a forced win counting its winner's own turns from that board:
 * a win the next mover's best line finds for that mover counts the line's own turn too.
 */
export function afterWords(after: AfterReading, values: AnalyzerValues): ValueText | null {
    return after.kind === `played` ? valueWords(after.evaluation, { kind: `board` }, values) : lineWords(after.evaluation, after.mover, false, values);
}

// A line's value for its mover, from the position it is played from;
// a win in 1 for its own mover is a six it completes this very turn, whatever the board check found,
// and a six the mover holds on the board makes any forced win of its own a win in 1, however long the line claims.
function lineWords(evaluation: HtttxPositionEvaluation, mover: Side, completesSix: boolean, values: AnalyzerValues, sixHeld = false): ValueText | null {
    if (!completesSix && forcedWinner(evaluation) === mover && (sixHeld || Math.abs(evaluation.win_in ?? 0) === 1)) {
        return valueWords({ win_in: mover === `x` ? 1 : -1 }, { kind: `board` }, values);
    }
    return valueWords(evaluation, { kind: `line`, mover, completesSix }, values);
}

/**
 * Where the eval bar splits for a line, as x's share from 0 to 1, as the graph draws the value:
 * a forced win, or a line that completes six, fills it for the winner; a heuristic splits it where its drawn value stands.
 */
export function xShare(line: ShownLine): number {
    return (line.drawn + 1) / 2;
}
