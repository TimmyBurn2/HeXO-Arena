import type { Coord, Player, Stone } from './engine';
import { otherPlayer, type Setup } from './setup';

// The game cannot tell a board from its image under a turn by a multiple of
// 60 degrees, a mirror, or swapping the players, 24 maps in all, nor from a
// shifted copy, since the placement radius and the lines are translation free.
// In the engine's axial x,y a sixth of a turn is (x, y) -> (x + y, -x) and
// swapping the axes is a mirror; together they make all 12 dihedral maps.
interface Symmetry {
    readonly sixths: number;
    readonly mirrored: boolean;
    readonly swapped: boolean;
}

const symmetries: readonly Symmetry[] = [0, 1, 2, 3, 4, 5].flatMap((sixths) =>
    [false, true].flatMap((mirrored) => [false, true].map((swapped) => ({ sixths, mirrored, swapped }))),
);

function mapStone(stone: Stone, symmetry: Symmetry): Stone {
    let x = symmetry.mirrored ? stone.y : stone.x;
    let y = symmetry.mirrored ? stone.x : stone.y;
    for (let sixth = 0; sixth < symmetry.sixths; sixth += 1) {
        [x, y] = [x + y, -x];
    }
    return { x, y, player: symmetry.swapped ? otherPlayer(stone.player) : stone.player };
}

/**
 * A key equal for two positions exactly when one is the other under some
 * turn, mirror, player swap, and shift, the player to move swapping along;
 * it groups positions that only look different.
 */
export function canonicalKey(setup: Setup): string {
    let best: string | null = null;
    for (const symmetry of symmetries) {
        const toMove: Player = symmetry.swapped ? otherPlayer(setup.toMove) : setup.toMove;
        const key = shiftedKey(setup.stones.map((stone) => mapStone(stone, symmetry)), toMove);
        if (best === null || key < best) best = key;
    }
    return best ?? shiftedKey([], setup.toMove);
}

// The stones moved so the least of them, by x then y, sits at the origin, then listed in that order.
function shiftedKey(stones: readonly Stone[], toMove: Player): string {
    const sorted = [...stones].sort((a, b) => a.x - b.x || a.y - b.y);
    const anchor = sorted[0] ?? { x: 0, y: 0 };
    const cells = sorted.map((stone) => `${String(stone.x - anchor.x)},${String(stone.y - anchor.y)},${String(stone.player)}`);
    return `${String(toMove)}/${cells.join(`;`)}`;
}

/**
 * Whether some turn, mirror, player swap, and shift of `inner` puts each of
 * its stones on a stone of `outer` with the same owner.
 * The last stone of `inner`, a played position's newest, is tried on each
 * stone of `outer` with its owner under each of the 24 maps,
 * and a try stops at its first miss.
 */
export function containsPosition(outer: readonly Stone[], inner: readonly Stone[]): boolean {
    if (inner.length > outer.length) return false;
    const anchorIndex = inner.length - 1;
    if (anchorIndex < 0) return true;
    const owners = new Map<string, Player>();
    for (const stone of outer) owners.set(cellKey(stone.x, stone.y), stone.player);
    for (const symmetry of symmetries) {
        const mapped = inner.map((stone) => mapStone(stone, symmetry));
        const anchor = mapped[anchorIndex];
        if (anchor === undefined) continue;
        for (const target of outer) {
            if (target.player !== anchor.player) continue;
            const dx = target.x - anchor.x;
            const dy = target.y - anchor.y;
            if (mapped.every((stone) => owners.get(cellKey(stone.x + dx, stone.y + dy)) === stone.player)) return true;
        }
    }
    return false;
}

function cellKey(x: number, y: number): string {
    return `${String(x)},${String(y)}`;
}

// The six neighbours of a cell, each a sixth of a turn from the one before,
// so a turn moves a neighbour's index by one.
const neighbours: readonly Coord[] = [
    { x: 1, y: 0 },
    { x: 1, y: -1 },
    { x: 0, y: -1 },
    { x: -1, y: 0 },
    { x: -1, y: 1 },
    { x: 0, y: 1 },
];

