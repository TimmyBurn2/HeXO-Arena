import { describe, expect, it } from 'vitest';
import {
    analysisTurnCap,
    type EvaluatedLine,
    forcedWinner,
    judgeTurn,
    judgmentGlyphs,
    type PlayedTurn,
    sideValue,
    valueWords,
} from '../src';

type Pair = readonly [readonly [number, number], readonly [number, number]];

function line([[ax, ay], [bx, by]]: Pair, evaluation: EvaluatedLine[`evaluation`]): EvaluatedLine {
    return { cells: [{ x: ax, y: ay }, { x: bx, y: by }], evaluation };
}

function turn(number: number, side: PlayedTurn[`side`], [[ax, ay], [bx, by]]: Pair): PlayedTurn {
    return { turn: number, side, cells: [{ x: ax, y: ay }, { x: bx, y: by }], opening: false, completesSix: false };
}

// A mock game's readings, one analyzer's lines best first, and the turns played.
const turn6 = turn(6, `x`, [[5, -2], [-1, -1]]);
const before6 = [
    line([[5, -2], [-2, 0]], { heuristic: 0.17 }),
    line([[5, -2], [-1, 2]], { heuristic: 0.12 }),
    line([[5, -2], [-1, -1]], { heuristic: 0.05 }),
];
const turn14 = turn(14, `x`, [[2, 2], [-3, -1]]);
const before14 = [
    line([[2, -1], [-3, -1]], { heuristic: 0.33 }),
    line([[2, -1], [3, -1]], { heuristic: 0.28 }),
    line([[-3, -1], [0, -4]], { heuristic: 0.22 }),
];
const turn17 = turn(17, `o`, [[-1, -3], [3, -8]]);
const before17 = [
    line([[-1, -3], [-4, -1]], { heuristic: 0.08 }),
    line([[-4, -1], [-4, 0]], { heuristic: 0.13 }),
];
const turn38 = turn(38, `x`, [[-1, -6], [5, -6]]);
const before38 = [
    line([[-1, -6], [-2, -6]], { heuristic: -0.12 }),
    line([[-1, -6], [6, -6]], { heuristic: -0.18 }),
    line([[-1, -6], [5, -6]], { win_in: -5 }),
];

describe('judgeTurn', () => {
    it('marks a listed turn worth 0.12 less than the best an inaccuracy', () => {
        expect(judgeTurn(turn6, { before: before6, nextBest: null })).toEqual({ severity: `inaccuracy`, reason: `value-drop` });
    });

    it('finds the played turn among the lines in either stone order', () => {
        const swapped: PlayedTurn = { ...turn6, cells: [...turn6.cells].reverse() };
        expect(judgeTurn(swapped, { before: before6, nextBest: { heuristic: 0.9 } })).toEqual({ severity: `inaccuracy`, reason: `value-drop` });
    });

    it('reads an unlisted turn by the best line after it and marks a drop of 0.21 a mistake', () => {
        expect(judgeTurn(turn14, { before: before14, nextBest: { heuristic: 0.12 } })).toEqual({ severity: `mistake`, reason: `value-drop` });
    });

    it('judges o from its own side and marks a drop of 0.37 a blunder', () => {
        expect(sideValue({ heuristic: 0.08 }, `o`)).toBe(-0.08);
        expect(judgeTurn(turn17, { before: before17, nextBest: { heuristic: 0.45 } })).toEqual({ severity: `blunder`, reason: `value-drop` });
    });

    it('marks handing over a forced win from a near-even board a blunder', () => {
        expect(judgeTurn(turn38, { before: before38, nextBest: { heuristic: 0.5 } })).toEqual({ severity: `blunder`, reason: `allowed-win` });
    });

    it('leaves turns unmarked while the same side wins by force before and after', () => {
        const forcedFor = (winIn: number) => [line([[0, 9], [0, 10]], { win_in: winIn })];
        const t39 = turn(39, `o`, [[0, 9], [0, 10]]);
        const t40 = turn(40, `x`, [[0, 9], [0, 10]]);
        expect(judgeTurn(t39, { before: forcedFor(-4), nextBest: null })).toBeNull();
        expect(judgeTurn(t40, { before: forcedFor(-3), nextBest: null })).toBeNull();
    });

    it('never judges the turn that completes six', () => {
        const won: PlayedTurn = { ...turn(43, `o`, [[1, -7], [-1, -5]]), completesSix: true };
        expect(judgeTurn(won, { before: [line([[1, -7], [-1, -5]], { win_in: -1 })], nextBest: null })).toBeNull();
    });

    it('marks a missed forced win by how much value the mover kept', () => {
        const played = turn(20, `x`, [[1, 1], [2, 2]]);
        const before = (after: number) => [line([[3, 3], [4, 4]], { win_in: 2 }), line([[1, 1], [2, 2]], { heuristic: after })];
        const judged = (after: number) => judgeTurn(played, { before: before(after), nextBest: null });
        expect(judged(0.4)).toEqual({ severity: `blunder`, reason: `missed-win` });
        expect(judged(0.97)).toEqual({ severity: `inaccuracy`, reason: `missed-win` });
        expect(judged(0.95)?.severity).toBe(`inaccuracy`);
        expect(judged(0.9)?.severity).toBe(`mistake`);
        expect(judged(0.86)?.severity).toBe(`mistake`);
        expect(judged(0.85)?.severity).toBe(`blunder`);
    });

    it('marks an allowed forced win by how lost the mover already was', () => {
        const played = turn(20, `o`, [[1, 1], [2, 2]]);
        const judged = (best: number) =>
            judgeTurn(played, { before: [line([[3, 3], [4, 4]], { heuristic: best }), line([[1, 1], [2, 2]], { win_in: 3 })], nextBest: null });
        expect(judged(0.96)).toEqual({ severity: `inaccuracy`, reason: `allowed-win` });
        expect(judged(0.9)?.severity).toBe(`mistake`);
        expect(judged(0.5)?.severity).toBe(`blunder`);
    });

    it('compares values in the hundredths they are shown in, so a drop of exactly a cut earns it', () => {
        const played = turn(10, `x`, [[1, 1], [2, 2]]);
        const judged = (best: number, after: number) =>
            judgeTurn(played, { before: [line([[3, 3], [4, 4]], { heuristic: best })], nextBest: { heuristic: after } });
        expect(judged(0.3, 0.2)?.severity).toBe(`inaccuracy`);
        expect(judged(0.7, 0.5)?.severity).toBe(`mistake`);
        expect(judged(0.304, 0.206)).toBeNull();
        expect(judged(3, 0.7)?.severity).toBe(`blunder`);
        expect(judged(3, 0.85)?.severity).toBe(`inaccuracy`);
    });

    it('gives no mark for escaping a forced loss', () => {
        const played = turn(10, `x`, [[1, 1], [2, 2]]);
        expect(judgeTurn(played, { before: [line([[3, 3], [4, 4]], { win_in: -2 })], nextBest: { heuristic: -0.5 } })).toBeNull();
    });

    it('never judges opening turns, turns past the cap, or turns missing a reading', () => {
        const played = turn(analysisTurnCap, `x`, [[1, 1], [2, 2]]);
        const readings = { before: [line([[3, 3], [4, 4]], { heuristic: 0.5 })], nextBest: { heuristic: 0 } };
        expect(judgeTurn(played, readings)?.severity).toBe(`blunder`);
        expect(judgeTurn({ ...played, opening: true }, readings)).toBeNull();
        expect(judgeTurn({ ...played, turn: analysisTurnCap + 1 }, readings)).toBeNull();
        expect(judgeTurn(played, { before: [], nextBest: { heuristic: 0 } })).toBeNull();
        expect(judgeTurn(played, { ...readings, nextBest: null })).toBeNull();
        expect(judgeTurn(played, { ...readings, nextBest: {} })).toBeNull();
    });

    it('prints a glyph for every severity', () => {
        expect(judgmentGlyphs).toEqual({ inaccuracy: `?!`, mistake: `?`, blunder: `??` });
    });
});

