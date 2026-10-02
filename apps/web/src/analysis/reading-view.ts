import { forcedWinner, valueWords, type AxialCoord, type HtttxPositionEvaluation, type Side } from '@hexo-arena/contract';
import { playTurn, type Setup } from '@hexo-arena/rules';
import { cellText } from './notation';
import type { Reading, ReadingLine } from './sources';

/** The letters lines go by, best first. */
export const lineLetters = [`A`, `B`, `C`] as const;

/** A line as the panel and the board show it: its letter, the cells it plays, and its value in words. */
export interface ShownLine {
    readonly letter: string;
    /** One cell when the first completes six, which ends the turn; else both. */
    readonly cells: readonly [AxialCoord] | readonly [AxialCoord, AxialCoord];
    readonly evaluation: HtttxPositionEvaluation;
    readonly completesSix: boolean;
    readonly value: string;
    readonly cellsText: string;
}

/**
 * A reading's lines as they show at a position, at most `count` of them, best first:
 * each value read for the side to move, who plays the line.
 */
export function shownLines(reading: Reading, position: Setup, mover: Side, count: number): ShownLine[] {
    return shownLinesOf(reading.lines, position, mover, count);
}

/**
 * Lines as they show at a position, at most `count` of them, best first, whoever read them.
 * A line completes six with its first stone, which ends the turn, or with both.
 */
export function shownLinesOf(lines: readonly ReadingLine[], position: Setup, mover: Side, count: number): ShownLine[] {
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
            value: lineWords(line.evaluation, mover, completesSix) ?? ``,
            cellsText: cells.map(cellText).join(` `),
        };
    });
}

/**
 * Where the value of the board after a turn comes from: the played turn's own line, whose evaluation describes that board,
 * or the next mover's best line from it, whose evaluation describes the board a turn later.
 */
export type AfterReading =
    | { readonly kind: `played`; readonly evaluation: HtttxPositionEvaluation }
    | { readonly kind: `next`; readonly evaluation: HtttxPositionEvaluation; readonly mover: Side };

/**
 * The value of the board after a turn in words, a forced win counting its winner's own turns from that board:
 * a win the next mover's best line finds for that mover counts the line's own turn too.
 */
export function afterWords(after: AfterReading): string | null {
    return after.kind === `played` ? valueWords(after.evaluation, { kind: `board` }) : lineWords(after.evaluation, after.mover, false);
}

// A line's value for its mover, from the position it is played from;
// a win in 1 for its own mover is a six it completes this very turn, whatever the board check found.
function lineWords(evaluation: HtttxPositionEvaluation, mover: Side, completesSix: boolean): string | null {
    if (!completesSix && forcedWinner(evaluation) === mover && Math.abs(evaluation.win_in ?? 0) === 1) return valueWords(evaluation, { kind: `board` });
    return valueWords(evaluation, { kind: `line`, mover, completesSix });
}

/**
 * Where the eval bar splits for a line, as x's share from 0 to 1:
 * a forced win, or a line that completes six, fills it for the winner;
 * a heuristic past 1 either way fills it as 1 does.
 */
export function xShare(line: ShownLine, mover: Side): number {
    const winner = line.completesSix ? mover : forcedWinner(line.evaluation);
    if (winner !== null) return winner === `x` ? 1 : 0;
    const heuristic = line.evaluation.heuristic ?? 0;
    const value = Number.isFinite(heuristic) ? Math.max(-1, Math.min(1, heuristic)) : 0;
    return (value + 1) / 2;
}