// A map as a matrix and a player swap, with where it sends each neighbour,
// so a probe's stones move by arithmetic alone.
interface LinearMap {
    readonly xx: number;
    readonly xy: number;
    readonly yx: number;
    readonly yy: number;
    readonly swapped: boolean;
    readonly neighbour: readonly number[];
}

const linearMaps: readonly LinearMap[] = symmetries.map((symmetry) => {
    const unitX = mapStone({ x: 1, y: 0, player: 0 }, symmetry);
    const unitY = mapStone({ x: 0, y: 1, player: 0 }, symmetry);
    const neighbour = neighbours.map((step) => {
        const image = mapStone({ ...step, player: 0 }, symmetry);
        return neighbours.findIndex((other) => other.x === image.x && other.y === image.y);
    });
    return { xx: unitX.x, xy: unitY.x, yx: unitX.y, yy: unitY.y, swapped: symmetry.swapped, neighbour };
});

/**
 * How far from the origin, on each axis, prepared positions keep their stones:
 * a cell is keyed by one small integer, which keeps lookups fast, and a stone
 * farther out is left out of the preparation.
 */
export const containmentReach = 2 ** 14;

function numericKey(x: number, y: number): number | null {
    if (x <= -containmentReach || x >= containmentReach || y <= -containmentReach || y >= containmentReach) return null;
    return (x + containmentReach) * 2 * containmentReach + (y + containmentReach);
}

// A neighbourhood as a base-3 number, one digit a neighbour:
// 0 for an empty cell, 1 and 2 for the two players.
const patternCount = 3 ** neighbours.length;

/** A position prepared to have other positions looked for inside it, as often as needed. */
export interface ContainmentTarget {
    readonly size: number;
    readonly owners: ReadonlyMap<number, Player>;
    /** Each stone, by its owner and neighbourhood pattern. */
    readonly byPattern: ReadonlyMap<number, readonly Coord[]>;
    readonly byPlayer: readonly [readonly Coord[], readonly Coord[]];
}

// Where the anchor can land under one map: on a stone of `player` whose
// neighbours match `fixed` wherever it is not 0, listed as the patterns
// that do when few enough, else found by a scan of the player's stones.
interface AnchorImage {
    readonly player: Player;
    readonly fixed: readonly number[];
    readonly patterns: readonly number[] | null;
}

/** A position prepared to be looked for inside targets: where its anchor stone may land, and its stones from there. */
export interface ContainmentProbe {
    readonly size: number;
    readonly images: readonly AnchorImage[];
    /** Every stone but the anchor as x, y, and player from it, nearest first. */
    readonly offsets: Int32Array;
}

/** Prepares `stones` as a target, in time and memory linear in its stones. */
export function containmentTarget(stones: readonly Stone[]): ContainmentTarget {
    const owners = ownersOf(stones);
    const byPattern = new Map<number, Coord[]>();
    const byPlayer: [Coord[], Coord[]] = [[], []];
    for (const stone of stones) {
        const code = stone.player * patternCount + digitsAt(owners, stone).reduce((pattern, digit) => pattern * 3 + digit, 0);
        const bucket = byPattern.get(code);
        if (bucket === undefined) byPattern.set(code, [stone]);
        else bucket.push(stone);
        byPlayer[stone.player].push(stone);
    }
    return { size: stones.length, owners, byPattern, byPlayer };
}

/**
 * Prepares `stones` as a probe, anchored on the stone with the most
 * neighbours, the latest of those: its neighbourhood narrows a target to few
 * candidate stones.
 */
