import { describe, expect, it } from 'vitest';
import type { AxialCoord, BoardCell, PlayerColor, WinLine } from '@hexarena/contract';
import {
    axialCoordSchema,
    boardSnapshotSchema,
    winLineSchema,
} from '@hexarena/contract';
import type { Coord, Player, Position, Stone, Win } from '../src';
import { emptyPosition, place, winner } from '../src';

// The wire types must stay assignable to the engine's domain types in the
// direction the server converts: parsed wire data flows into engine calls.
type Assignable<From, To> = [From] extends [To] ? true : false;

const _coordAssignable: Assignable<AxialCoord, Coord> = true;
const _playerAssignable: Assignable<PlayerColor, Player> = true;
const _stoneAssignable: Assignable<BoardCell, Stone> = true;
const _winAssignable: Assignable<WinLine, Win> = true;

// A finished game whose winning window the contract schema must accept.
function finishedGame(): Win | null {
    let position: Position = emptyPosition;
    for (const coord of [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: 2 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 3, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 5, y: 0 },
    ] as const) {
        const result = place(position, coord);
        if (!result.ok) {
            throw new Error(`unexpected rejection ${result.rejection.kind}`);
        }
        position = result.position;
    }
    return winner(position);
}

describe('contract compatibility', () => {
    it('parses engine coordinates as wire coordinates', () => {
        const coord: Coord = { x: -12, y: 34 };
        expect(axialCoordSchema.parse(coord)).toEqual(coord);
    });

    it('parses engine stones as a wire snapshot', () => {
        const win = finishedGame();
        expect(win).not.toBeNull();
        if (win === null) {
            return;
        }
        const snapshot = boardSnapshotSchema.parse({
            cells: [
                { x: 0, y: 0, player: 0 },
                { x: 5, y: 0, player: 0 },
            ],
        });
        expect(snapshot.cells).toHaveLength(2);
        const wire: WinLine = winLineSchema.parse({
            player: win.player,
            cells: [...win.cells],
        });
        expect(wire.player).toBe(0);
        expect(wire.cells.map((cell) => cell.x)).toEqual([0, 1, 2, 3, 4, 5]);
    });
});
