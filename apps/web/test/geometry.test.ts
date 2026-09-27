import { describe, expect, it } from 'vitest';
import type { AxialCoord } from '@hexo-arena/contract';
import { isWithinPlacementRadius } from '@hexo-arena/rules';
import {
    cellPoints,
    frontierCells,
    frontierOutline,
    hexCenter,
    ringPoints,
    stoneRadius,
    viewBoxOf,
} from '../src/board/geometry';

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

describe('frontierCells', () => {
    it('allow the origin alone on an empty board', () => {
        expect(frontierCells([])).toEqual([origin]);
    });

    it('cover the placement radius around a lone stone and nothing past it', () => {
        const cells = frontierCells([origin]);
        expect(cells).toHaveLength(217);
        expect(cells).toContainEqual({ x: 8, y: 0 });
        expect(cells).toContainEqual({ x: -8, y: 8 });
        expect(cells).not.toContainEqual({ x: 9, y: 0 });
        expect(cells).not.toContainEqual({ x: 5, y: 5 });
    });

    it('agree with the rules on every cell it draws', () => {
        const stones = [origin, { x: 6, y: -2 }];
        const placed = stones.map((stone) => ({ ...stone, player: 0 as const }));
        for (const cell of frontierCells(stones)) {
            expect(isWithinPlacementRadius(placed, cell)).toBe(true);
        }
    });

    it('grow by chaining as stones spread', () => {
        const cells = frontierCells([origin, { x: 8, y: 0 }]);
        expect(cells).toContainEqual({ x: 16, y: 0 });
        expect(cells).not.toContainEqual({ x: 17, y: 0 });
    });

    it('order rows top to bottom and cells left to right', () => {
        const cells = frontierCells([origin]);
        const keys = cells.map((cell) => `${String(cell.y)},${String(cell.x)}`);
        const sorted = [...keys].sort((a, b) => {
            const [ay = 0, ax = 0] = a.split(`,`).map(Number);
            const [by = 0, bx = 0] = b.split(`,`).map(Number);
            return ay === by ? ax - bx : ay - by;
        });
        expect(keys).toEqual(sorted);
    });
});

describe('frontierOutline', () => {
    it('trace a lone cell with its six edges', () => {
        expect(frontierOutline([origin]).match(/M/g)).toHaveLength(6);
    });

    it('skip the edge two neighbors share', () => {
        expect(frontierOutline([origin, { x: 1, y: 0 }]).match(/M/g)).toHaveLength(10);
    });

    it('trace only the rim of a full disk', () => {
        // A radius-8 hexagon has 6 * 8 rim cells; corner cells expose three
        // edges, side cells two.
        expect(frontierOutline(frontierCells([origin])).match(/M/g)).toHaveLength(6 * 3 + 6 * 7 * 2);
    });
});

describe('viewBoxOf', () => {
    it('frames every cell center with a margin', () => {
        const box = viewBoxOf([origin, { x: 4, y: 0 }]);
        expect(box.x).toBeLessThan(0);
        expect(box.w).toBeGreaterThan(4 * Math.sqrt(3) * 28);
    });
});

describe('stoneRadius', () => {
    it('fall back to the sheet scale when no sheet is loaded', () => {
        expect(stoneRadius()).toBeCloseTo(28 * 0.82);
    });
});
