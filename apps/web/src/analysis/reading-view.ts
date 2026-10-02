import { forcedWinner, valueWords, type AxialCoord, type HtttxPositionEvaluation, type Side } from '@hexo-arena/contract';
import { playTurn, type Setup } from '@hexo-arena/rules';
import { cellText } from './notation';
import type { Reading } from './sources';

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
    return reading.lines.slice(0, Math.min(count, lineLetters.length)).map((line, index) => {
        const [first, second] = line.cells;
        const completesSix = playTurn(position, [first]).ok;
        const cells: ShownLine[`cells`] = completesSix ? [first] : [first, second];
        return {
            letter: lineLetters[index] ?? ``,
            cells,
            evaluation: line.evaluation,
            completesSix,
            value: valueWords(line.evaluation, { kind: `line`, mover, completesSix }) ?? ``,
            cellsText: cells.map(cellText).join(` `),
        };
    });
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
