import { describe, expect, it } from 'vitest';
import { undeclaredValues, type AnalyzerValues } from '@hexo-arena/contract';
import { originSetup, type Setup } from '@hexo-arena/rules';
import { afterWords, drawnValue, rawBand, shownLines, xShare } from '../src/analysis/reading-view';
import type { Reading } from '../src/analysis/sources';

function reading(lines: Reading[`lines`], values: AnalyzerValues = undeclaredValues): Reading {
    return { by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` }, values, lines, seconds: 2, final: true, elapsedMs: 1800 };
}

// An analyzer whose heuristic, divided by 100, is its estimate of x's expected result.
const expectedHundreds: AnalyzerValues = { scale: 100, cuts: null, meaning: `expected` };

// x has five in a row from the origin, o two stones elsewhere: x to move can complete six.
const fiveInARow: Setup = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 0, y: 3, player: 1 },
        { x: 1, y: 3, player: 1 },
        { x: 1, y: 0, player: 0 },
        { x: 2, y: 0, player: 0 },
        { x: -2, y: 3, player: 1 },
        { x: -1, y: 3, player: 1 },
        { x: 3, y: 0, player: 0 },
        { x: 4, y: 0, player: 0 },
    ],
    toMove: 0,
};

describe('the lines a reading shows', () => {
    it('letter the lines best first, word each value for the side to move, and write the cells as HTTTX', () => {
        const shown = shownLines(
            reading([
                { cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -0.12 } },
                { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], evaluation: { heuristic: 0.004 } },
                { cells: [{ x: 2, y: -1 }, { x: 0, y: 1 }], evaluation: { win_in: -3 } },
            ]),
            originSetup,
            `o`,
            3,
        );
        expect(shown.map((line) => [line.letter, line.value.shown, line.cellsText])).toEqual([
            [`A`, `o 0.12`, `[0,1] [-1,1]`],
            [`B`, `even`, `[1,0] [0,-1]`],
            [`C`, `o wins in 3`, `[1,1] [1,-1]`],
        ]);
    });

    it('show no more lines than the settings ask for', () => {
        const lines = [{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -0.1 } }, { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], evaluation: { heuristic: -0.2 } }] as const;
        expect(shownLines(reading(lines), originSetup, `o`, 1)).toHaveLength(1);
    });

    it('play only the first cell of a line whose first stone completes six, which wins', () => {
        const [line] = shownLines(reading([{ cells: [{ x: 5, y: 0 }, { x: 6, y: 0 }], evaluation: { win_in: 1 } }]), fiveInARow, `x`, 3);
        expect(line).toMatchObject({ completesSix: true, cells: [{ x: 5, y: 0 }], value: { shown: `x wins`, spoken: `x wins` } });
        expect(line === undefined ? null : xShare(line)).toBe(1);
    });
});

// x has four in a row from the origin: x to move completes six only with both stones.
const fourInARow: Setup = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 0, y: 3, player: 1 },
        { x: 1, y: 3, player: 1 },
        { x: 1, y: 0, player: 0 },
        { x: 2, y: 0, player: 0 },
        { x: -2, y: 3, player: 1 },
        { x: -1, y: 3, player: 1 },
        { x: 3, y: 0, player: 0 },
    ],
    toMove: 0,
};

describe('a forced win in words', () => {
    it('call a line whose two stones complete six a win, as one whose first stone does', () => {
        const [line] = shownLines(reading([{ cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }], evaluation: { win_in: 1 } }]), fourInARow, `x`, 1);
        expect(line).toMatchObject({ completesSix: true, cells: [{ x: 4, y: 0 }, { x: 5, y: 0 }], value: { shown: `x wins` } });
        expect(line === undefined ? null : xShare(line)).toBe(1);
    });

    it('read a line\'s win in 1 for its own mover as a win this turn, not the next', () => {
        const [line] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { win_in: -1 } }]), originSetup, `o`, 1);
        expect(line?.value.shown).toBe(`o wins in 1`);
        const [slower] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { win_in: -2 } }]), originSetup, `o`, 1);
        expect(slower?.value.shown).toBe(`o wins in 2`);
    });

    it('read the mover\'s forced win as a win in 1 where it holds a six, as the board facts do, however long a line that leaves the six claims', () => {
        const [slow, quiet, six] = shownLines(
            reading([
                { cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }], evaluation: { win_in: 4 } },
                { cells: [{ x: 0, y: -1 }, { x: 1, y: -1 }], evaluation: { heuristic: 0.4 } },
                { cells: [{ x: 5, y: 0 }, { x: 6, y: 0 }], evaluation: { win_in: 3 } },
            ]),
            fiveInARow,
            `x`,
            3,
        );
        expect(slow).toMatchObject({ completesSix: false, value: { shown: `x wins in 1`, spoken: `x wins in 1` } });
        expect(slow === undefined ? null : xShare(slow)).toBe(1);
        // A heuristic claims no forced win, and the six itself still reads as the win it is.
        expect(quiet?.value.shown).toBe(`x 0.40`);
        expect(six?.value.shown).toBe(`x wins`);
        // Without a six on the board the same line keeps the length it claims.
        const [elsewhere] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { win_in: -4 } }]), originSetup, `o`, 1);
        expect(elsewhere?.value.shown).toBe(`o wins in 3`);
    });

    it('count the winner\'s own turns from the board after a turn, whichever line the value comes from', () => {
        // The played turn's own line describes the board after it, the next mover to move.
        expect(afterWords({ kind: `played`, evaluation: { win_in: 2 } }, undeclaredValues)?.shown).toBe(`x wins in 1`);
        expect(afterWords({ kind: `played`, evaluation: { win_in: -3 } }, undeclaredValues)?.shown).toBe(`o wins in 2`);
        // The next mover's best line describes the board a turn later, so its own win counts that turn.
        expect(afterWords({ kind: `next`, evaluation: { win_in: 2 }, mover: `x` }, undeclaredValues)?.shown).toBe(`x wins in 2`);
        expect(afterWords({ kind: `next`, evaluation: { win_in: 4 }, mover: `x` }, undeclaredValues)?.shown).toBe(`x wins in 3`);
        expect(afterWords({ kind: `next`, evaluation: { win_in: 1 }, mover: `x` }, undeclaredValues)?.shown).toBe(`x wins in 1`);
        expect(afterWords({ kind: `next`, evaluation: { win_in: 3 }, mover: `o` }, undeclaredValues)?.shown).toBe(`x wins in 2`);
        expect(afterWords({ kind: `next`, evaluation: { heuristic: -0.3 }, mover: `x` }, undeclaredValues)?.shown).toBe(`o 0.30`);
    });
});

describe('values on the scale their analyzer declared', () => {
    const scaled = (values: AnalyzerValues) =>
        shownLines(
            reading(
                [
                    { cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -24 } },
                    { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], evaluation: { heuristic: 250 } },
                ],
                values,
            ),
            originSetup,
            `o`,
            2,
        ).map((line) => line.value);

    it('word an expected heuristic, divided by the scale and held to -1 to 1, as the leading side\'s win chance, spoken in full', () => {
        expect(scaled(expectedHundreds)).toEqual([
            { shown: `o 62%`, spoken: `o's win chance 62 percent` },
            { shown: `x 99%`, spoken: `x's win chance 99 percent` },
        ]);
        expect(afterWords({ kind: `played`, evaluation: { heuristic: 36 } }, expectedHundreds)?.shown).toBe(`x 68%`);
        expect(afterWords({ kind: `next`, evaluation: { heuristic: 0.4 }, mover: `o` }, expectedHundreds)).toEqual({ shown: `even`, spoken: `even` });
    });

    it('word a raw heuristic on the same scale in hundredths, spoken as shown', () => {
        expect(scaled({ scale: 100, cuts: null, meaning: `raw` })).toEqual([
            { shown: `o 0.24`, spoken: `o 0.24` },
            { shown: `x 1.00`, spoken: `x 1.00` },
        ]);
    });

    it('draw an expected value as the win chance it is, a raw one within the inner band, and a forced win on its edge', () => {
        expect(drawnValue({ heuristic: 50 }, expectedHundreds)).toBe(0.5);
        expect(drawnValue({ heuristic: 0.5 }, undeclaredValues)).toBe(0.5 * rawBand);
        expect(drawnValue({ heuristic: 3 }, undeclaredValues)).toBe(rawBand);
        expect(drawnValue({ win_in: -4, heuristic: 0.9 }, undeclaredValues)).toBe(-1);
        expect(drawnValue({ win_in: 2 }, expectedHundreds)).toBe(1);
    });
});

describe('the eval bar', () => {
    it('splits where the graph draws the value, and only a forced win or a six fills it', () => {
        const [even, behind, past] = shownLines(
            reading([
                { cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: 0 } },
                { cells: [{ x: 1, y: 0 }, { x: -1, y: 1 }], evaluation: { heuristic: -0.5 } },
                { cells: [{ x: 2, y: -1 }, { x: 0, y: 1 }], evaluation: { heuristic: 3 } },
            ]),
            originSetup,
            `o`,
            3,
        );
        expect([even, behind, past].map((line) => (line === undefined ? null : xShare(line)))).toEqual([0.5, (1 - 0.5 * rawBand) / 2, (1 + rawBand) / 2]);
        const [forced] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { win_in: -2, heuristic: 0.9 } }]), originSetup, `o`, 1);
        expect(forced === undefined ? null : xShare(forced)).toBe(0);
        const [expected] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic: -50 } }], expectedHundreds), originSetup, `o`, 1);
        expect(expected === undefined ? null : xShare(expected)).toBe(0.25);
    });
});
