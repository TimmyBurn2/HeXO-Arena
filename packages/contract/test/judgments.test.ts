import { describe, expect, it } from 'vitest';
import {
    analysisTurnCap,
    type AnalyzerValues,
    type BoardFacts,
    type EvaluatedLine,
    forcedWin,
    forcedWinner,
    forcedWinsAround,
    judgeTurn,
    judgmentGlyphs,
    judgmentRuns,
    type Judgment,
    type PlayedTurn,
    sideValue,
    type TurnReadings,
    undeclaredValues,
    valueWords,
    winChanceCuts,
} from '../src';

type Pair = readonly [readonly [number, number], readonly [number, number]];

function line([[ax, ay], [bx, by]]: Pair, evaluation: EvaluatedLine[`evaluation`]): EvaluatedLine {
    return { cells: [{ x: ax, y: ay }, { x: bx, y: by }], evaluation };
}

function turn(number: number, side: PlayedTurn[`side`], [[ax, ay], [bx, by]]: Pair): PlayedTurn {
    return { turn: number, side, cells: [{ x: ax, y: ay }, { x: bx, y: by }], opening: false, completesSix: false };
}

const quiet: BoardFacts = { sixOnBoard: false, sixLeft: false, sixesUnblockable: false };
const declared: AnalyzerValues = { scale: 1, cuts: winChanceCuts, meaning: `expected` };

function readings(before: readonly EvaluatedLine[], nextBest: TurnReadings[`nextBest`], board: Partial<BoardFacts> = {}, values = undeclaredValues): TurnReadings {
    return { before, nextBest, board: { ...quiet, ...board }, values };
}

const elsewhere: Pair = [
    [9, 9],
    [9, 10],
];
const best: Pair = [
    [1, 0],
    [3, 0],
];

describe('judgeTurn on a game where each side keeps a six it never takes', () => {
    it('leaves a swing of the analyzer\'s heuristic unmarked when it declared no cuts', () => {
        const turn3 = readings([line(best, { heuristic: 0.15 })], { heuristic: 0.75 });
        expect(judgeTurn(turn(3, `o`, elsewhere), turn3)).toBeNull();
        expect(judgeTurn(turn(3, `o`, elsewhere), { ...turn3, values: declared })).toEqual({ severity: `blunder`, reason: `value-drop`, turns: null });
    });

    it('marks leaving the opponent a six a blunder, whatever the heuristic before', () => {
        const left = { sixLeft: true };
        expect(judgeTurn(turn(5, `o`, elsewhere), readings([line(best, { heuristic: -0.8 })], { win_in: 1 }, left))).toEqual({ severity: `blunder`, reason: `allowed-win`, turns: 1 });
        expect(judgeTurn(turn(7, `o`, elsewhere), readings([line(best, { heuristic: 0.92 })], { win_in: 1 }, left))).toEqual({ severity: `blunder`, reason: `allowed-win`, turns: 1 });
    });

    it('marks missing a six a blunder, whatever the heuristic after', () => {
        const missed = readings([line(best, { win_in: 1 })], { heuristic: 0.92 }, { sixOnBoard: true });
        expect(judgeTurn(turn(6, `x`, elsewhere), missed)).toEqual({ severity: `blunder`, reason: `missed-win`, turns: 1 });
    });

    it('marks missing a six and leaving one a blunder that gave away the win', () => {
        const both = readings([line(best, { win_in: 1 })], { win_in: -1 }, { sixOnBoard: true, sixLeft: true });
        expect(judgeTurn(turn(8, `x`, elsewhere), both)).toEqual({ severity: `blunder`, reason: `gave-away-win`, turns: 1 });
    });

    it('takes a six on the board as a win in 1 for an analyzer that sent only heuristics', () => {
        const heuristicOnly = readings([line(best, { heuristic: 0.4 })], { heuristic: 0.3 }, { sixOnBoard: true, sixLeft: true });
        expect(judgeTurn(turn(8, `x`, elsewhere), heuristicOnly)).toEqual({ severity: `blunder`, reason: `gave-away-win`, turns: 1 });
    });
});

