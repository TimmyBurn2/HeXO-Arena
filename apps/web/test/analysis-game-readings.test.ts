import { analysisTurnSchema, gameCellSchema, undeclaredValues, winChanceCuts } from '@hexo-arena/contract';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { communityReading, gameLineOf, moverOf, ownReading, setupBefore, turnCells } from '../src/analysis/game-readings';
import { graphX, graphY, holdColumn, runBracket, seriesOf, tracePoints, traceSegments, turnAt, washPoints, type GraphFrame } from '../src/analysis/graph';
import { rawBand } from '../src/analysis/reading-view';
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
        // x's turn 4 leaves o a six, which the board says is o's win in 1, whatever the reading's longer count.
        expect([1, 2, 3, 4, 5].map((turn) => reading.turns.get(turn)?.value?.shown)).toEqual([`x 59%`, `x 53%`, `x 73%`, `o wins in 1`, `o wins`]);
        expect(reading.turns.get(3)?.value?.spoken).toBe(`x's win chance 73 percent`);
    });

    it('word the values of an analyzer that declared them raw, or nothing, in hundredths', () => {
        const raw = communityReading(line, judgedTurns, true, undeclaredValues);
        expect([1, 2, 3, 4, 5].map((turn) => raw.turns.get(turn)?.value?.shown)).toEqual([`x 0.17`, `x 0.05`, `x 0.45`, `o wins in 1`, `o wins`]);
    });

    it('count a win the next mover\'s best line finds from the board after a turn, that line\'s own turn included, in the rows and the feed', () => {
        const next = communityReading(line, nextWinTurns, true, undeclaredValues);
        expect(next.turns.get(3)?.value?.shown).toBe(`x wins in 2`);
        expect(feedNotes(line, next, 6, `kestrel`)[3]?.value?.shown).toBe(`x wins in 2`);
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

    it('keep the forced wins around each turn, how far a value drop fell, and the turns that held a forced win for their mover', () => {
        expect(reading.turns.get(4)?.forced).toEqual({ before: null, after: { winner: `o`, turns: 1 } });
        // o's turn 3 takes its win chance from 46 to 27 percent, as shown, though its value fell 0.37.
        expect([2, 3].map((turn) => reading.turns.get(turn)?.drop)).toEqual([`6 points`, `19 points`]);
        expect(reading.turns.get(1)?.drop).toBe(null);
        const raw = communityReading(line, judgedTurns, true, { scale: 1, cuts: winChanceCuts, meaning: `raw` });
        expect([2, 3].map((turn) => raw.turns.get(turn)?.drop)).toEqual([`0.12`, `0.37`]);
        expect(reading.holds).toEqual([{ turn: 5, side: `o` }]);
        expect(reading.runs).toEqual([]);
        expect(reading.meaning).toBe(`expected`);
    });

    it('fold three or more consecutive forced marks into a run, every turn keeping its mark', () => {
        // A game between two dev bots read whole by an alpha-beta analyzer: from turn 5 each turn lets a win go or hands one over.
        const sample = z
            .object({ games: z.array(z.object({ id: z.string(), cells: z.array(gameCellSchema), openingPlies: z.number(), turns: z.array(analysisTurnSchema) })) })
            .parse(JSON.parse(readFileSync(new URL(`judged-readings.json`, import.meta.url), `utf8`)));
        const game = sample.games.find((each) => each.id === `analyzed-2`);
        if (game === undefined) throw new Error(`the sample holds the game`);
        const scramble = communityReading(gameLineOf(game.cells, game.openingPlies), game.turns, true, undeclaredValues);
        expect(scramble.runs).toEqual([{ from: 5, to: 20 }]);
        expect(scramble.marks.filter((mark) => mark.turn >= 5 && mark.turn <= 20)).toHaveLength(16);
        expect(scramble.holds.length).toBeGreaterThan(0);
        expect(scramble.meaning).toBe(`raw`);
    });
});

describe('the bots\' own views of a game', () => {
    const reading = ownReading(line, ownViews);

    it('plot each side as its own series from its own evaluation, and judge nothing', () => {
        const series = seriesOf(reading.points);
        // The views declare nothing, so their values are raw and draw within the inner band.
        expect(series.get(`x`)?.map((point) => [point.turn, point.value])).toEqual([
            [2, 0.3 * rawBand],
            [4, 0.1 * rawBand],
        ]);
        expect(series.get(`o`)?.map((point) => [point.turn, point.value])).toEqual([
            [1, -0.05 * rawBand],
            [3, -0.2 * rawBand],
            [5, -1],
        ]);
        expect(reading.meaning).toBe(`raw`);
        expect(reading.marks).toEqual([]);
        expect(reading.turns.get(5)?.value?.shown).toBe(`o wins`);
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

    it('break a trace around each forced win, which stands apart as a pin', () => {
        const at = (turn: number, forced: `x` | `o` | null) => ({ turn, value: forced === null ? 0.1 : forced === `x` ? 1 : -1, forced, series: null });
        expect(traceSegments([at(1, null), at(2, null), at(3, `o`), at(4, null), at(5, `x`), at(6, `o`)]).map((segment) => segment.map((point) => point.turn))).toEqual([[1, 2], [4]]);
    });

    it('shade a turn that held a forced win from the board before it to the board after it, on its holder\'s half', () => {
        expect(holdColumn(frame, 5, `x`)).toEqual({ x: 46, y: 0, width: 10, height: 26 });
        expect(holdColumn(frame, 5, `o`)).toEqual({ x: 46, y: 26, width: 10, height: 26 });
        expect(holdColumn(frame, 0, `o`).width).toBe(0);
    });

    it('bracket a run from its first turn to its last', () => {
        expect(runBracket(frame, 2, 5, 8)).toBe(`M26.0,2.0V6.0H56.0V2.0`);
    });
});
