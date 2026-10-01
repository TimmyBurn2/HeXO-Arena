import { describe, expect, it } from 'vitest';
import { glicko2Update } from '../src/glicko2';

describe('glicko2Update', () => {
    // The worked example from Glickman's "Example of the Glicko-2 system".
    // The paper rounds mu' to four places before converting back, so its
    // printed 1464.06 sits within 0.01 of the unrounded 1464.05.
    it('reproduces the worked example of the paper over a single period', () => {
        const updated = glicko2Update(
            { rating: 1500, deviation: 200, volatility: 0.06 },
            [
                { opponent: { rating: 1400, deviation: 30 }, score: 1 },
                { opponent: { rating: 1550, deviation: 100 }, score: 0 },
                { opponent: { rating: 1700, deviation: 300 }, score: 0 },
            ],
            0.5,
            1,
        );
        expect(updated.rating).toBeCloseTo(1464.06, 1);
        expect(updated.deviation).toBeCloseTo(151.52, 1);
        expect(updated.volatility).toBeCloseTo(0.05999, 4);
    });

    it('only widens the deviation of a player who sat the period out', () => {
        const updated = glicko2Update({ rating: 1500, deviation: 200, volatility: 0.06 }, [], 0.5);
        expect(updated.rating).toBe(1500);
        expect(updated.volatility).toBe(0.06);
        expect(updated.deviation).toBeCloseTo(Math.sqrt((200 / 173.7178) ** 2 + 0.06 ** 2) * 173.7178, 9);
    });

    it('widens an idle player by the volatility over as many periods as passed', () => {
        const idle = glicko2Update({ rating: 1500, deviation: 200, volatility: 0.06 }, [], 0.5, 6.4308);
        expect(idle.deviation).toBeCloseTo(Math.sqrt((200 / 173.7178) ** 2 + 6.4308 * 0.06 ** 2) * 173.7178, 9);
    });

    it('adds no period to a game that spans none', () => {
        const player = { rating: 1500, deviation: 200, volatility: 0.06 };
        const opponent = { rating: 1500, deviation: 200 };
        const spanning = glicko2Update(player, [{ opponent, score: 1 }], 0.5, 0);
        const paper = glicko2Update(player, [{ opponent, score: 1 }], 0.5, 1);
        expect(spanning.deviation).toBeLessThan(paper.deviation);
        expect(spanning.rating - 1500).toBeLessThan(paper.rating - 1500);
    });

    it('moves a winner up and a loser down by the same game', () => {
        const even = { rating: 1500, deviation: 100, volatility: 0.06 };
        const won = glicko2Update(even, [{ opponent: even, score: 1 }], 0.5);
        const lost = glicko2Update(even, [{ opponent: even, score: 0 }], 0.5);
        expect(won.rating).toBeGreaterThan(1500);
        expect(lost.rating).toBeLessThan(1500);
        expect(won.rating - 1500).toBeCloseTo(1500 - lost.rating, 9);
    });
});
