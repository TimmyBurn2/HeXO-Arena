import { describe, expect, it } from 'vitest';
import { originSetup, type Setup } from '@hexo-arena/rules';
import { shownLines, xShare } from '../src/analysis/reading-view';
import type { Reading } from '../src/analysis/sources';

function reading(lines: Reading[`lines`]): Reading {
    return { by: { kind: `bot`, name: `kestrel`, version: `0.9`, ownerName: `tom` }, lines, seconds: 2, final: true, elapsedMs: 1800 };
}

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
        expect(shown.map((line) => [line.letter, line.value, line.cellsText])).toEqual([
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
        expect(line).toMatchObject({ completesSix: true, cells: [{ x: 5, y: 0 }], value: `x wins` });
        expect(line === undefined ? null : xShare(line, `x`)).toBe(1);
    });
});

describe('the eval bar', () => {
    it('splits at x\'s share of a heuristic held to -1 to 1, and fills for a forced winner', () => {
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
        expect([even, behind, past].map((line) => (line === undefined ? null : xShare(line, `o`)))).toEqual([0.5, 0.25, 1]);
        const [forced] = shownLines(reading([{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { win_in: -2, heuristic: 0.9 } }]), originSetup, `o`, 1);
        expect(forced === undefined ? null : xShare(forced, `o`)).toBe(0);
    });
});
