export type Player = 0 | 1;

/** An axial hex coordinate; integers, unbounded, origin at 0,0. */
export interface Coord {
    readonly x: number;
    readonly y: number;
}

/** A placed stone; the only state a position carries. */
export interface Stone extends Coord {
    readonly player: Player;
}

/**
 * A finished game's reported line: the six-cell window through the last
 * placed stone, clamped to the run.
 */
export interface Win {
    readonly player: Player;
    readonly cells: readonly Coord[];
}

/** Stones in placement order; every other view is derived from them. */
export interface Position {
    readonly stones: readonly Stone[];
}

/** Why a placement is refused; a closed enumeration, checked exhaustive. */
export type Rejection =
    | { readonly kind: `game-finished` }
    | { readonly kind: `cell-occupied` }
    | { readonly kind: `first-stone-off-origin` }
    | { readonly kind: `outside-placement-radius` };

export type RejectionKind = Rejection[`kind`];

export type Placement =
    | { readonly ok: true; readonly position: Position; readonly win: Win | null }
    | { readonly ok: false; readonly rejection: Rejection };

/** A placement is legal within this many hexes of any placed stone. */
export const placementRadius = 8;

/** Six or more contiguous stones on a hex line finish the game. */
export const winningLineLength = 6;

export const emptyPosition: Position = { stones: [] };

export function playerToMove(position: Position): Player {
    return playerAtMoveCount(position.stones.length);
}

export function placementsRemaining(position: Position): 1 | 2 {
    return placementsAtMoveCount(position.stones.length);
}

/** Axial hex distance: the fewest unit steps between two coordinates. */
export function hexDistance(a: Coord, b: Coord): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return (Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy)) / 2;
}

/**
 * The union semantics of the radius rule: legal means within placementRadius
 * of at least one placed stone, so the board grows outward without bound by
 * chaining; it is not a disk around the origin.
 */
export function isWithinPlacementRadius(
    stones: readonly Stone[],
    candidate: Coord,
): boolean {
    return stones.some((stone) => hexDistance(stone, candidate) <= placementRadius);
}

/**
 * The game's winner iff the last placed stone completes a line of
 * winningLineLength or more for its own player; hand-crafted boards that were
 * never reached by play may show six lines with no winner.
 */
export function winner(position: Position): Win | null {
    const last = position.stones[position.stones.length - 1];
    if (last === undefined) {
        return null;
    }
    return findWin(position.stones, last);
}

/**
 * Whether a placement is legal, and if not, why; checks run in the oracle's
 * rejection-precedence order so reason choice matches HeXO exactly.
 */
export function rejection(position: Position, candidate: Coord): Rejection | null {
    if (winner(position) !== null) {
        return { kind: `game-finished` };
    }
    const occupied = position.stones.some(
        (stone) => stone.x === candidate.x && stone.y === candidate.y,
    );
    if (occupied) {
        return { kind: `cell-occupied` };
    }
    if (position.stones.length === 0 && (candidate.x !== 0 || candidate.y !== 0)) {
        return { kind: `first-stone-off-origin` };
    }
    if (position.stones.length > 0 && !isWithinPlacementRadius(position.stones, candidate)) {
        return { kind: `outside-placement-radius` };
    }
    return null;
}

/**
 * Place one stone for the player whose turn it is; never mutates the input
 * position and never throws, illegal placements carry a Rejection instead.
 */
export function place(position: Position, candidate: Coord): Placement {
    const why = rejection(position, candidate);
    if (why !== null) {
        return { ok: false, rejection: why };
    }
    const stone: Stone = {
        x: candidate.x,
        y: candidate.y,
        player: playerToMove(position),
    };
    const stones = [...position.stones, stone];
    return { ok: true, position: { stones }, win: findWin(stones, stone) };
}

/**
 * A run of placements replayed at once:
 * the position it reaches and the win that ended it,
 * or the first illegal placement, by index, and why.
 */
export type Replay =
    | { readonly ok: true; readonly position: Position; readonly win: Win | null }
    | { readonly ok: false; readonly index: number; readonly rejection: Rejection };

// Every offset within placementRadius,
// so a radius check looks up a fixed number of cells however many stones the board holds.
const radiusOffsets: readonly Coord[] = (() => {
    const offsets: Coord[] = [];
    for (let x = -placementRadius; x <= placementRadius; x += 1) {
        for (let y = -placementRadius; y <= placementRadius; y += 1) {
            if (hexDistance({ x, y }, { x: 0, y: 0 }) <= placementRadius) offsets.push({ x, y });
        }
    }
    return offsets;
})();

