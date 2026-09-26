import { describe, expect, it } from 'vitest';
import { randomFloat, randomIndex } from '../src/random';

describe('randomFloat', () => {
    it('draws from the unit interval without repeating itself', () => {
        const seen = new Set<number>();
        for (let draw = 0; draw < 1000; draw += 1) {
            const value = randomFloat();
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
            seen.add(value);
        }
        // A predictable source repeating values would collapse the set.
        expect(seen.size).toBeGreaterThan(900);
    });
});

describe('randomIndex', () => {
    it('draws only integers below the bound', () => {
        for (let draw = 0; draw < 1000; draw += 1) {
            const index = randomIndex(17);
            expect(Number.isInteger(index)).toBe(true);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(17);
        }
    });

    it('draws a bound of one as zero every time', () => {
        for (let draw = 0; draw < 100; draw += 1) {
            expect(randomIndex(1)).toBe(0);
        }
    });

    it('spreads its draws evenly over every index', () => {
        const bound = 18;
        const draws = 36_000;
        const counts = Array.from({ length: bound }, () => 0);
        for (let draw = 0; draw < draws; draw += 1) {
            const index = randomIndex(bound);
            counts[index] = (counts[index] ?? 0) + 1;
        }
        const expected = draws / bound;
        const chiSquare = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
        // Chi-square with 17 degrees of freedom exceeds 60 once in a million runs,
        // so a fair source practically never fails here.
        expect(chiSquare).toBeLessThan(60);
    });
});