export function containmentProbe(stones: readonly Stone[]): ContainmentProbe {
    const owners = ownersOf(stones);
    let anchor: Stone | undefined;
    let anchorDigits: number[] = [];
    let most = -1;
    for (const stone of stones) {
        const digits = digitsAt(owners, stone);
        const count = digits.filter((digit) => digit !== 0).length;
        if (count >= most) {
            most = count;
            anchor = stone;
            anchorDigits = digits;
        }
    }
    if (anchor === undefined) return { size: 0, images: [], offsets: new Int32Array(0) };
    const from = anchor;
    const rest = stones.filter((stone) => stone !== from).sort((a, b) => spread(a, from) - spread(b, from));
    const offsets = new Int32Array(rest.length * 3);
    for (const [index, stone] of rest.entries()) offsets.set([stone.x - from.x, stone.y - from.y, stone.player], index * 3);
    const images = linearMaps.map((map): AnchorImage => {
        const fixed: number[] = neighbours.map(() => 0);
        for (const [index, digit] of anchorDigits.entries()) {
            const at = map.neighbour[index];
            if (digit !== 0 && at !== undefined) fixed[at] = map.swapped ? 3 - digit : digit;
        }
        const player: Player = map.swapped ? otherPlayer(from.player) : from.player;
        return { player, fixed, patterns: patternsMatching(player, fixed) };
    });
    return { size: stones.length, images, offsets };
}

/**
 * Whether some turn, mirror, player swap, and shift of the probe's position
 * puts each of its stones on a stone of the target with the same owner:
 * what containsPosition answers, for a target and a probe prepared once each.
 */
export function targetContains(target: ContainmentTarget, probe: ContainmentProbe): boolean {
    if (probe.size > target.size) return false;
    if (probe.size === 0) return true;
    for (const [index, image] of probe.images.entries()) {
        const map = linearMaps[index];
        if (map === undefined) continue;
        if (image.patterns === null) {
            for (const stone of target.byPlayer[image.player]) {
                if (image.fixed.every((digit, at) => digit === 0 || digitOf(target.owners, stone, at) === digit) && holdsProbe(target, probe, map, stone)) return true;
            }
            continue;
        }
        for (const pattern of image.patterns) {
            for (const stone of target.byPattern.get(pattern) ?? []) {
                if (holdsProbe(target, probe, map, stone)) return true;
            }
        }
    }
    return false;
}

// Every full pattern agreeing with the fixed neighbours, as bucket codes;
// past three open neighbours there are too many to list.
function patternsMatching(player: Player, fixed: readonly number[]): readonly number[] | null {
    const open = fixed.filter((digit) => digit === 0).length;
    if (open > 3) return null;
    const patterns: number[] = [];
    for (let completion = 0; completion < 3 ** open; completion += 1) {
        let pattern = 0;
        let rest = completion;
        for (const fixedDigit of fixed) {
            let digit = fixedDigit;
            if (digit === 0) {
                digit = rest % 3;
                rest = Math.floor(rest / 3);
            }
            pattern = pattern * 3 + digit;
        }
        patterns.push(player * patternCount + pattern);
    }
    return patterns;
}

function holdsProbe(target: ContainmentTarget, probe: ContainmentProbe, map: LinearMap, at: Coord): boolean {
    const offsets = probe.offsets;
    for (let index = 0; index < offsets.length; index += 3) {
        const x = offsets[index] ?? 0;
        const y = offsets[index + 1] ?? 0;
        const player = offsets[index + 2] ?? 0;
        const key = numericKey(map.xx * x + map.xy * y + at.x, map.yx * x + map.yy * y + at.y);
        const owner = key === null ? undefined : target.owners.get(key);
        if (owner !== (map.swapped ? 1 - player : player)) return false;
    }
    return true;
}

function ownersOf(stones: readonly Stone[]): Map<number, Player> {
    const owners = new Map<number, Player>();
    for (const stone of stones) {
        const key = numericKey(stone.x, stone.y);
        if (key !== null) owners.set(key, stone.player);
    }
    return owners;
}

function digitOf(owners: ReadonlyMap<number, Player>, cell: Coord, index: number): number {
    const step = neighbours[index];
    if (step === undefined) return 0;
    const key = numericKey(cell.x + step.x, cell.y + step.y);
    const owner = key === null ? undefined : owners.get(key);
    return owner === undefined ? 0 : owner + 1;
}

function digitsAt(owners: ReadonlyMap<number, Player>, cell: Coord): number[] {
    return neighbours.map((_, index) => digitOf(owners, cell, index));
}

function spread(stone: Coord, from: Coord): number {
    const dx = stone.x - from.x;
    const dy = stone.y - from.y;
    return Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy);
}