/**
 * Place each cell in turn, as place() would,
 * stopping at the placement that wins or at the first one refused;
 * cells after either are not placed.
 * Each placement costs the same however long the game,
 * where place() rescans every stone,
 * so a stored game replays in linear time.
 */
export function replay(cells: Iterable<Coord>): Replay {
    const stones: Stone[] = [];
    const owners = new Map<string, Player>();
    let index = 0;
    for (const cell of cells) {
        const why = replayRejection(owners, stones.length, cell);
        if (why !== null) {
            return { ok: false, index, rejection: why };
        }
        const stone: Stone = { x: cell.x, y: cell.y, player: playerAtMoveCount(stones.length) };
        stones.push(stone);
        owners.set(cellKey(stone.x, stone.y), stone.player);
        const win = winThrough((x, y) => owners.get(cellKey(x, y)) === stone.player, stone);
        if (win !== null) {
            return { ok: true, position: { stones }, win };
        }
        index += 1;
    }
    return { ok: true, position: { stones }, win: null };
}

// rejection() for a board that has not been won, read from its owner map.
function replayRejection(owners: ReadonlyMap<string, Player>, placed: number, candidate: Coord): Rejection | null {
    if (owners.has(cellKey(candidate.x, candidate.y))) {
        return { kind: `cell-occupied` };
    }
    if (placed === 0) {
        return candidate.x !== 0 || candidate.y !== 0 ? { kind: `first-stone-off-origin` } : null;
    }
    const near = radiusOffsets.some((offset) => owners.has(cellKey(candidate.x + offset.x, candidate.y + offset.y)));
    return near ? null : { kind: `outside-placement-radius` };
}

// Turn 0 places the origin alone and every later turn places two stones,
// so parity falls out of the stone count alone.
function playerAtMoveCount(count: number): Player {
    if (count === 0) {
        return 0;
    }
    const completedPairs = Math.floor((count - 1) / 2);
    return completedPairs % 2 === 0 ? 1 : 0;
}

function placementsAtMoveCount(count: number): 1 | 2 {
    if (count === 0) {
        return 1;
    }
    return count % 2 === 0 ? 1 : 2;
}

/**
 * The three hex line axes, one direction each.
 * A win is checked along each with both signs, in this order,
 * and the first axis reaching six defines the reported line.
 */
export const lineAxes: readonly Coord[] = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: -1 },
];

function findWin(stones: readonly Stone[], last: Stone): Win | null {
    const owned = new Set<string>();
    for (const stone of stones) {
        if (stone.player === last.player) {
            owned.add(cellKey(stone.x, stone.y));
        }
    }
    return winThrough((x, y) => owned.has(cellKey(x, y)), last);
}

// The win through the last stone, given which cells its player owns.
function winThrough(owns: (x: number, y: number) => boolean, last: Stone): Win | null {
    for (const axis of lineAxes) {
        const backward = walk(owns, last, -axis.x, -axis.y);
        const forward = walk(owns, last, axis.x, axis.y);
        const runLength = backward + 1 + forward;
        if (runLength >= winningLineLength) {
            return {
                player: last.player,
                cells: winningWindow(backward, runLength, last, axis),
            };
        }
    }
    return null;
}

function cellKey(x: number, y: number): string {
    return `${String(x)},${String(y)}`;
}

function walk(owns: (x: number, y: number) => boolean, from: Coord, dx: number, dy: number): number {
    let x = from.x + dx;
    let y = from.y + dy;
    let steps = 0;
    while (owns(x, y)) {
        steps += 1;
        x += dx;
        y += dy;
    }
    return steps;
}

// The reported six cells center the last placed stone at index 2 of the
// window when the run allows it and clamp to the run's ends otherwise.
function winningWindow(
    backward: number,
    runLength: number,
    last: Stone,
    axis: Coord,
): Coord[] {
    const minStart = Math.max(0, backward - (winningLineLength - 1));
    const maxStart = Math.min(backward, runLength - winningLineLength);
    const preferredStart = backward - Math.floor((winningLineLength - 1) / 2);
    const start = Math.min(maxStart, Math.max(minStart, preferredStart));

    const cells: Coord[] = [];
    let x = last.x - (backward - start) * axis.x;
    let y = last.y - (backward - start) * axis.y;
    for (let i = 0; i < winningLineLength; i += 1) {
        cells.push({ x, y });
        x += axis.x;
        y += axis.y;
    }
    return cells;
}
