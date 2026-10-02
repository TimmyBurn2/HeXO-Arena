import { describe, expect, it } from 'vitest';
import {
    canonicalKey,
    containmentProbe,
    containmentTarget,
    containsPosition,
    originSetup,
    otherPlayer,
    playTurn,
    targetContains,
    type Setup,
    type Stone,
} from '../src';
import { createRng, type Rng } from './helpers/prng';

// Maps written in cube coordinates, independently of the module's own:
// a sixth of a turn is (x, y, z) -> (-y, -z, -x) with z = -x - y,
// and the mirror fixes the x axis.
type StoneMap = (stone: Stone) => Stone;
const rotate: StoneMap = ({ x, y, player }) => ({ x: -y, y: x + y, player });
const mirror: StoneMap = ({ x, y, player }) => ({ x: x + y, y: -y, player });
const swap: StoneMap = (stone) => ({ ...stone, player: otherPlayer(stone.player) });
const shift = (dx: number, dy: number): StoneMap => (stone) => ({ ...stone, x: stone.x + dx, y: stone.y + dy });

function randomMap(rng: Rng): { readonly map: StoneMap; readonly swaps: boolean } {
    const steps: StoneMap[] = [];
    for (let turn = rng.int(6); turn > 0; turn -= 1) steps.push(rotate);
    if (rng.int(2) === 1) steps.push(mirror);
    const swaps = rng.int(2) === 1;
    if (swaps) steps.push(swap);
    steps.push(shift(rng.int(41) - 20, rng.int(41) - 20));
    return { map: (stone) => steps.reduce((acc, step) => step(acc), stone), swaps };
}

function randomGame(rng: Rng, turns: number): Setup {
    let setup = originSetup;
    for (let turn = 0; turn < turns; turn += 1) {
        const near = (): { x: number; y: number } => {
            const anchor = rng.pick(setup.stones);
            return { x: anchor.x + rng.int(9) - 4, y: anchor.y + rng.int(9) - 4 };
        };
        const result = playTurn(setup, [near(), near()]);
        if (result.ok && result.win === null) setup = result.setup;
    }
    return setup;
}

function stones(player: 0 | 1, ...cells: readonly (readonly [number, number])[]): Stone[] {
    return cells.map(([x, y]) => ({ x, y, player }));
}

describe('canonicalKey', () => {
    it('names a position and every turned, mirrored, swapped, or shifted image of it alike', () => {
        const rng = createRng(0x5a5a);
        for (let sample = 0; sample < 60; sample += 1) {
            const setup = randomGame(rng, 1 + rng.int(12));
            const { map, swaps } = randomMap(rng);
            const image: Setup = { stones: setup.stones.map(map), toMove: swaps ? otherPlayer(setup.toMove) : setup.toMove };
            expect(canonicalKey(image)).toBe(canonicalKey(setup));
        }
    });

    it('tells apart shapes that no map relates', () => {
        const adjacent: Setup = { stones: stones(0, [0, 0], [1, 0]), toMove: 1 };
        const apart: Setup = { stones: stones(0, [0, 0], [2, 0]), toMove: 1 };
        const bent: Setup = { stones: stones(0, [0, 0], [1, 0], [1, 1]), toMove: 1 };
        const straight: Setup = { stones: stones(0, [0, 0], [1, 0], [2, 0]), toMove: 1 };
        expect(canonicalKey(apart)).not.toBe(canonicalKey(adjacent));
        expect(canonicalKey(straight)).not.toBe(canonicalKey(bent));
    });

    it('swaps the player to move along with the stones', () => {
        const mixed: Setup = { stones: [...stones(0, [0, 0]), ...stones(1, [1, 0], [3, 0])], toMove: 0 };
        expect(canonicalKey({ stones: mixed.stones.map(swap), toMove: 1 })).toBe(canonicalKey(mixed));
        expect(canonicalKey({ ...mixed, toMove: 1 })).not.toBe(canonicalKey(mixed));
    });
});