describe('sideValue and forcedWinner', () => {
    it('clamps a heuristic to the -1 to 1 scale and pins a forced win to its end', () => {
        expect(sideValue({ heuristic: 1.7 }, `x`)).toBe(1);
        expect(sideValue({ heuristic: 1.7 }, `o`)).toBe(-1);
        expect(sideValue({ win_in: -3, heuristic: 0.9 }, `x`)).toBe(-1);
        expect(sideValue({}, `x`)).toBeNull();
    });

    it('names the side whose sign a nonzero win_in carries', () => {
        expect(forcedWinner({ win_in: 4 })).toBe(`x`);
        expect(forcedWinner({ win_in: -1 })).toBe(`o`);
        expect(forcedWinner({ win_in: 0, heuristic: 1 })).toBeNull();
    });
});

describe('valueWords', () => {
    const board = { kind: `board` } as const;

    it('reads a heuristic as the side it favors and its size in hundredths', () => {
        expect(valueWords({ heuristic: 0.52 }, board)).toBe(`x 0.52`);
        expect(valueWords({ heuristic: -0.12 }, board)).toBe(`o 0.12`);
        expect(valueWords({ heuristic: 2.5 }, board)).toBe(`x 2.50`);
    });

    it('reads a heuristic that rounds to zero as even', () => {
        expect(valueWords({ heuristic: 0.004 }, board)).toBe(`even`);
        expect(valueWords({ heuristic: -0.004 }, board)).toBe(`even`);
        expect(valueWords({ heuristic: 0.005 }, board)).toBe(`x 0.01`);
    });

    it('counts a forced win in the winner\'s own turns from the board shown', () => {
        expect(valueWords({ win_in: 1 }, board)).toBe(`x wins in 1`);
        expect(valueWords({ win_in: -2 }, board)).toBe(`o wins in 1`);
        expect(valueWords({ win_in: 3 }, board)).toBe(`x wins in 2`);
    });

    it('counts a line\'s own turn when its mover is the winner', () => {
        expect(valueWords({ win_in: -5 }, { kind: `line`, mover: `x`, completesSix: false })).toBe(`o wins in 3`);
        expect(valueWords({ win_in: 2 }, { kind: `line`, mover: `x`, completesSix: false })).toBe(`x wins in 2`);
    });

    it('reads a line that completes six as a win outright', () => {
        expect(valueWords({ win_in: 1 }, { kind: `line`, mover: `o`, completesSix: true })).toBe(`o wins`);
    });

    it('has no words for an evaluation without a value', () => {
        expect(valueWords({}, board)).toBeNull();
        expect(valueWords({ heuristic: Number.NaN }, board)).toBeNull();
    });
});
