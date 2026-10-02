import { undeclaredValues, winChanceCuts } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { communityReading, gameLineOf, moverOf, ownReading, plotValue, setupBefore, turnCells } from '../src/analysis/game-readings';
import { graphX, graphY, seriesOf, tracePoints, turnAt, washPoints, type GraphFrame } from '../src/analysis/graph';
import { feedNotes } from '../src/game/drawer-reading';
import { judgedCells, judgedTurns, nextWinTurns, ownViews } from './judged-game';

const line = gameLineOf(judgedCells, 1);

describe('a finished game as its readings lay against it', () => {
    it('start after the opening, end on the last turn, and know a six ended it', () => {
        expect(line).toMatchObject({ firstTurn: 1, lastTurn: 5, sixAtEnd: true });
        expect(gameLineOf(judgedCells.slice(0, 9), 1)).toMatchObject({ lastTurn: 4, sixAtEnd: false });
        expect(gameLineOf(judgedCells.slice(0, 5), 5)).toMatchObject({ firstTurn: 3, lastTurn: 2 });
    });

    it('give o the odd turns, each turn its stones, and the position it was played from', () => {
        expect([1, 2, 3].map(moverOf)).toEqual([`o`, `x`, `o`]);
        expect(turnCells(line, 4)).toEqual([
            { x: 3, y: -1 },
            { x: 4, y: -1 },
        ]);
        expect(setupBefore(line, 2)).toEqual({
            stones: [
                { x: 0, y: 0, player: 0 },
                { x: 0, y: 1, player: 1 },
                { x: 1, y: 1, player: 1 },
            ],
            toMove: 0,
        });
    });
});

describe('a community reading of a whole game', () => {
    const reading = communityReading(line, judgedTurns, true, { scale: 1, cuts: winChanceCuts, meaning: `expected` });

    it('value each turn by its own line where the reading lists it, else by the best line after it, and a six as its winner', () => {
        expect([1, 2, 3, 4, 5].map((turn) => reading.turns.get(turn)?.value)).toEqual([`x 0.17`, `x 0.05`, `x 0.45`, `o wins in 2`, `o wins`]);
    });

    it('count a win the next mover\'s best line finds from the board after a turn, that line\'s own turn included, in the rows and the feed', () => {
        const next = communityReading(line, nextWinTurns, true, undeclaredValues);
        expect(next.turns.get(3)?.value).toBe(`x wins in 2`);
        expect(feedNotes(line, next, 6, `kestrel`)[3]?.value).toBe(`x wins in 2`);
    });

    it('judge each turn by the board, its forced wins, and its analyzer\'s declared cuts, never the six, and count the marks per side', () => {
        expect([1, 2, 3, 4, 5].map((turn) => reading.turns.get(turn)?.judgment ?? null)).toEqual([
            null,
            { severity: `inaccuracy`, reason: `value-drop`, turns: null },
            { severity: `blunder`, reason: `value-drop`, turns: null },
            { severity: `blunder`, reason: `allowed-win`, turns: 1 },
            null,
        ]);
        expect(reading.counts).toEqual({ x: { inaccuracy: 1, mistake: 0, blunder: 1 }, o: { inaccuracy: 0, mistake: 0, blunder: 1 } });
    });

    it('judge no value drop for an analyzer that declared no cuts, and still the six x left o', () => {
        const forcedOnly = communityReading(line, judgedTurns, true, undeclaredValues);
        expect([1, 2, 3, 4, 5].map((turn) => forcedOnly.turns.get(turn)?.judgment ?? null)).toEqual([null, null, null, { severity: `blunder`, reason: `allowed-win`, turns: 1 }, null]);
    });

    it('plot the board after the opening first, then each turn, forced wins pinned to the winner\'s edge', () => {
        expect(reading.points).toEqual([
            { turn: 0, value: 0.12, forced: null, series: null },
            { turn: 1, value: 0.17, forced: null, series: null },
            { turn: 2, value: 0.05, forced: null, series: null },
            { turn: 3, value: 0.45, forced: null, series: null },
            { turn: 4, value: -1, forced: `o`, series: null },
            { turn: 5, value: -1, forced: `o`, series: null },
        ]);
    });

    it('mark each judged turn on the trace at its value after', () => {
        expect(reading.marks).toEqual([
            { turn: 2, severity: `inaccuracy`, value: 0.05 },
            { turn: 3, severity: `blunder`, value: 0.45 },
            { turn: 4, severity: `blunder`, value: -1 },
        ]);
    });

    it('while under way, fill only the turns read so far and judge none', () => {
        const partial = communityReading(line, judgedTurns.slice(0, 3), false, undeclaredValues);
        expect(partial.points.map((point) => point.turn)).toEqual([0, 1, 2]);
        expect(partial.turns.get(3)?.value).toBe(null);
        expect(partial.turns.get(5)?.value).toBe(null);
        expect(partial.marks).toEqual([]);
        expect([...partial.turns.values()].every((read) => read.judgment === null)).toBe(true);
    });

    it('hold a heuristic past the scale to its edge and a forced win to its winner\'s', () => {
        expect(plotValue({ heuristic: 3.2 })).toBe(1);
        expect(plotValue({ heuristic: -0.4 })).toBe(-0.4);
        expect(plotValue({ win_in: 4 })).toBe(1);
        expect(plotValue({ win_in: -1, heuristic: 0.9 })).toBe(-1);
    });
});

describe('the bots\' own views of a game', () => {
    const reading = ownReading(line, ownViews);

    it('plot each side as its own series from its own evaluation, and judge nothing', () => {
        const series = seriesOf(reading.points);
        expect(series.get(`x`)?.map((point) => [point.turn, point.value])).toEqual([
            [2, 0.3],
            [4, 0.1],
        ]);
        expect(series.get(`o`)?.map((point) => [point.turn, point.value])).toEqual([
            [1, -0.05],
            [3, -0.2],
            [5, -1],
        ]);
        expect(reading.marks).toEqual([]);
        expect(reading.turns.get(5)?.value).toBe(`o wins`);
        expect(reading.turns.get(2)?.options).toHaveLength(2);
    });

    it('leave out a turn a view claims for the other side', () => {
        const wrong = ownReading(line, ownViews.filter((view) => view.side === `x`).map((view) => ({ ...view, side: `o` as const })));
        expect(wrong.points).toEqual([]);
    });
});

describe('the graph\'s geometry', () => {
    const frame: GraphFrame = { width: 112, height: 52, first: 0, last: 10 };

    it('spread the turns across the width and the values up it, x at the top, inside an inset', () => {
        expect([0, 5, 10].map((turn) => graphX(frame, turn))).toEqual([6, 56, 106]);
        expect([1, 0, -1, 2].map((value) => graphY(frame, value))).toEqual([6, 26, 46, 6]);
        expect(graphX({ ...frame, last: 0 }, 0)).toBe(56);
    });

    it('find the turn under a point, held to the span', () => {
        expect([56, 0, 500, 31].map((x) => turnAt(frame, x))).toEqual([5, 0, 10, 3]);
    });

    it('close the wash on the middle line at both ends of the trace', () => {
        const points = [
            { turn: 0, value: 0.5, forced: null, series: null },
            { turn: 10, value: -0.5, forced: null, series: null },
        ];
        expect(tracePoints(frame, points)).toBe(`6.0,16.0 106.0,36.0`);
        expect(washPoints(frame, points)).toBe(`6.0,26.0 6.0,16.0 106.0,36.0 106.0,26.0`);
        expect(washPoints(frame, [])).toBe(``);
    });
});
