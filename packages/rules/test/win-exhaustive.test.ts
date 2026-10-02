import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Coord, Player, Stone } from '../src';
import { winner } from '../src';

type CellState = -1 | 0 | 1;

const lineLength = 9;

// One nine-cell line per axis: enough to force every window clamp the
// six-of-six selection can hit, small enough to enumerate exhaustively.
const strips: readonly { readonly axis: Coord; readonly cells: readonly Coord[] }[] = [
    { axis: { x: 1, y: 0 }, cells: line(1, 0) },
    { axis: { x: 0, y: 1 }, cells: line(0, 1) },
    { axis: { x: 1, y: -1 }, cells: line(1, -1) },
];

function line(dx: number, dy: number): Coord[] {
    // 0 - i keeps the origin at positive zero; i * -1 would yield -0.
    return Array.from({ length: lineLength }, (_, i) => ({
        x: dx === 0 ? 0 : dx < 0 ? 0 - i : i,
        y: dy === 0 ? 0 : dy < 0 ? 0 - i : i,
    }));
}

function decodeColoring(index: number): CellState[] {
    const states: CellState[] = [];
    let rest = index;
    for (let i = 0; i < lineLength; i += 1) {
        states.push(digitState(rest % 3));
        rest = Math.floor(rest / 3);
    }
    return states;
}

const cellStates = [-1, 0, 1] as const;

function digitState(digit: number): CellState {
    const state = cellStates[digit];
    if (state === undefined) {
        throw new Error(`digit out of range`);
    }
    return state;
}

// The independent oracle-blind check: scan the strip linearly for the run
// through the chosen cell, then window it with array slicing.
function expectedWinner(
    cells: readonly Coord[],
    states: readonly CellState[],
    lastIdx: number,
): { player: Player; cells: Coord[] } | null {
    const player = states[lastIdx];
    if (player === undefined) {
        throw new Error(`last cell missing`);
    }
    if (player === -1) {
        throw new Error(`last cell must be occupied`);
    }
    let start = lastIdx;
    while (start > 0 && states[start - 1] === player) {
        start -= 1;
    }
    let end = lastIdx;
    while (end < lineLength - 1 && states[end + 1] === player) {
        end += 1;
    }
    const runLength = end - start + 1;
    if (runLength < 6) {
        return null;
    }
    const pivot = lastIdx - start;
    let windowStart = pivot - 2;
    if (windowStart < 0) {
        windowStart = 0;
    }
    if (windowStart > runLength - 6) {
        windowStart = runLength - 6;
    }
    const window: Coord[] = [];
    for (let i = 0; i < 6; i += 1) {
        const cell = cells[start + windowStart + i];
        if (cell === undefined) {
            throw new Error(`window left the run`);
        }
        window.push(cell);
    }
    return { player, cells: window };
}

describe('win detection, exhaustive per axis', () => {
    for (const { axis, cells } of strips) {
        const label = `${String(axis.x)},${String(axis.y)}`;
        it(`matches a linear scan on every coloring of the ${label} axis`, () => {
            const total = 3 ** lineLength;
            for (let index = 0; index < total; index += 1) {
                const states = decodeColoring(index);
                const stonesByIndex: (Stone | undefined)[] = states.map(
                    (state, i) => {
                        const cell = cells[i];
                        if (state === -1 || cell === undefined) {
                            return undefined;
                        }
                        return { x: cell.x, y: cell.y, player: state };
                    },
                );
                for (let lastIdx = 0; lastIdx < lineLength; lastIdx += 1) {
                    const last = stonesByIndex[lastIdx];
                    if (last === undefined) {
                        continue;
                    }
                    const others: Stone[] = [];
                    for (let i = 0; i < lineLength; i += 1) {
                        const stone = stonesByIndex[i];
                        if (stone !== undefined && i !== lastIdx) {
                            others.push(stone);
                        }
                    }
                    const got = winner({ stones: [...others, last] });
                    const expected = expectedWinner(cells, states, lastIdx);
                    // An expect costs four times the engine call over some
                    // 100,000 cases, so it runs only where the plain
                    // comparison disagrees, and then fails with its diff.
                    if (!isDeepStrictEqual(got, expected)) expect(got).toEqual(expected);
                }
            }
        });
    }
});

describe('win detection, exhaustive small board', () => {
    it('never reports a winner inside the radius-1 ball', () => {
        const ball: Coord[] = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: -1 },
            { x: 1, y: -1 },
            { x: -1, y: 1 },
        ];
        const total = 3 ** ball.length;
        for (let index = 0; index < total; index += 1) {
            const stones: Stone[] = [];
            let rest = index;
            for (const cell of ball) {
                const state = digitState(rest % 3);
                rest = Math.floor(rest / 3);
                if (state !== -1) {
                    stones.push({ x: cell.x, y: cell.y, player: state });
                }
            }
            for (let lastIdx = 0; lastIdx < stones.length; lastIdx += 1) {
                const last = stones[lastIdx];
                if (last === undefined) {
                    continue;
                }
                const others = stones.filter((_, i) => i !== lastIdx);
                expect(winner({ stones: [...others, last] })).toBeNull();
            }
        }
    });
});