describe('containsPosition', () => {
    it('finds an earlier position of a game inside a later one under any map', () => {
        const rng = createRng(0xfeed);
        for (let sample = 0; sample < 60; sample += 1) {
            const later = randomGame(rng, 4 + rng.int(20));
            const earlier = later.stones.slice(0, 1 + rng.int(later.stones.length));
            const { map } = randomMap(rng);
            expect(containsPosition(later.stones, earlier.map(map))).toBe(true);
        }
    });

    it('holds for a position inside itself and for an empty one', () => {
        const board = [...stones(0, [0, 0], [1, 1]), ...stones(1, [2, -1])];
        expect(containsPosition(board, board)).toBe(true);
        expect(containsPosition(board, [])).toBe(true);
    });

    it('refuses when owners differ in a way no swap repairs', () => {
        const outer = stones(0, [0, 0], [1, 0], [5, 5]);
        expect(containsPosition(outer, [...stones(0, [0, 0]), ...stones(1, [1, 0])])).toBe(false);
        expect(containsPosition(outer, stones(1, [0, 0], [1, 0]))).toBe(true);
    });

    it('refuses a shape the outer board does not hold anywhere', () => {
        const outer = stones(0, [0, 0], [1, 0], [3, 0], [0, 2]);
        expect(containsPosition(outer, stones(0, [0, 0], [1, 0], [2, 0]))).toBe(false);
        expect(containsPosition(outer, stones(0, [0, 0], [2, 0], [3, 0]))).toBe(true);
    });

    it('refuses an inner board larger than the outer one', () => {
        expect(containsPosition(stones(0, [0, 0]), stones(0, [0, 0], [1, 0]))).toBe(false);
    });
});

describe('targetContains', () => {
    const contains = (outer: readonly Stone[], inner: readonly Stone[]) => targetContains(containmentTarget(outer), containmentProbe(inner));

    it('finds an earlier position of a game, or one turned, mirrored, swapped, or shifted, inside a later one', () => {
        const rng = createRng(0xc0de);
        for (let sample = 0; sample < 80; sample += 1) {
            const later = randomGame(rng, 4 + rng.int(30));
            const earlier = later.stones.slice(0, 1 + rng.int(later.stones.length));
            const { map } = randomMap(rng);
            expect(contains(later.stones, earlier.map(map))).toBe(true);
            expect(contains(later.stones.map(map), earlier)).toBe(true);
        }
    });

    it('answers as containsPosition does on boards that share stones but not shapes', () => {
        const rng = createRng(0xbeef);
        let refused = 0;
        for (let sample = 0; sample < 200; sample += 1) {
            const outer = randomGame(rng, 3 + rng.int(25)).stones;
            const other = randomGame(rng, 1 + rng.int(6)).stones;
            const inner = rng.int(2) === 0 ? other : [...outer.slice(0, rng.int(outer.length)), ...other.slice(1)];
            const expected = containsPosition(outer, inner);
            if (!expected) refused += 1;
            expect(contains(outer, inner), JSON.stringify({ outer, inner })).toBe(expected);
        }
        expect(refused).toBeGreaterThan(50);
    });

    it('holds for a position inside itself and an empty one, and refuses a larger one or one whose owners no swap repairs', () => {
        const board = [...stones(0, [0, 0], [1, 1]), ...stones(1, [2, -1])];
        expect(contains(board, board)).toBe(true);
        expect(contains(board, [])).toBe(true);
        expect(contains(stones(0, [0, 0]), stones(0, [0, 0], [1, 0]))).toBe(false);
        const outer = stones(0, [0, 0], [1, 0], [5, 5]);
        expect(contains(outer, [...stones(0, [0, 0]), ...stones(1, [1, 0])])).toBe(false);
        expect(contains(outer, stones(1, [0, 0], [1, 0]))).toBe(true);
    });

    it('finds a probe whose anchor sits in a crowd, a ring, or alone', () => {
        const ring = stones(0, [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]);
        const crowded = [...stones(1, [0, 0]), ...ring, ...stones(1, [5, 0], [6, 0])];
        expect(contains(crowded, [...stones(1, [0, 0]), ...ring])).toBe(true);
        expect(contains(crowded.map(swap), [...stones(1, [0, 0]), ...ring])).toBe(true);
        expect(contains(crowded, [...stones(0, [0, 0]), ...ring])).toBe(false);
        expect(contains(crowded, stones(1, [10, 10], [11, 10]))).toBe(true);
        expect(contains(crowded, stones(1, [10, 10], [13, 10]))).toBe(false);
    });
});
