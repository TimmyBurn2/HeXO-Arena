import {
    emptyPosition,
    hexDistance,
    lineAxes,
    place,
    winningLineLength,
    type Coord,
    type Player,
    type Position,
} from './engine';

/** The longest opening a draw accepts; longer ones let forced wins survive the balance check. */
export const maxOpeningPlies = 9;

/** Stones after the origin land at most this far from it. */
export const openingRadius = 2;

const origin: Coord = { x: 0, y: 0 };

/**
 * The 18 cells a drawn stone may take, in the fixed order an index source
 * indexes: x ascending, then y ascending.
 */
export const openingRegion: readonly Coord[] = regionCells();

function regionCells(): Coord[] {
    const cells: Coord[] = [];
    for (let x = -openingRadius; x <= openingRadius; x += 1) {
        for (let y = -openingRadius; y <= openingRadius; y += 1) {
            const distance = hexDistance({ x, y }, origin);
            if (distance > 0 && distance <= openingRadius) cells.push({ x, y });
        }
    }
    return cells;
}

// A turn places two stones, so four of one player in a six-cell window the
// other has not touched is a win the side to move takes at once, or one the
// other side must block before playing its own game.
const threatStones = winningLineLength - 2;

/**
 * Whether an opening is fair to hand to the players: no six consecutive
 * cells on any axis hold four or more stones of one player and none of the
 * other.
 */
export function isBalancedOpening(position: Position): boolean {
    for (const axis of lineAxes) {
        const lines = new Map<number, { along: number; player: Player }[]>();
        for (const stone of position.stones) {
            // Cells on one line share their cross product with the axis;
            // x counts steps along every axis but the one that holds x fixed.
            const line = stone.x * axis.y - stone.y * axis.x;
            const along = axis.x === 0 ? stone.y : stone.x;
            const members = lines.get(line) ?? [];
            members.push({ along, player: stone.player });
            lines.set(line, members);
        }
        for (const members of lines.values()) {
            if (members.length >= threatStones && holdsThreat(members)) return false;
        }
    }
    return true;
}

// Every six-cell window holding a stone starts at most five cells behind it.
function holdsThreat(members: readonly { along: number; player: Player }[]): boolean {
    for (const member of members) {
        for (let start = member.along - winningLineLength + 1; start <= member.along; start += 1) {
            const counts = [0, 0];
            for (const other of members) {
                if (other.along >= start && other.along < start + winningLineLength) {
                    counts[other.player] = (counts[other.player] ?? 0) + 1;
                }
            }
            const [zero = 0, one = 0] = counts;
            if ((zero >= threatStones && one === 0) || (one >= threatStones && zero === 0)) return true;
        }
    }
    return false;
}

/**
 * Draw an opening of `plies` stones, an odd count up to maxOpeningPlies:
 * the origin, then each later ply on a cell of openingRegion that `index`
 * picks among those still empty, owned by the player who owns that ply.
 * `index` answers a uniform integer in [0, bound); the caller picks the generator.
 * An unbalanced draw is discarded whole and redrawn from ply 1,
 * so the result is uniform over balanced openings.
 * The stones come back in ply order.
 */
export function drawOpening(plies: number, index: (bound: number) => number): Position {
    // Odd lengths end the opening on a turn boundary, so the first player
    // turn always places two stones.
    if (!Number.isInteger(plies) || plies < 1 || plies > maxOpeningPlies || plies % 2 === 0) {
        throw new RangeError(`an opening is an odd count of plies from 1 to ${String(maxOpeningPlies)}`);
    }
    for (;;) {
        const drawn = drawOnce(plies, index);
        if (isBalancedOpening(drawn)) return drawn;
    }
}

function drawOnce(plies: number, index: (bound: number) => number): Position {
    let position = placeOrThrow(emptyPosition, origin);
    while (position.stones.length < plies) {
        const taken = new Set(position.stones.map(cellKey));
        const empty = openingRegion.filter((cell) => !taken.has(cellKey(cell)));
        const chosen = empty[index(empty.length)];
        if (chosen === undefined) throw new RangeError(`the index source drew outside [0, ${String(empty.length)})`);
        position = placeOrThrow(position, chosen);
    }
    return position;
}

// No line of six fits inside the region, so an opening placement is never
// refused and never wins.
function placeOrThrow(position: Position, cell: Coord): Position {
    const placed = place(position, cell);
    if (!placed.ok) throw new Error(`an opening placement was refused: ${placed.rejection.kind}`);
    return placed.position;
}

function cellKey(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}
