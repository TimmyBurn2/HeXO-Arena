import { describe, expect, it } from 'vitest';
import type { AxialCoord, BoardCell, PlayerColor, WinLine } from '@hexo-arena/contract';
import {
    axialCoordSchema,
    boardSnapshotSchema,
    openingPliesSchema,
    openingPliesValues,
    openingRadius as contractOpeningRadius,
    openingThreatStones,
    openingWindowCells,
    winLineSchema,
} from '@hexo-arena/contract';
import type { Coord, Player, Position, Stone, Win } from '../src';
import {
    drawOpening,
    emptyPosition,
    hexDistance,
    isBalancedOpening,
    maxOpeningPlies,
    openingRadius,
    openingRegion,
    place,
    winner,
} from '../src';

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

    it('draws on the region radius the contract states', () => {
        expect(openingRadius).toBe(contractOpeningRadius);
        const distances = openingRegion.map((cell) => hexDistance(cell, { x: 0, y: 0 }));
        expect(Math.max(...distances)).toBe(contractOpeningRadius);
    });

    it('draws exactly the opening lengths the contract accepts', () => {
        expect(maxOpeningPlies).toBe(Math.max(...openingPliesValues));
        for (let plies = 0; plies <= maxOpeningPlies + 2; plies += 1) {
            if (openingPliesSchema.safeParse(plies).success) {
                expect(drawOpening(plies, () => 0).stones).toHaveLength(plies);
            } else {
                expect(() => drawOpening(plies, () => 0)).toThrow(RangeError);
            }
        }
    });

    it('rejects the threat the contract states and nothing shorter or wider', () => {
        // All but one stone packed from x = 0, the last at the given x.
        const row = (count: number, lastX: number): Position => ({
            stones: [
                ...Array.from({ length: count - 1 }, (_, x) => ({ x, y: 5, player: 1 as const })),
                { x: lastX, y: 5, player: 1 },
            ],
        });
        expect(isBalancedOpening(row(openingThreatStones, openingWindowCells - 1))).toBe(false);
        expect(isBalancedOpening(row(openingThreatStones, openingWindowCells))).toBe(true);
        expect(isBalancedOpening(row(openingThreatStones - 1, openingWindowCells - 1))).toBe(true);
    });
});
