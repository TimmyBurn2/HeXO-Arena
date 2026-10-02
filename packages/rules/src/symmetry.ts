import type { Player, Stone } from './engine';
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
