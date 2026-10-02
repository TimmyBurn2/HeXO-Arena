import type { BoardStone } from '../src/board/Board';

// A mid-game position: origin, an opening pair, and turns both sides could
// have played, spanning enough of the board to show every overlay.
const placementOrder: readonly (readonly [number, number, `x` | `o`])[] = [
    [0, 0, `x`],
    [1, -1, `o`],
    [0, 1, `o`],
    [2, 0, `x`],
    [-1, 2, `x`],
    [2, -2, `o`],
    [-2, 1, `o`],
    [3, -1, `x`],
    [-2, 3, `x`],
    [1, 1, `o`],
    [-3, 2, `o`],
    [3, -3, `x`],
    [-1, -2, `x`],
    [0, -3, `o`],
    [-3, 3, `o`],
    [2, 1, `x`],
    [-4, 2, `x`],
];

export const midGameStones: readonly BoardStone[] = placementOrder.map(([x, y, side], index) => ({
    x,
    y,
    side,
    number: index + 1,
}));
