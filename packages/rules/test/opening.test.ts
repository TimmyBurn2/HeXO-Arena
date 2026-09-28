import { describe, expect, it } from 'vitest';
import {
    drawOpening,
    hexDistance,
    isBalancedOpening,
    lineAxes,
    openingRegion,
    type Coord,
    type Player,
    type Position,
    type Stone,
} from '../src';
import { createRng } from './helpers/prng';

const origin: Stone = { x: 0, y: 0, player: 0 };

// Turn 0 is ply 0; turn t >= 1 is plies 2t-1 and 2t; odd turns are player 1's.
function ownerOfPly(ply: number): Player {
    const turn = Math.ceil(ply / 2);
    return turn % 2 === 1 ? 1 : 0;
}

function key(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}

// An index source that places the given cells in order, resolving each to
// its index among the region cells still empty, then fails loudly if the
// draw asks for more.
function scripted(cells: readonly Coord[]): { index: (bound: number) => number; bounds: number[] } {
    const bounds: number[] = [];
    let taken = new Set<string>();
    let next = 0;
    return {
        bounds,
        index: (bound) => {
            // A bound of 18 means the draw restarted from ply 1.
            if (bound === openingRegion.length) taken = new Set<string>();
            bounds.push(bound);
            const cell = cells[next];
            if (cell === undefined) throw new Error(`the script ran out of cells`);
            next += 1;
            const empty = openingRegion.filter((candidate) => !taken.has(key(candidate)));
            const index = empty.findIndex((candidate) => key(candidate) === key(cell));
            if (index < 0) throw new Error(`scripted cell ${key(cell)} is not an empty region cell`);
            taken.add(key(cell));
            return index;
        },
    };
}

function line(start: Coord, axis: Coord, players: readonly (Player | null)[]): Stone[] {
    return players.flatMap((player, step) =>
        player === null ? [] : [{ x: start.x + step * axis.x, y: start.y + step * axis.y, player }],
    );
}

function board(stones: readonly Stone[]): Position {
    return { stones };
}

describe('opening region', () => {
    it('holds the 18 distinct cells at distance 1 or 2 of the origin', () => {
        expect(openingRegion).toHaveLength(18);
        expect(new Set(openingRegion.map(key)).size).toBe(18);
        for (const cell of openingRegion) {
            expect([1, 2]).toContain(hexDistance(cell, origin));
        }
    });
});

describe('opening balance', () => {
    it('rejects four of one player in six cells on every axis, for either player', () => {
        for (const axis of lineAxes) {
            for (const player of [0, 1] as const) {
                const four = line({ x: 10, y: 10 }, axis, [player, null, player, player, null, player]);
                expect(isBalancedOpening(board(four))).toBe(false);
            }
        }
    });

    it('rejects five of one player in six cells on every axis', () => {
        for (const axis of lineAxes) {
            expect(isBalancedOpening(board(line({ x: -3, y: 2 }, axis, [1, 1, 1, null, 1, 1])))).toBe(false);
        }
    });

    it('accepts four in six cells when the other player holds one of them', () => {
        for (const axis of lineAxes) {
            expect(isBalancedOpening(board(line({ x: 0, y: 0 }, axis, [1, 1, 0, 1, 1, null])))).toBe(true);
        }
    });

    it('accepts four of one player spread over seven cells', () => {
        for (const axis of lineAxes) {
            expect(isBalancedOpening(board(line({ x: 0, y: 0 }, axis, [1, 1, null, null, null, 1, 1])))).toBe(true);
        }
    });

    it('accepts three of one player in six cells', () => {
        for (const axis of lineAxes) {
            expect(isBalancedOpening(board(line({ x: 0, y: 0 }, axis, [0, 0, null, 0, null, null])))).toBe(true);
        }
    });

    it('accepts four in a row that bends across two axes', () => {
        const bent = [
            ...line({ x: 0, y: 0 }, { x: 1, y: 0 }, [1, 1]),
            ...line({ x: 1, y: 1 }, { x: 0, y: 1 }, [1, 1]),
        ];
        expect(isBalancedOpening(board(bent))).toBe(true);
    });

    it('accepts four of one player on parallel lines of the same axis', () => {
        const parallel = [
            ...line({ x: 0, y: 0 }, { x: 1, y: 0 }, [1, 1]),
            ...line({ x: 0, y: 1 }, { x: 1, y: 0 }, [1, 1]),
        ];
        expect(isBalancedOpening(board(parallel))).toBe(true);
    });

    it('accepts the empty board and the origin alone', () => {
        expect(isBalancedOpening(board([]))).toBe(true);
        expect(isBalancedOpening(board([origin]))).toBe(true);
    });
});