describe('judgeTurn grading a forced win by its length', () => {
    it('marks allowing a win in 2 a blunder and a longer one a mistake', () => {
        const allowed = (winIn: number) => judgeTurn(turn(9, `o`, elsewhere), readings([line(best, { heuristic: -0.37 })], { win_in: winIn }));
        expect(allowed(2)).toEqual({ severity: `blunder`, reason: `allowed-win`, turns: 2 });
        expect(allowed(4)).toEqual({ severity: `mistake`, reason: `allowed-win`, turns: 3 });
    });

    it('marks missing a win in 2 a mistake and a longer one an inaccuracy', () => {
        const missed = (winIn: number) => judgeTurn(turn(10, `x`, elsewhere), readings([line(best, { win_in: winIn })], { heuristic: 0.62 }));
        expect(missed(2)).toEqual({ severity: `mistake`, reason: `missed-win`, turns: 2 });
        expect(missed(4)).toEqual({ severity: `inaccuracy`, reason: `missed-win`, turns: 3 });
    });

    it('marks letting a win go and handing one over a blunder, however long either win', () => {
        const gave = judgeTurn(turn(12, `x`, elsewhere), readings([line(best, { win_in: 6 })], { win_in: -4 }));
        expect(gave).toEqual({ severity: `blunder`, reason: `gave-away-win`, turns: 3 });
    });

    it('gives no mark to a turn that keeps a forced win, however slow', () => {
        const kept = readings([line(best, { win_in: 1 })], { win_in: 5 }, { sixOnBoard: true });
        expect(judgeTurn(turn(16, `x`, elsewhere), kept)).toBeNull();
        expect(forcedWinsAround(turn(16, `x`, elsewhere), kept)).toEqual({ before: { winner: `x`, turns: 1 }, after: { winner: `x`, turns: 3 } });
    });

    it('never blames a side already lost by force, nor marks finding a win', () => {
        const lost = readings([line(best, { win_in: 5 })], { win_in: 1 }, { sixLeft: true });
        expect(judgeTurn(turn(17, `o`, elsewhere), lost)).toBeNull();
        expect(judgeTurn(turn(10, `x`, elsewhere), readings([line(best, { win_in: -3 })], { heuristic: -0.5 }))).toBeNull();
        expect(judgeTurn(turn(10, `x`, elsewhere), readings([line(best, { heuristic: 0.2 })], { win_in: 3 }))).toBeNull();
    });

    it('counts sixes no two stones block as the opponent\'s win before the turn, so the mover is already lost', () => {
        const unblockable = readings([line(best, { heuristic: 0.1 })], { win_in: -1 }, { sixesUnblockable: true, sixLeft: true });
        expect(judgeTurn(turn(20, `x`, elsewhere), unblockable)).toBeNull();
        expect(forcedWinsAround(turn(20, `x`, elsewhere), unblockable)?.before).toEqual({ winner: `o`, turns: 1 });
        const facing = readings([line(best, { heuristic: 0.1 })], { win_in: -1 }, { sixesUnblockable: true, sixOnBoard: true, sixLeft: true });
        expect(judgeTurn(turn(20, `x`, elsewhere), facing)?.reason).toBe(`gave-away-win`);
    });

    it('reads the played turn by its own line where the analyzer listed it, in either stone order, from the board after it', () => {
        const played = turn(21, `o`, [
            [4, 4],
            [3, 3],
        ]);
        const listed = readings([line(best, { heuristic: -0.2 }), line([[3, 3], [4, 4]], { win_in: 3 })], { heuristic: -0.9 });
        expect(judgeTurn(played, listed)).toEqual({ severity: `blunder`, reason: `allowed-win`, turns: 2 });
        const kept = readings([line(best, { win_in: -4 }), line([[3, 3], [4, 4]], { win_in: -2 })], null);
        expect(forcedWinsAround(played, kept)).toEqual({ before: { winner: `o`, turns: 3 }, after: { winner: `o`, turns: 1 } });
    });
});

describe('judgeTurn on value drops', () => {
    const played = turn(10, `x`, [
        [1, 1],
        [2, 2],
    ]);
    const judged = (bestValue: number, after: number, values: TurnReadings[`values`] = declared) =>
        judgeTurn(played, readings([line([[3, 3], [4, 4]], { heuristic: bestValue })], { heuristic: after }, {}, values));

    it('judges drops by lichess\'s cuts only when the analyzer declared them', () => {
        expect(judged(0.17, 0.05)?.severity).toBe(`inaccuracy`);
        expect(judged(0.33, 0.12)?.severity).toBe(`mistake`);
        expect(judged(0.08, -0.29)?.severity).toBe(`blunder`);
        expect(judged(0.08, -0.29, undeclaredValues)).toBeNull();
    });

    it('judges o from its own side', () => {
        const o = judgeTurn(turn(17, `o`, elsewhere), readings([line(best, { heuristic: 0.08 })], { heuristic: 0.45 }, {}, declared));
        expect(o).toEqual({ severity: `blunder`, reason: `value-drop`, turns: null });
    });

    it('divides by the declared scale and uses the declared cuts', () => {
        const scaled: AnalyzerValues = { scale: 1000, cuts: { inaccuracy: 0.3, mistake: 0.6, blunder: 0.9 }, meaning: `raw` };
        expect(judged(150, 750, scaled)).toBeNull();
        expect(judged(750, 150, scaled)?.severity).toBe(`mistake`);
        expect(judged(900, -100, scaled)?.severity).toBe(`blunder`);
    });

    it('compares values in the hundredths they are shown in, so a drop of exactly a cut earns it', () => {
        expect(judged(0.3, 0.2)?.severity).toBe(`inaccuracy`);
        expect(judged(0.7, 0.5)?.severity).toBe(`mistake`);
        expect(judged(0.304, 0.206)).toBeNull();
        expect(judged(3, 0.7)?.severity).toBe(`blunder`);
        expect(judged(3, 0.85)?.severity).toBe(`inaccuracy`);
    });
});

