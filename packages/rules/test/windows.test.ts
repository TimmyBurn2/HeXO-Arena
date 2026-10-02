import { describe, expect, it } from 'vitest';
import {
    type Coord,
    emptyPosition,
    hexDistance,
    isBalancedOpening,
    openingRegion,
    openWindows,
    place,
    type Player,
    setupProblem,
    sixesBlockable,
    type Stone,
    winner,
    winsThisTurn,
} from '../src';
import { createRng } from './helpers/prng';

function stones(player: Player, ...cells: readonly (readonly [number, number])[]): Stone[] {
    return cells.map(([x, y]) => ({ x, y, player }));
}

const four = stones(0, [0, 0], [1, 0], [2, 0], [3, 0]);

describe('openWindows', () => {
    it('finds every six-cell window that four stones and two empty cells make', () => {
        const starts = openWindows(four, 0).map((window) => window.cells[0]);
        expect(starts).toEqual(expect.arrayContaining([
            { x: -2, y: 0 },
            { x: -1, y: 0 },
            { x: 0, y: 0 },
        ]));
        expect(starts).toHaveLength(3);
        expect(openWindows(four, 0).find((window) => window.cells[0]?.x === -2)?.empty).toEqual([
            { x: -2, y: 0 },
            { x: -1, y: 0 },
        ]);
    });

    it('drops a window the other player has a stone in', () => {
        const blocked = [...four, ...stones(1, [5, 0])];
        expect(openWindows(blocked, 0).map((window) => window.cells[0]?.x)).toEqual(expect.arrayContaining([-2, -1]));
        expect(openWindows(blocked, 0)).toHaveLength(2);
        expect(openWindows([...blocked, ...stones(1, [-1, 0])], 0)).toEqual([]);
    });

    it('finds no window for three stones or for the other player', () => {
        expect(openWindows(four.slice(0, 3), 0)).toEqual([]);
        expect(openWindows(four, 1)).toEqual([]);
    });

    it('finds windows on all three axes, with gaps inside them', () => {
        const gapped = stones(1, [0, 0], [0, 1], [0, 3], [0, 5]);
        expect(openWindows(gapped, 1).map((window) => window.empty)).toEqual([[{ x: 0, y: 2 }, { x: 0, y: 4 }]]);
        const diagonal = stones(1, [0, 0], [1, -1], [2, -2], [3, -3], [4, -4]);
        expect(openWindows(diagonal, 1).every((window) => window.cells.every((cell) => cell.x + cell.y === 0))).toBe(true);
    });
});

describe('winsThisTurn', () => {
    it('holds exactly when two stones for the player complete six', () => {
        const rng = createRng(0xc0de);
        let wins = 0;
        for (let board = 0; board < 40; board += 1) {
            const sample = randomBoard(rng);
            if (setupProblem({ stones: sample, toMove: 0 }, sample.length) !== null) continue;
            for (const player of [0, 1] as const) {
                const expected = completesSixWithTwo(sample, player);
                expect(winsThisTurn(sample, player)).toBe(expected);
                if (expected) wins += 1;
            }
        }
        expect(wins).toBeGreaterThan(5);
    });

    it('agrees with the opening balance check, which refuses an open window for either player', () => {
        const rng = createRng(0x0b0e);
        let unbalanced = 0;
        for (let draw = 0; draw < 300; draw += 1) {
            let placed = place(emptyPosition, { x: 0, y: 0 });
            const plies = rng.pick([5, 7, 9]);
            const cells = [...openingRegion];
            while (placed.ok && placed.position.stones.length < plies) {
                const [cell] = cells.splice(rng.int(cells.length), 1);
                if (cell === undefined) break;
                placed = place(placed.position, cell);
            }
            if (!placed.ok) throw new Error(`an opening placement was refused`);
            const { stones: board } = placed.position;
            const open = winsThisTurn(board, 0) || winsThisTurn(board, 1);
            expect(isBalancedOpening(placed.position)).toBe(!open);
            if (open) unbalanced += 1;
        }
        expect(unbalanced).toBeGreaterThan(0);
    });
});

