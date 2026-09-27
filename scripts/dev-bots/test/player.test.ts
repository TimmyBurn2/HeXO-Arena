import { hexDistance, place, type Position } from '@hexo-arena/rules';
import { describe, expect, it } from 'vitest';
import { chooseTurn } from '../src/player';

const opening: Position = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 1, y: 0, player: 1 },
        { x: -1, y: 1, player: 1 },
    ],
};

describe('chooseTurn', () => {
    it('picks two distinct empty cells, each touching a stone', () => {
        for (const draw of [0, 0.3, 0.6, 0.999]) {
            const [first, second] = chooseTurn(opening, () => draw);
            expect(first).not.toEqual(second);
            for (const cell of [first, second]) {
                expect(opening.stones.some((stone) => stone.x === cell.x && stone.y === cell.y)).toBe(false);
                expect(opening.stones.some((stone) => hexDistance(stone, cell) === 1)).toBe(true);
            }
        }
    });

    it('answers a turn the rules accept stone by stone', () => {
        const [first, second] = chooseTurn(opening, () => 0.5);
        const placed = place(opening, first);
        expect(placed.ok).toBe(true);
        if (placed.ok) expect(place(placed.position, second).ok).toBe(true);
    });

    it('plays from the lone origin', () => {
        const [first, second] = chooseTurn({ stones: [{ x: 0, y: 0, player: 0 }] }, () => 0);
        expect(hexDistance(first, { x: 0, y: 0 })).toBe(1);
        expect(hexDistance(second, { x: 0, y: 0 })).toBe(1);
    });
});