describe('judgeTurn on what it never judges', () => {
    it('never judges opening turns, the turn that completes six, turns past the cap, or turns missing a reading', () => {
        const played = turn(analysisTurnCap, `x`, [
            [1, 1],
            [2, 2],
        ]);
        const read = readings([line([[3, 3], [4, 4]], { heuristic: 0.5 })], { heuristic: 0 }, { sixOnBoard: true });
        expect(judgeTurn(played, read)?.reason).toBe(`missed-win`);
        expect(judgeTurn({ ...played, opening: true }, read)).toBeNull();
        expect(judgeTurn({ ...played, completesSix: true }, read)).toBeNull();
        expect(judgeTurn({ ...played, turn: analysisTurnCap + 1 }, read)).toBeNull();
        expect(judgeTurn(played, { ...read, before: [] })).toBeNull();
        expect(judgeTurn(played, { ...read, nextBest: null })).toBeNull();
        expect(forcedWinsAround(played, { ...read, nextBest: null })).toBeNull();
    });

    it('marks no value drop when either value is missing', () => {
        expect(judgeTurn(turn(10, `x`, elsewhere), readings([line(best, { heuristic: 0.5 })], {}, {}, declared))).toBeNull();
    });

    it('prints a glyph for every severity', () => {
        expect(judgmentGlyphs).toEqual({ inaccuracy: `?!`, mistake: `?`, blunder: `??` });
    });
});

describe('forcedWin', () => {
    it('counts a forced win in its winner\'s own turns from the board shown', () => {
        expect(forcedWin({ win_in: 1 }, { kind: `board` })).toEqual({ winner: `x`, turns: 1 });
        expect(forcedWin({ win_in: -2 }, { kind: `board` })).toEqual({ winner: `o`, turns: 1 });
        expect(forcedWin({ win_in: 5 }, { kind: `board` })).toEqual({ winner: `x`, turns: 3 });
    });

    it('adds a line\'s own turn when its mover wins, and makes a line that completes six a win in 1', () => {
        expect(forcedWin({ win_in: 2 }, { kind: `line`, mover: `x`, completesSix: false })).toEqual({ winner: `x`, turns: 2 });
        expect(forcedWin({ win_in: 1 }, { kind: `line`, mover: `x`, completesSix: false })).toEqual({ winner: `x`, turns: 1 });
        expect(forcedWin({ win_in: -5 }, { kind: `line`, mover: `x`, completesSix: false })).toEqual({ winner: `o`, turns: 3 });
        expect(forcedWin({ heuristic: 0.9 }, { kind: `line`, mover: `o`, completesSix: true })).toEqual({ winner: `o`, turns: 1 });
    });

    it('names none for a heuristic alone', () => {
        expect(forcedWin({ heuristic: 1 }, { kind: `board` })).toBeNull();
        expect(forcedWin({ win_in: 0 }, { kind: `board` })).toBeNull();
    });
});

describe('judgmentRuns', () => {
    const forced = (turnNumber: number): { turn: number; judgment: Judgment | null } => ({ turn: turnNumber, judgment: { severity: `blunder`, reason: `gave-away-win`, turns: 1 } });
    const none = (turnNumber: number) => ({ turn: turnNumber, judgment: null });

    it('finds three or more consecutive turns with a forced mark, both sides\'', () => {
        const turns = [none(4), ...Array.from({ length: 16 }, (_, index) => forced(5 + index)), none(21)];
        expect(judgmentRuns(turns)).toEqual([{ from: 5, to: 20 }]);
    });

    it('finds none in two marked turns, and breaks a run at an unmarked turn or a value drop', () => {
        const drop: { turn: number; judgment: Judgment } = { turn: 12, judgment: { severity: `blunder`, reason: `value-drop`, turns: null } };
        expect(judgmentRuns([forced(1), forced(2), none(3), forced(4), forced(5)])).toEqual([]);
        expect(judgmentRuns([forced(9), forced(10), forced(11), drop, forced(13), forced(14), forced(15), forced(16)])).toEqual([
            { from: 9, to: 11 },
            { from: 13, to: 16 },
        ]);
    });

    it('reads turns in any order', () => {
        expect(judgmentRuns([forced(8), forced(6), forced(7)])).toEqual([{ from: 6, to: 8 }]);
    });
});

describe('sideValue and forcedWinner', () => {
    it('divides by the scale, holds a heuristic to -1 to 1, and pins a forced win to its end', () => {
        expect(sideValue({ heuristic: 0.08 }, `o`)).toBe(-0.08);
        expect(sideValue({ heuristic: 1.7 }, `x`)).toBe(1);
        expect(sideValue({ heuristic: 1.7 }, `o`)).toBe(-1);
        expect(sideValue({ heuristic: 250 }, `x`, 1000)).toBe(0.25);
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