// The first property a drawn opening breaks, or null.
// Checked in plain code, since an expect per stone costs four times the
// draw itself and ten thousand draws must fit the default test budget.
function drawFault(opening: Position, plies: number): string | null {
    if (opening.stones.length !== plies) return `${String(opening.stones.length)} stones`;
    const [first] = opening.stones;
    if (first?.x !== origin.x || first.y !== origin.y || first.player !== origin.player) return `no origin first`;
    for (const [ply, stone] of opening.stones.entries()) {
        if (stone.player !== ownerOfPly(ply)) return `ply ${String(ply)} owned by player ${String(stone.player)}`;
        if (hexDistance(stone, origin) > 2) return `ply ${String(ply)} past distance 2`;
    }
    if (new Set(opening.stones.map(key)).size !== plies) return `a cell taken twice`;
    if (!isBalancedOpening(opening)) return `unbalanced`;
    return null;
}

describe('opening draw', () => {
    it('draws every length as that many stones in ply order, owned by ply, within distance 2, and balanced', () => {
        const rng = createRng(0x0bee);
        const faults: string[] = [];
        for (const plies of [1, 3, 5, 7, 9]) {
            for (let draw = 0; draw < 2000; draw += 1) {
                const fault = drawFault(drawOpening(plies, (bound) => rng.int(bound)), plies);
                if (fault !== null) faults.push(`${String(plies)} plies, draw ${String(draw)}: ${fault}`);
            }
        }
        expect(faults).toEqual([]);
    });

    it('draws the origin alone at one ply without consulting the source', () => {
        const opening = drawOpening(1, () => {
            throw new Error(`consulted`);
        });
        expect(opening.stones).toEqual([origin]);
    });

    it('asks the source once per ply after the origin, over the cells still empty', () => {
        const source = scripted(openingRegion.slice(0, 4));
        drawOpening(5, source.index);
        expect(source.bounds).toEqual([18, 17, 16, 15]);
    });

    it('discards a rejected draw whole and redraws from ply 1', () => {
        // Plies 1, 2, 5, 6 are player 1's; four of them on the row y = 1
        // leave a six-cell window player 0 never touches.
        const threat = [
            { x: -2, y: 1 },
            { x: -1, y: 1 },
            { x: 1, y: -1 },
            { x: 2, y: -1 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
        ];
        const clean = [
            { x: -2, y: 1 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
            { x: 2, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
        ];
        const source = scripted([...threat, ...clean]);
        const opening = drawOpening(7, source.index);
        expect(source.bounds).toEqual([18, 17, 16, 15, 14, 13, 18, 17, 16, 15, 14, 13]);
        expect(opening.stones.slice(1).map(key)).toEqual(clean.map(key));
        expect(isBalancedOpening(opening)).toBe(true);
    });

    it('refuses even lengths, zero, and lengths past nine', () => {
        const rng = createRng(1);
        for (const plies of [0, 2, 4, 6, 8, 10, 11, -1, 2.5]) {
            expect(() => drawOpening(plies, (bound) => rng.int(bound))).toThrow(RangeError);
        }
    });
});

// Every opening of a length as a position: player 1's and player 0's
// random stones are two disjoint subsets of the region; draw order does not
// change the position, so each subset pair is one position.
function countRejected(plies: number): { positions: number; rejected: number } {
    const randomStones = plies - 1;
    const turnsAfterOrigin = randomStones / 2;
    const oneCount = Math.ceil(turnsAfterOrigin / 2) * 2;
    const zeroCount = randomStones - oneCount;
    let positions = 0;
    let rejected = 0;
    const cells = openingRegion;
    for (const ones of subsets(cells.length, oneCount, 0)) {
        const rest = [...cells.keys()].filter((index) => !ones.includes(index));
        for (const zeroPicks of subsets(rest.length, zeroCount, 0)) {
            const stones: Stone[] = [origin];
            for (const index of ones) stones.push({ ...at(cells, index), player: 1 });
            for (const pick of zeroPicks) stones.push({ ...at(cells, at(rest, pick)), player: 0 });
            positions += 1;
            if (!isBalancedOpening({ stones })) rejected += 1;
        }
    }
    return { positions, rejected };
}

function* subsets(size: number, count: number, from: number): Generator<number[]> {
    if (count === 0) {
        yield [];
        return;
    }
    for (let first = from; first <= size - count; first += 1) {
        for (const rest of subsets(size, count - 1, first + 1)) yield [first, ...rest];
    }
}

function at<T>(items: readonly T[], index: number): T {
    const item = items[index];
    if (item === undefined) throw new Error(`index ${String(index)} out of range`);
    return item;
}

describe('opening space', () => {
    it('rejects no opening of five plies or fewer', () => {
        expect(countRejected(3)).toEqual({ positions: 153, rejected: 0 });
        expect(countRejected(5)).toEqual({ positions: 18_360, rejected: 0 });
    });

    // Half a second on an idle machine; the budget leaves a loaded one
    // twenty times that, since the count is the whole space.
    it('rejects 546 of the 278,460 openings of seven plies', () => {
        expect(countRejected(7)).toEqual({ positions: 278_460, rejected: 546 });
    }, 10_000);

    // About ten seconds; set OPENING_NINE_PLY=1 to run it.
    it.skipIf(process.env[`OPENING_NINE_PLY`] === undefined)(
        'rejects 158,907 of the 3,063,060 openings of nine plies',
        () => {
            expect(countRejected(9)).toEqual({ positions: 3_063_060, rejected: 158_907 });
        },
        120_000,
    );
});
