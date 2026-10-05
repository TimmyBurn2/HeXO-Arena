import { describe, expect, it } from 'vitest';
import { type Coord, IndexedBoard, openWindows, type Player, playTurn, type Stone, type TurnCells, type TurnVerdict, winsThisTurn } from '../src';
import { createRng, type Rng } from './helpers/prng';

// Dense boards in a small area, mostly x's, so windows, sixes, and taken cells come up often.
function randomBoard(rng: Rng, size: number, radius: number): Stone[] {
    const taken = new Map<string, Stone>();
    while (taken.size < size) {
        const stone: Stone = { x: rng.int(2 * radius + 1) - radius, y: rng.int(2 * radius + 1) - radius, player: rng.int(4) === 0 ? 1 : 0 };
        const key = `${String(stone.x)},${String(stone.y)}`;
        if (!taken.has(key)) taken.set(key, stone);
    }
    return [...taken.values()];
}

// Cells on and around the board, some taken, some past the placement radius,
// and often one that an open window leaves empty.
function randomCell(rng: Rng, stones: readonly Stone[]): Coord {
    const empty = [...openWindows(stones, 0), ...openWindows(stones, 1)].flatMap((window) => window.empty);
    if (empty.length > 0 && rng.int(2) === 0) return rng.pick(empty);
    return rng.int(10) === 0 ? { x: rng.int(41) - 20, y: rng.int(41) - 20 } : { x: rng.int(13) - 6, y: rng.int(13) - 6 };
}

function verdictOf(stones: readonly Stone[], toMove: Player, cells: TurnCells): TurnVerdict {
    const played = playTurn({ stones, toMove }, cells);
    return played.ok ? { ok: true, win: played.win } : { ok: false, index: played.index, rejection: played.rejection };
}

describe('IndexedBoard', () => {
    it('judges every turn as playTurn does, refusals and sixes alike, on boards with and without a six', () => {
        const rng = createRng(0xb0a2d);
        const seen = new Set<string>();
        for (let sample = 0; sample < 300; sample += 1) {
            const stones = randomBoard(rng, rng.int(30), 3);
            const board = new IndexedBoard(stones);
            for (let turn = 0; turn < 20; turn += 1) {
                const toMove: Player = rng.int(2) === 0 ? 0 : 1;
                const cells: TurnCells = rng.int(3) === 0 ? [randomCell(rng, stones)] : [randomCell(rng, stones), randomCell(rng, stones)];
                const expected = verdictOf(stones, toMove, cells);
                expect(board.judgeTurn(toMove, cells)).toEqual(expected);
                seen.add(expected.ok ? (expected.win === null ? `played` : `won`) : expected.rejection.kind);
            }
        }
        expect([...seen].sort()).toEqual([`cell-occupied`, `first-stone-off-origin`, `game-finished`, `outside-placement-radius`, `played`, `turn-unfinished`, `won`]);
    });

    it('says whether a player completes six next turn as the full scan does, after every stone added', () => {
        const rng = createRng(0x51c5);
        let wins = 0;
        for (let sample = 0; sample < 60; sample += 1) {
            const stones = randomBoard(rng, 30, 5);
            const board = new IndexedBoard();
            for (const [index, stone] of stones.entries()) {
                board.add(stone);
                const placed = stones.slice(0, index + 1);
                for (const player of [0, 1] as const) {
                    expect(board.winsThisTurn(player)).toBe(winsThisTurn(placed, player));
                    if (board.winsThisTurn(player)) wins += 1;
                }
            }
            expect(board.size).toBe(stones.length);
        }
        expect(wins).toBeGreaterThan(100);
    });

    it('says whether a player still completes six once the other player fills two empty cells, as the full scan of that board does', () => {
        const rng = createRng(0xaf7e2);
        const seen = { still: 0, closed: 0 };
        for (let sample = 0; sample < 200; sample += 1) {
            const stones = randomBoard(rng, 8 + rng.int(14), 4);
            const board = new IndexedBoard(stones);
            const taken = new Set(stones.map((stone) => `${String(stone.x)},${String(stone.y)}`));
            for (let pair = 0; pair < 20; pair += 1) {
                const cells = [randomCell(rng, stones), randomCell(rng, stones)].filter((cell, index, all) => !taken.has(`${String(cell.x)},${String(cell.y)}`) && all.findIndex((other) => other.x === cell.x && other.y === cell.y) === index);
                for (const player of [0, 1] as const) {
                    const other: Player = player === 0 ? 1 : 0;
                    const expected = winsThisTurn([...stones, ...cells.map((cell) => ({ ...cell, player: other }))], player);
                    expect(board.winsThisTurnAfter(player, cells)).toBe(expected);
                    if (board.winsThisTurn(player)) seen[expected ? `still` : `closed`] += 1;
                }
            }
        }
        expect(seen.still).toBeGreaterThan(20);
        expect(seen.closed).toBeGreaterThan(20);
    });

    it('keeps the first stone on a cell added twice, as a board indexed once holds it', () => {
        const board = new IndexedBoard([{ x: 0, y: 0, player: 0 }]);
        board.add({ x: 0, y: 0, player: 1 });
        expect(board.size).toBe(1);
        expect(board.judgeTurn(1, [{ x: 0, y: 0 }])).toEqual({ ok: false, index: 0, rejection: { kind: `cell-occupied` } });
    });
});