describe('sixesBlockable', () => {
    it('holds for no window, and for four in a row open at both ends, which two stones close', () => {
        expect(sixesBlockable([], 0)).toBe(true);
        expect(sixesBlockable(four, 1)).toBe(true);
        expect(sixesBlockable(four, 0)).toBe(true);
    });

    it('fails for two rows of four on different lines, each open at both ends', () => {
        const two = [...four, ...stones(0, [0, 3], [1, 3], [2, 3], [3, 3])];
        expect(sixesBlockable(two, 0)).toBe(false);
        expect(sixesBlockable([...two, ...stones(1, [-1, 3])], 0)).toBe(false);
        expect(sixesBlockable([...two, ...stones(1, [-1, 3], [4, 3])], 0)).toBe(true);
    });

    it('holds exactly when two stones of the other player leave no open window', () => {
        const rng = createRng(0xb10c);
        const seen = { blockable: 0, not: 0 };
        for (let board = 0; board < 40; board += 1) {
            const sample = randomBoard(rng);
            const expected = blockableByTwo(sample, 0);
            expect(sixesBlockable(sample, 0)).toBe(expected);
            if (expected) seen.blockable += 1;
            else seen.not += 1;
        }
        expect(seen.blockable).toBeGreaterThan(3);
        expect(seen.not).toBeGreaterThan(3);
    });
});

// Scans every six-cell line of the area for four or more of the player's stones and none of the other's,
// then tries every pair of the empty cells such lines hold, the only cells that block one.
function blockableByTwo(board: readonly Stone[], player: Player): boolean {
    const owners = new Map(board.map((stone) => [`${String(stone.x)},${String(stone.y)}`, stone.player]));
    const lines: string[][] = [];
    for (let x = -12; x <= 12; x += 1) {
        for (let y = -12; y <= 12; y += 1) {
            for (const [dx, dy] of [[1, 0], [0, 1], [1, -1]] as const) {
                const keys = [0, 1, 2, 3, 4, 5].map((step) => `${String(x + step * dx)},${String(y + step * dy)}`);
                const held = keys.map((key) => owners.get(key));
                if (held.some((owner) => owner !== undefined && owner !== player)) continue;
                if (held.filter((owner) => owner === player).length >= 4) lines.push(keys.filter((key) => !owners.has(key)));
            }
        }
    }
    const cells = [...new Set(lines.flat())];
    return lines.length === 0 || cells.some((first, index) => cells.slice(index).some((second) => lines.every((line) => line.includes(first) || line.includes(second))));
}

// A dense board in a small area, mostly of one player, so open windows are common for it and rare for the other.
function randomBoard(rng: ReturnType<typeof createRng>): Stone[] {
    const taken = new Map<string, Stone>();
    const count = 8 + rng.int(8);
    while (taken.size < count) {
        const stone: Stone = { x: rng.int(5) - 2, y: rng.int(5) - 2, player: rng.int(4) === 0 ? 1 : 0 };
        taken.set(`${String(stone.x)},${String(stone.y)}`, stone);
    }
    return [...taken.values()];
}

function completesSixWithTwo(board: readonly Stone[], player: Player): boolean {
    const near: Coord[] = [];
    for (let x = -7; x <= 7; x += 1) {
        for (let y = -7; y <= 7; y += 1) {
            const cell = { x, y };
            const empty = !board.some((stone) => stone.x === x && stone.y === y);
            if (empty && board.some((stone) => stone.player === player && hexDistance(stone, cell) < 6)) near.push(cell);
        }
    }
    // A six through the first stone alone is found before any second is tried,
    // so checking the line through the last stone of a pair misses nothing.
    for (const [index, first] of near.entries()) {
        const one = [...board, { ...first, player }];
        if (winner({ stones: one }) !== null) return true;
        for (const second of near.slice(index + 1)) {
            if (hexDistance(first, second) < 6 && winner({ stones: [...one, { ...second, player }] }) !== null) return true;
        }
    }
    return false;
}
