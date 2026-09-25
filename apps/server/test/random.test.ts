import { describe, expect, it } from 'vitest';
import { randomFloat } from '../src/random';

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
