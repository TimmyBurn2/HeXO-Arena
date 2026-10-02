import { describe, expect, it } from 'vitest';
import { expectedScore } from '../src/rating';

describe('expectedScore', () => {
    // Glickman's "Example of the Glicko-2 system": a 1500 player's E against
    // its three opponents, printed to three places.
    it('reproduces the paper\'s expected scores', () => {
        const player = { rating: 1500, deviation: 200 };
        expect(expectedScore(player, { rating: 1400, deviation: 30 })).toBeCloseTo(0.639, 3);
        expect(expectedScore(player, { rating: 1550, deviation: 100 })).toBeCloseTo(0.432, 3);
        expect(expectedScore(player, { rating: 1700, deviation: 300 })).toBeCloseTo(0.303, 3);
    });

    it('reads only the opponent\'s deviation, so the two sides of an uneven pair need not sum to one', () => {
        const settled = { rating: 1600, deviation: 45 };
        const fresh = { rating: 1500, deviation: 350 };
        expect(expectedScore(settled, fresh)).toBe(expectedScore({ ...settled, deviation: 500 }, fresh));
        expect(expectedScore(settled, fresh) + expectedScore(fresh, settled)).not.toBeCloseTo(1, 2);
        expect(expectedScore(settled, { rating: 1600, deviation: 45 })).toBe(0.5);
    });
});
