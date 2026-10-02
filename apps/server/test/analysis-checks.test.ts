import { internalToWire, type HtttxMoveOption, type HtttxPositionEvaluation } from '@hexo-arena/contract';
import type { Player, Setup, Stone } from '@hexo-arena/rules';
import { describe, expect, it } from 'vitest';
import { checkReading, ownLines } from '../src/analysis-checks';

type Cell = readonly [number, number];

function stones(player: Player, ...cells: readonly Cell[]): Stone[] {
    return cells.map(([x, y]) => ({ x, y, player }));
}

function option(first: Cell, second: Cell, evaluation?: HtttxPositionEvaluation): HtttxMoveOption {
    const pieces = [first, second].map(([x, y]) => internalToWire({ x, y }));
    return evaluation === undefined ? { pieces } : { pieces, evaluation };
}

// A quiet board, o to move: no side holds four in a window.
const quiet: Setup = { stones: [...stones(0, [0, 0], [3, 3]), ...stones(1, [1, 0], [0, 2])], toMove: 1 };

// x to move with four in a row on the x axis, open at both ends.
const xToWin: Setup = { stones: [...stones(0, [0, 0], [1, 0], [2, 0], [3, 0]), ...stones(1, [0, 2], [1, 2], [5, 5])], toMove: 0 };

// o to move, and x would win next turn unless o blocks both ends.
const xThreatens: Setup = { stones: [...stones(0, [0, 0], [1, 0], [2, 0], [3, 0], [9, 9]), ...stones(1, [0, 2], [1, 2], [2, 2])], toMove: 1 };

describe('checkReading', () => {
    it('keeps the move and the evaluated considerations up to the lines asked, best first, in engine cells', () => {
        const reading = checkReading(
            quiet,
            {
                move: option([2, 1], [1, 1], { heuristic: -0.2 }),
                considerations: [option([4, 0], [4, 1]), option([-1, 0], [-1, 1], { heuristic: -0.1 }), option([2, 2], [3, 2], { heuristic: 0 })],
            },
            2,
        );
        expect(reading).toEqual({
            ok: true,
            lines: [
                { cells: [{ x: 2, y: 1 }, { x: 1, y: 1 }], heuristic: -0.2 },
                { cells: [{ x: -1, y: 0 }, { x: -1, y: 1 }], heuristic: -0.1 },
            ],
        });
    });

    it('fails a move without an evaluation, or with an empty one', () => {
        expect(checkReading(quiet, { move: option([2, 1], [1, 1]) }, 1)).toEqual({ ok: false, failure: `no_evaluation` });
        expect(checkReading(quiet, { move: option([2, 1], [1, 1], {}) }, 1)).toEqual({ ok: false, failure: `no_evaluation` });
    });

    it('fails a line on a stone, out of reach, on one cell twice, or repeating another in any order', () => {
        for (const move of [option([0, 0], [1, 1], { heuristic: 0 }), option([20, 20], [1, 1], { heuristic: 0 }), option([1, 1], [1, 1], { heuristic: 0 })]) {
            expect(checkReading(quiet, { move }, 3), JSON.stringify(move)).toEqual({ ok: false, failure: `illegal` });
        }
        const repeated = { move: option([2, 1], [1, 1], { heuristic: 0 }), considerations: [option([1, 1], [2, 1], { heuristic: 0.1 })] };
        expect(checkReading(quiet, repeated, 2)).toEqual({ ok: false, failure: `illegal` });
    });

    it('fails an evaluation past the bounds', () => {
        for (const evaluation of [{ heuristic: 1e7 }, { win_in: 1001 }]) {
            expect(checkReading(quiet, { move: option([2, 1], [1, 1], evaluation) }, 1), JSON.stringify(evaluation)).toEqual({ ok: false, failure: `inconsistent` });
        }
    });

    it('wants six from a side that can complete it, and a six valued for its mover', () => {
        expect(checkReading(xToWin, { move: option([-1, 0], [4, 0], { win_in: 1 }) }, 1)).toEqual({
            ok: true,
            lines: [{ cells: [{ x: -1, y: 0 }, { x: 4, y: 0 }], winIn: 1 }],
        });
        expect(checkReading(xToWin, { move: option([4, 0], [5, 0], { heuristic: 1 }) }, 1).ok).toBe(true);
        expect(checkReading(xToWin, { move: option([-1, 0], [4, 0], { heuristic: -0.5 }) }, 1)).toEqual({ ok: false, failure: `inconsistent` });
        expect(checkReading(xToWin, { move: option([7, 7], [8, 8], { heuristic: 0.9 }) }, 1)).toEqual({ ok: false, failure: `inconsistent` });
        const five: Setup = { stones: [...stones(0, [0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), ...stones(1, [0, 2], [1, 2], [2, 2], [3, 2])], toMove: 0 };
        expect(checkReading(five, { move: option([5, 0], [0, 2], { heuristic: 1 }) }, 1).ok).toBe(true);
    });

    it('gives the odd turns of a forced win to the side to move after the line', () => {
        expect(checkReading(quiet, { move: option([2, 1], [1, 1], { win_in: -2 }) }, 1).ok).toBe(true);
        expect(checkReading(quiet, { move: option([2, 1], [1, 1], { win_in: 3 }) }, 1).ok).toBe(true);
        expect(checkReading(quiet, { move: option([2, 1], [1, 1], { win_in: -3 }) }, 1)).toEqual({ ok: false, failure: `inconsistent` });
        expect(checkReading(quiet, { move: option([2, 1], [1, 1], { win_in: 2 }) }, 1)).toEqual({ ok: false, failure: `inconsistent` });
    });

    it('values a line that leaves the opponent six for the opponent, and claims a win at once only where one exists', () => {
        const leaves = option([3, 2], [-3, 3], { heuristic: -0.4 });
        expect(checkReading(xThreatens, { move: leaves }, 1)).toEqual({ ok: false, failure: `inconsistent` });
        expect(checkReading(xThreatens, { move: option([3, 2], [-3, 3], { win_in: 1 }) }, 1).ok).toBe(true);
        expect(checkReading(xThreatens, { move: option([3, 2], [-3, 3], { heuristic: 0.8 }) }, 1).ok).toBe(true);
        expect(checkReading(xThreatens, { move: option([-1, 0], [4, 0], { heuristic: 0.1 }) }, 1).ok).toBe(true);
        expect(checkReading(xThreatens, { move: option([-1, 0], [4, 0], { win_in: 1 }) }, 1)).toEqual({ ok: false, failure: `inconsistent` });
    });
});

describe('ownLines', () => {
    it('leads with the move played and keeps the considerations that pass, up to the count', () => {
        const lines = ownLines(
            quiet,
            {
                move: option([2, 1], [1, 1], { heuristic: -0.3 }),
                considerations: [option([0, 0], [1, 1], { heuristic: 0 }), option([-1, 0], [-1, 1], { heuristic: -0.1 }), option([2, 2], [3, 2], { heuristic: 0 }), option([4, 4], [4, 5], { heuristic: 0 })],
            },
            2,
        );
        expect(lines?.map((line) => line.cells[0])).toEqual([
            { x: 2, y: 1 },
            { x: -1, y: 0 },
            { x: 2, y: 2 },
        ]);
    });

    it('drops the whole view when the move carries no evaluation or a false one', () => {
        expect(ownLines(quiet, { move: option([2, 1], [1, 1]) }, 2)).toBeNull();
        expect(ownLines(xThreatens, { move: option([-1, 0], [4, 0], { win_in: 1 }) }, 2)).toBeNull();
    });
});
