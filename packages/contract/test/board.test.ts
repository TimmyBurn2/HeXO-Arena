import { describe, expect, it } from 'vitest';
import {
    axialCoordSchema,
    boardCellSchema,
    boardSnapshotSchema,
    playerColorSchema,
    winLineSchema,
} from '../src';

describe('board wire types', () => {
    it('accepts integer axial coordinates and rejects the rest', () => {
        expect(axialCoordSchema.parse({ x: -3, y: 5 })).toEqual({ x: -3, y: 5 });
        expect(axialCoordSchema.safeParse({ x: 1.5, y: 0 }).success).toBe(false);
        expect(axialCoordSchema.safeParse({ x: 1, y: NaN }).success).toBe(false);
    });

    it('accepts exactly the two player colors', () => {
        expect(playerColorSchema.parse(0)).toBe(0);
        expect(playerColorSchema.parse(1)).toBe(1);
        expect(playerColorSchema.safeParse(2).success).toBe(false);
        expect(playerColorSchema.safeParse(`0`).success).toBe(false);
    });

    it('parses a snapshot of cells', () => {
        const parsed = boardSnapshotSchema.parse({
            cells: [
                { x: 0, y: 0, player: 0 },
                { x: 1, y: 0, player: 1 },
            ],
        });
        expect(parsed.cells).toHaveLength(2);
    });

    it('rejects cells with an unknown player', () => {
        expect(
            boardCellSchema.safeParse({ x: 0, y: 0, player: 2 }).success,
        ).toBe(false);
    });

    it('accepts a win line of exactly six cells', () => {
        const cells = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0 }));
        expect(winLineSchema.parse({ player: 1, cells })).toEqual({
            player: 1,
            cells,
        });
        expect(
            winLineSchema.safeParse({ player: 1, cells: cells.slice(0, 5) })
                .success,
        ).toBe(false);
    });
});
