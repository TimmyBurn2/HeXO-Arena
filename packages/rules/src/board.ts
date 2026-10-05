import { hexDistance, lineAxes, placementRadius, radiusOffsets, winningLineLength, winThrough, type Coord, type Player, type Stone, type Win } from './engine';
import type { TurnCells, TurnRejection } from './setup';

/**
 * A turn judged on an indexed board without placing it:
 * playTurn's verdict on the same stones, less the position it would reach.
 */
export type TurnVerdict =
    | { readonly ok: true; readonly win: Win | null }
    | { readonly ok: false; readonly index: 0 | 1; readonly rejection: TurnRejection };

// Cells by column, then row: number keys stay exact for any integer coordinate,
// where a joined string key would cost an allocation on every lookup.
type Grid<T> = Map<number, Map<number, T>>;

function read<T>(grid: Grid<T>, x: number, y: number): T | undefined {
    return grid.get(x)?.get(y);
}

function write<T>(grid: Grid<T>, x: number, y: number, value: T): void {
    let column = grid.get(x);
    if (column === undefined) {
        column = new Map();
        grid.set(x, column);
    }
    column.set(y, value);
}

// A window is the six cells from its start along one axis, filed under its
// start's column and its row and axis together.
function windowRow(y: number, axisIndex: number): number {
    return y * lineAxes.length + axisIndex;
}

// A window's stones, packed as x's count plus eight times o's: a count never passes six.
const oneStone: Readonly<Record<Player, number>> = { 0: 1, 1: 8 };

// A window is open for a player holding at least four of its cells and the other none:
// filling the rest, at most two, completes six in one turn.
function openFor(packed: number, player: Player): boolean {
    const [own, other] = player === 0 ? [packed & 7, packed >> 3] : [packed >> 3, packed & 7];
    return own >= winningLineLength - 2 && other === 0;
}

// The offsets within placementRadius, nearest first, so a cell beside a stone is cleared in a lookup or two.
const nearestFirst = [...radiusOffsets].sort((a, b) => hexDistance(a, { x: 0, y: 0 }) - hexDistance(b, { x: 0, y: 0 }));

// Whether the window from `start` along `axis` holds `cell`.
function holds(start: Coord, axis: Coord, cell: Coord): boolean {
    const step = axis.x !== 0 ? (cell.x - start.x) / axis.x : (cell.y - start.y) / axis.y;
    return Number.isInteger(step) && step >= 0 && step < winningLineLength && cell.x === start.x + step * axis.x && cell.y === start.y + step * axis.y;
}

/**
 * A position kept indexed as stones are added:
 * who holds each cell, how many stones of each player every six-cell window holds, and whether a six stands on it.
 * Adding a stone, judging a turn, and asking whether a player completes six next turn
 * each cost the same however many stones the board holds,
 * and each answers as playTurn and winsThisTurn do on the same stones.
 */
export class IndexedBoard {
    readonly #owners: Grid<Player> = new Map();
    readonly #windows: Grid<number> = new Map();
    // Each player's open windows.
    readonly #open: [number, number] = [0, 0];
    #size = 0;
    #six = false;

    /** A board holding `stones`, added in order. */
    constructor(stones: readonly Stone[] = []) {
        for (const stone of stones) this.add(stone);
    }

    /** Stones on the board. */
    get size(): number {
        return this.#size;
    }

    /**
     * Adds a stone as a set-up board takes one, legal or not;
     * a cell already held keeps the stone it holds.
     */
    add(stone: Stone): void {
        const { x, y, player } = stone;
        if (read(this.#owners, x, y) !== undefined) return;
        write(this.#owners, x, y, player);
        this.#size += 1;
        // Any six holds a stone added last of its six, so it is found as that stone lands.
        if (!this.#six) this.#six = winThrough((cx, cy) => read(this.#owners, cx, cy) === player, stone) !== null;
        for (const [axisIndex, axis] of lineAxes.entries()) {
            for (let back = 0; back < winningLineLength; back += 1) {
                const startX = x - back * axis.x;
                const row = windowRow(y - back * axis.y, axisIndex);
                const before = read(this.#windows, startX, row) ?? 0;
                const after = before + oneStone[player];
                write(this.#windows, startX, row, after);
                for (const each of [0, 1] as const) this.#open[each] += Number(openFor(after, each)) - Number(openFor(before, each));
            }
        }
    }

    /** Whether `player` can complete six with its next turn, as winsThisTurn says. */
    winsThisTurn(player: Player): boolean {
        return this.#open[player] > 0;
    }

    /**
     * Whether `player` can still complete six with its next turn once the other player's stones fill `cells`, empty now:
     * what winsThisTurn says of the board with them added.
     */
    winsThisTurnAfter(player: Player, cells: readonly Coord[]): boolean {
        let closed = 0;
        for (const [index, cell] of cells.entries()) {
            for (const [axisIndex, axis] of lineAxes.entries()) {
                for (let back = 0; back < winningLineLength; back += 1) {
                    const start = { x: cell.x - back * axis.x, y: cell.y - back * axis.y };
                    // A window holding an earlier cell was counted with it.
                    if (cells.slice(0, index).some((earlier) => holds(start, axis, earlier))) continue;
                    if (openFor(read(this.#windows, start.x, windowRow(start.y, axisIndex)) ?? 0, player)) closed += 1;
                }
            }
        }
        return this.#open[player] > closed;
    }

    /** The turn `cells` would be for `toMove`, judged as playTurn judges it on these stones; nothing is placed. */
    judgeTurn(toMove: Player, cells: TurnCells): TurnVerdict {
        if (this.#six) return { ok: false, index: 0, rejection: { kind: `game-finished` } };
        const earlier: Coord[] = [];
        for (const [index, cell] of cells.entries()) {
            const at = index === 0 ? 0 : 1;
            const why = this.#refusal(cell, earlier);
            if (why !== null) return { ok: false, index: at, rejection: why };
            const owns = (x: number, y: number) => read(this.#owners, x, y) === toMove || earlier.some((stone) => stone.x === x && stone.y === y);
            const win = winThrough(owns, { ...cell, player: toMove });
            if (win !== null) return at < cells.length - 1 ? { ok: false, index: 1, rejection: { kind: `game-finished` } } : { ok: true, win };
            earlier.push(cell);
        }
        return cells.length === 1 ? { ok: false, index: 1, rejection: { kind: `turn-unfinished` } } : { ok: true, win: null };
    }

    // rejection() for a cell after `earlier`, this turn's stones before it, none of which won.
    #refusal(cell: Coord, earlier: readonly Coord[]): TurnRejection | null {
        if (read(this.#owners, cell.x, cell.y) !== undefined || earlier.some((stone) => stone.x === cell.x && stone.y === cell.y)) return { kind: `cell-occupied` };
        if (this.#size + earlier.length === 0) return cell.x !== 0 || cell.y !== 0 ? { kind: `first-stone-off-origin` } : null;
        const near =
            earlier.some((stone) => hexDistance(stone, cell) <= placementRadius) ||
            nearestFirst.some((offset) => read(this.#owners, cell.x + offset.x, cell.y + offset.y) !== undefined);
        return near ? null : { kind: `outside-placement-radius` };
    }
}
