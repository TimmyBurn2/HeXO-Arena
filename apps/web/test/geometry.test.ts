import { describe, expect, it } from 'vitest';
import type { AxialCoord } from '@hexarena/contract';
import { cellPoints, coordLabels, hexCenter, ringPoints, stoneRadius, viewBoxOf, visibleCells } from '../src/board/geometry';

const origin: AxialCoord = { x: 0, y: 0 };

describe('hexCenter', () => {
    it('places the origin at zero', () => {
        expect(hexCenter(origin)).toEqual({ cx: 0, cy: 0 });
    });

    it('moves one cell right along x', () => {
        expect(hexCenter({ x: 1, y: 0 }).cx).toBeCloseTo(Math.sqrt(3) * 28);
        expect(hexCenter({ x: 1, y: 0 }).cy).toBe(0);
    });

    it('moves down and right along y', () => {
        expect(hexCenter({ x: 0, y: 1 }).cx).toBeCloseTo((Math.sqrt(3) * 28) / 2);
        expect(hexCenter({ x: 0, y: 1 }).cy).toBeCloseTo(1.5 * 28);
    });
});

describe('cellPoints and ringPoints', () => {
    it('draw six vertices each', () => {
        expect(cellPoints().split(` `)).toHaveLength(6);
        expect(ringPoints().split(` `)).toHaveLength(6);
    });

    it('fit inside the cell edge', () => {
        const cell = cellPoints()
            .split(` `)
            .map((pair) => Number(pair.split(`,`)[1]));
        const ring = ringPoints()
            .split(` `)
            .map((pair) => Number(pair.split(`,`)[1]));
        expect(Math.max(...ring)).toBeLessThan(Math.max(...cell));
    });
});

describe('visibleCells', () => {
    it('render the origin alone on an empty board', () => {
        expect(visibleCells([])).toEqual([origin]);
    });

    it('grow a radius-two disk around a lone stone', () => {
        const cells = visibleCells([origin]);
        expect(cells).toHaveLength(19);
        expect(cells).toContainEqual({ x: 2, y: 0 });
        expect(cells).not.toContainEqual({ x: 3, y: 0 });
    });

    it('skip cells beyond the pad of every anchor', () => {
        const cells = visibleCells([origin, { x: 6, y: 0 }]);
        expect(cells).toContainEqual({ x: 6, y: 0 });
        expect(cells).not.toContainEqual({ x: 3, y: 0 });
    });

    it('grow around extra anchors such as the keyboard focus', () => {
        const cells = visibleCells([origin], [{ x: 5, y: 0 }]);
        expect(cells).toContainEqual({ x: 5, y: 0 });
        expect(cells).toContainEqual({ x: 7, y: 0 });
    });

    it('order rows top to bottom and cells left to right', () => {
        const cells = visibleCells([origin]);
        const keys = cells.map((cell) => `${String(cell.y)},${String(cell.x)}`);
        const sorted = [...keys].sort((a, b) => {
            const [ay = 0, ax = 0] = a.split(`,`).map(Number);
            const [by = 0, bx = 0] = b.split(`,`).map(Number);
            return ay === by ? ax - bx : ay - by;
        });
        expect(keys).toEqual(sorted);
    });
});

describe('viewBoxOf', () => {
    it('frames every cell center with a margin', () => {
        const box = viewBoxOf(visibleCells([{ x: 0, y: 0 }, { x: 4, y: 0 }]));
        expect(box.x).toBeLessThan(0);
        expect(box.w).toBeGreaterThan(4 * Math.sqrt(3) * 28);
    });
});

describe('coordLabels', () => {
    it('label both axes once with their letters', () => {
        const labels = coordLabels(visibleCells([origin]));
        expect(labels.map((label) => label.text)).toEqual([`-2`, `x`, `y`, `2`]);
    });

    it('carry the anchor extremes of the middle row and near column', () => {
        const labels = coordLabels(visibleCells([{ x: 3, y: 0 }, { x: 0, y: -2 }]));
        expect(labels.map((label) => label.text)).toEqual([`-2`, `x`, `y`, `0`]);
    });
});

describe('stoneRadius', () => {
    it('fall back to the sheet scale when no sheet is loaded', () => {
        expect(stoneRadius()).toBeCloseTo(28 * 0.82);
    });
});
