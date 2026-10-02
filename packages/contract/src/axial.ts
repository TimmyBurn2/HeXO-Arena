import type { PlayerColor } from './board';
import type { Side } from './stream';

// Two axial systems meet at the engine boundary: the wire speaks q,r
// (+q right, +r top-right) and the engine stores x,y. The fixed bijection
// is x = q + r, y = -r, so the origin is the origin and both systems name
// the same lattice of cells.

/**
 * Convert a wire coordinate to the engine's, exactly as x = q + r, y = -r.
 */
export function wireToInternal(coord: { q: number; r: number }): { x: number; y: number } {
    // The trailing + 0 turns -0 into 0, so coordinates compare equal.
    return { x: coord.q + coord.r, y: -coord.r + 0 };
}

/**
 * Convert an engine coordinate to the wire's, the inverse of x = q + r, y = -r.
 */
export function internalToWire(coord: { x: number; y: number }): { q: number; r: number } {
    return { q: coord.x + coord.y, r: -coord.y + 0 };
}

// The wire names players by turn order: x places the origin, o answers.
// The engine numbers them, so the pair is fixed by construction.
export function sideOf(player: PlayerColor): Side {
    return player === 0 ? `x` : `o`;
}

export function playerOf(side: Side): PlayerColor {
    return side === `x` ? 0 : 1;
}
