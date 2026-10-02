import { lineAxes, winningLineLength, type Coord, type Player, type Stone } from './engine';

/**
 * Six consecutive cells on one line axis that hold at least
 * `winningLineLength - 2` of one player's stones and none of the other's:
 * that player completes six there by filling `empty`, at most two cells, in one turn.
 */
export interface OpenWindow {
    readonly player: Player;
    readonly cells: readonly Coord[];
    readonly empty: readonly Coord[];
}

// A turn places two stones, and both always land in reach: the window's own
// stones sit within five cells of its empty ones, inside the placement radius.
const openStones = winningLineLength - 2;

/**
 * Every open window of `player` on the board, each once;
 * the player can complete six this turn exactly when one exists.
 */
export function openWindows(stones: readonly Stone[], player: Player): OpenWindow[] {
    const owners = new Map<string, Player>();
    for (const stone of stones) owners.set(cellKey(stone), stone.player);
    const seen = new Set<string>();
    const windows: OpenWindow[] = [];
    for (const stone of stones) {
        if (stone.player !== player) continue;
        for (const [axisIndex, axis] of lineAxes.entries()) {
            for (let back = 0; back < winningLineLength; back += 1) {
                const start = { x: stone.x - back * axis.x, y: stone.y - back * axis.y };
                const id = `${String(axisIndex)}:${cellKey(start)}`;
                if (seen.has(id)) continue;
                seen.add(id);
                const window = openWindowAt(owners, player, start, axis);
                if (window !== null) windows.push(window);
            }
        }
    }
    return windows;
}

/** Whether `player` can complete six with its next turn. */
export function winsThisTurn(stones: readonly Stone[], player: Player): boolean {
    return openWindows(stones, player).length > 0;
}

function openWindowAt(owners: ReadonlyMap<string, Player>, player: Player, start: Coord, axis: Coord): OpenWindow | null {
    const cells: Coord[] = [];
    const empty: Coord[] = [];
    for (let step = 0; step < winningLineLength; step += 1) {
        const cell = { x: start.x + step * axis.x, y: start.y + step * axis.y };
        const owner = owners.get(cellKey(cell));
        if (owner === undefined) {
            empty.push(cell);
        } else if (owner !== player) {
            return null;
        }
        cells.push(cell);
    }
    return winningLineLength - empty.length >= openStones ? { player, cells, empty } : null;
}

function cellKey(cell: Coord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}
