import { describe, expect, it } from 'vitest';
import { cellSize } from '../src/board/geometry';
import { podiumLayout } from '../src/ladder/podium';

const row = Math.sqrt(3) * cellSize;

describe('podiumLayout', () => {
    it('stand the towers of 5, 6, and 4 left to right, each in the middle of its third', () => {
        const layout = podiumLayout(4, [1, 2, 3]);
        const { x, w } = layout.viewBox;
        expect(layout.towers.map((tower) => [tower.place, tower.stones.length])).toEqual([
            [2, 5],
            [1, 6],
            [3, 4],
        ]);
        const thirds = layout.towers.map((tower) => ((tower.stones[0]?.x ?? 0) - x) / w);
        expect(thirds.map((share) => share.toFixed(4))).toEqual([(1 / 6).toFixed(4), (1 / 2).toFixed(4), (5 / 6).toFixed(4)]);
    });

    it('stack each tower straight up a column from the floor\'s top row', () => {
        const layout = podiumLayout(4, [1, 2, 3]);
        for (const tower of layout.towers) {
            expect(new Set(tower.stones.map((stone) => stone.x)).size).toBe(1);
            expect(tower.stones.map((stone) => Math.round(stone.y / row))).toEqual(tower.stones.map((_, index) => -index));
        }
        const floorTop = Math.min(...layout.floor.map((cell) => cell.y));
        expect(Math.round(floorTop / row)).toBe(1);
    });

    it('drop each plate onto its tower: the six a short way below the top, the shorter towers further', () => {
        const layout = podiumLayout(12, [1, 2, 3]);
        const drops = Object.fromEntries(layout.towers.map((tower) => [tower.place, tower.drop * layout.viewBox.w]));
        expect((drops[1] ?? 0) / row).toBeCloseTo(0.5);
        expect((drops[2] ?? 0) / row).toBeCloseTo(1.5);
        expect((drops[3] ?? 0) / row).toBeCloseTo(2.5);
    });

    it('stand the first alone, then the first and second, for fewer players', () => {
        expect(podiumLayout(4, [1]).towers.map((tower) => tower.place)).toEqual([1]);
        expect(podiumLayout(4, [1, 2]).towers.map((tower) => tower.place)).toEqual([2, 1]);
    });

    it('run the floor two rows deep past both edges of the strip', () => {
        const layout = podiumLayout(4, [1]);
        const { x, w } = layout.viewBox;
        expect(Math.min(...layout.floor.map((cell) => cell.x))).toBeLessThan(x);
        expect(Math.max(...layout.floor.map((cell) => cell.x))).toBeGreaterThan(x + w);
        expect(new Set(layout.floor.map((cell) => cell.x)).size * 2).toBe(layout.floor.length);
    });
});
