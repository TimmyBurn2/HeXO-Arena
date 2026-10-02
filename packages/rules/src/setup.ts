import {
    lineAxes,
    rejection,
    winner,
    winningLineLength,
    type Coord,
    type Player,
    type Rejection,
    type Stone,
    type Win,
} from './engine';

/**
 * A position at a turn boundary, however it arose:
 * the stones on the board, each with its owner,
 * and the player who places the next turn.
 * A played position and a set-up board share it,
 * so turns after a set-up board follow the rules unchanged.
 */
export interface Setup {
    readonly stones: readonly Stone[];
    readonly toMove: Player;
}

/** Where every game starts: the origin stone placed, the other player to move. */
export const originSetup: Setup = { stones: [{ x: 0, y: 0, player: 0 }], toMove: 1 };

/** A turn's cells: two, or one when the first completes six. */
export type TurnCells = readonly [Coord] | readonly [Coord, Coord];

/**
 * Why a turn is refused: a stone the rules refuse,
 * or `turn-unfinished`, a single stone that completes no six.
 */
export type TurnRejection = Rejection | { readonly kind: `turn-unfinished` };

/**
 * A turn played on a position: the position after it and the six it completed, if any,
 * or the refused stone, by index, and why; a missing second stone has index 1.
 */
export type TurnPlay =
    | { readonly ok: true; readonly setup: Setup; readonly win: Win | null }
    | { readonly ok: false; readonly index: 0 | 1; readonly rejection: TurnRejection };

/**
 * Play one turn for the player to move:
 * each stone on an empty cell within the placement radius of some stone, the first one included for the second;
 * a first stone that completes six ends the turn and the game, so a second is refused;
 * a board that already holds a six is finished.
 * Never mutates the input and never throws.
 */
export function playTurn(setup: Setup, cells: TurnCells): TurnPlay {
    if (sixOnBoard(setup.stones) !== null) {
        return { ok: false, index: 0, rejection: { kind: `game-finished` } };
    }
    const next = otherPlayer(setup.toMove);
    let stones = setup.stones;
    for (const [index, cell] of cells.entries()) {
        const at = index === 0 ? 0 : 1;
        const why = rejection({ stones }, cell);
        if (why !== null) {
            return { ok: false, index: at, rejection: why };
        }
        stones = [...stones, { x: cell.x, y: cell.y, player: setup.toMove }];
        const win = winner({ stones });
        if (win !== null) {
            if (at < cells.length - 1) {
                return { ok: false, index: 1, rejection: { kind: `game-finished` } };
            }
            return { ok: true, setup: { stones, toMove: next }, win };
        }
    }
    if (cells.length === 1) {
        return { ok: false, index: 1, rejection: { kind: `turn-unfinished` } };
    }
    return { ok: true, setup: { stones, toMove: next }, win: null };
}

/** Why a set-up board cannot be played from; checked in this order. */
export type SetupProblem =
    | { readonly kind: `no-stones` }
    | { readonly kind: `too-many-stones`; readonly count: number }
    | { readonly kind: `cell-taken`; readonly cell: Coord }
    | { readonly kind: `six-on-board`; readonly win: Win };

/**
 * Whether a set-up board can be played from:
 * at least one stone, at most `stoneCap`, one stone a cell, and no six already on it.
 * The cap is the caller's, so the rules carry no product limit.
 */
export function setupProblem(setup: Setup, stoneCap: number): SetupProblem | null {
    const count = setup.stones.length;
    if (count === 0) {
        return { kind: `no-stones` };
    }
    if (count > stoneCap) {
        return { kind: `too-many-stones`, count };
    }
    const seen = new Set<string>();
    for (const stone of setup.stones) {
        const key = cellKey(stone);
        if (seen.has(key)) {
            return { kind: `cell-taken`, cell: { x: stone.x, y: stone.y } };
        }
        seen.add(key);
    }
    const win = sixOnBoard(setup.stones);
    return win === null ? null : { kind: `six-on-board`, win };
}

/**
 * An exact key for a position: equal for the same stones and player to move
 * however the stones were ordered or reached, so transpositions share it.
 */
export function positionKey(setup: Setup): string {
    const cells = [...setup.stones]
        .sort((a, b) => a.x - b.x || a.y - b.y)
        .map((stone) => `${String(stone.x)},${String(stone.y)},${String(stone.player)}`);
    return `${String(setup.toMove)}/${cells.join(`;`)}`;
}

/** The player who does not own `player`'s stones. */
export function otherPlayer(player: Player): Player {
    return player === 0 ? 1 : 0;
}

// A board that was set up rather than played may hold a six anywhere,
// not only through its last stone, so every run is walked from its start.
function sixOnBoard(stones: readonly Stone[]): Win | null {
    const owners = new Map<string, Player>();
    for (const stone of stones) owners.set(cellKey(stone), stone.player);
    const owns = (x: number, y: number, player: Player) => owners.get(cellKey({ x, y })) === player;
    for (const stone of stones) {
        for (const axis of lineAxes) {
            if (owns(stone.x - axis.x, stone.y - axis.y, stone.player)) continue;
            let run = 1;
            while (run < winningLineLength && owns(stone.x + run * axis.x, stone.y + run * axis.y, stone.player)) run += 1;
            if (run === winningLineLength) {
                const cells = Array.from({ length: winningLineLength }, (_, step) => ({
                    x: stone.x + step * axis.x,
                    y: stone.y + step * axis.y,
                }));
                return { player: stone.player, cells };
            }
        }
    }
    return null;
}

function cellKey(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}
