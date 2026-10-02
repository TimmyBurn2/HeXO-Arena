import { describe, expect, it } from 'vitest';
import { nameKeyOf, sigilCells } from '../src/index';

// Center first, then the ring from the right, clockwise.
const drawn = (nameKey: string) => sigilCells(nameKey).map((lit) => (lit ? `1` : `0`)).join(``);

describe('sigilCells', () => {
    // Fixed vectors: a change to the hash or the cell order redraws every
    // person's pattern, so it fails here first.
    it.each([
        [`devowner-a`, `1101001`],
        [`devowner-b`, `1101000`],
        [`devowner-c`, `1010101`],
        [`mira-hex`, `1011000`],
        [`tom`, `1000010`],
        [`ana`, `1111000`],
        [`quietowner`, `1011101`],
        [`sealbot-owner-with-a-long-name`, `1100010`],
        [`a1`, `1111110`],
        [`zz`, `1111010`],
    ])('draws %s as %s', (nameKey, cells) => {
        expect(drawn(nameKey)).toBe(cells);
    });

    it('lights the center and one to five ring cells, never all six or none', () => {
        const patterns = new Set<string>();
        for (let index = 0; index < 5000; index += 1) {
            const cells = sigilCells(`player-${String(index)}`);
            const ring = cells.slice(1).filter(Boolean).length;
            expect(cells[0]).toBe(true);
            expect(ring).toBeGreaterThanOrEqual(1);
            expect(ring).toBeLessThanOrEqual(5);
            patterns.add(drawn(`player-${String(index)}`));
        }
        expect(patterns.size).toBe(62);
    });

    it('draws a name the same in any case, since it reads the fold', () => {
        expect(sigilCells(nameKeyOf(`Mira-Hex`))).toEqual(sigilCells(`mira-hex`));
    });
});
