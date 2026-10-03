import { describe, expect, it } from 'vitest';
import { duelEstimateSchema, estimateMoreGames, estimateOf, ratingOfScore, type EstimateUnit } from '../src';

// Pairs as the first bot's points in each: 2 both won, 1 split, 0 both lost.
const pairs = (...points: number[]): EstimateUnit[] => points.map((value) => ({ games: 2, points: value }));
const repeat = (count: number, value: number) => Array.from({ length: count }, () => value);

describe('the estimate of a test', () => {
    it('says nothing before a game is over', () => {
        expect(estimateOf([])).toBeNull();
        expect(estimateOf([{ games: 0, points: 0 }])).toBeNull();
    });

    it('counts a game without a winner as a half to each bot', () => {
        const estimate = estimateOf([...pairs(2, 1), { games: 2, points: 1.5 }]);
        expect(estimate?.games).toBe(6);
        expect(estimate?.points).toEqual({ first: 4.5, second: 1.5 });
    });

    it('turns a score share into rating points on the logistic scale', () => {
        expect(ratingOfScore(0.5)).toBe(0);
        expect(Math.round(ratingOfScore(10 / 11))).toBe(400);
        expect(ratingOfScore(0.25)).toBeCloseTo(-ratingOfScore(0.75), 9);
    });

    it('finds an even split too close to call, centered on zero', () => {
        const estimate = estimateOf(pairs(...repeat(10, 1)));
        expect(estimate).toMatchObject({ rating: 0, chance: 0.5, favored: null, verdict: `too_close` });
        expect(estimate?.low).toBeLessThan(0);
        expect(estimate?.high).toBe(-(estimate?.low ?? 0));
    });

    it('reads 31 to 19 over 25 pairs as about 80 points stronger, likely so, with a range that still reaches below zero', () => {
        // 6 pairs both won, 19 split: 31 to 19.
        const estimate = estimateOf(pairs(...repeat(6, 2), ...repeat(19, 1)));
        expect(estimate?.points).toEqual({ first: 31, second: 19 });
        expect(estimate?.rating).toBeGreaterThan(70);
        expect(estimate?.rating).toBeLessThan(90);
        expect(estimate?.favored).toBe(`first`);
        expect(estimate?.chance).toBeGreaterThan(0.95);
        expect(estimate?.verdict).toBe(`likely_stronger`);
        expect(estimate?.low).toBeLessThan(estimate?.rating ?? 0);
        expect(estimate?.high).toBeGreaterThan(estimate?.rating ?? 0);
    });

    it('counts by pairs: split pairs leave a narrower range than the same score from pairs won and lost whole', () => {
        const split = estimateOf(pairs(...repeat(6, 2), ...repeat(19, 1)));
        const whole = estimateOf(pairs(...repeat(15, 2), 1, ...repeat(9, 0)));
        expect(split?.points).toEqual(whole?.points);
        const width = (estimate: typeof split) => (estimate?.high ?? 0) - (estimate?.low ?? 0);
        expect(width(split)).toBeLessThan(width(whole));
    });

    it('names a sweep of 20 stronger, a finite estimate, and a finite lower end', () => {
        const estimate = estimateOf(pairs(...repeat(10, 2)));
        expect(estimate?.points).toEqual({ first: 20, second: 0 });
        expect(estimate?.verdict).toBe(`stronger`);
        expect(estimate?.favored).toBe(`first`);
        expect(estimate?.chance).toBeGreaterThanOrEqual(0.99);
        expect(Number.isFinite(estimate?.rating)).toBe(true);
        expect(estimate?.low).toBeGreaterThan(0);
    });

    it('keeps one pair won from any verdict, its range reaching past any finite difference', () => {
        const estimate = estimateOf(pairs(2));
        expect(estimate?.verdict).toBe(`too_close`);
        expect(estimate?.high).toBeNull();
        expect(estimate?.low).toBeLessThan(-400);
    });

    it('favors the second bot when the first trails, mirroring the first\'s lead', () => {
        const ahead = estimateOf(pairs(...repeat(8, 2), ...repeat(12, 1)));
        const behind = estimateOf(pairs(...repeat(8, 0), ...repeat(12, 1)));
        expect(behind?.favored).toBe(`second`);
        expect(behind?.rating).toBe(-(ahead?.rating ?? 0));
        expect(behind?.verdict).toBe(ahead?.verdict);
        expect(behind?.chance).toBeCloseTo(1 - (ahead?.chance ?? 0), 3);
    });

    it(`narrows the range after another ${String(estimateMoreGames)} games`, () => {
        const estimate = estimateOf(pairs(...repeat(6, 2), ...repeat(19, 1)));
        const half = ((estimate?.high ?? 0) - (estimate?.low ?? 0)) / 2;
        expect(estimate?.narrowed).toBeGreaterThan(0);
        expect(estimate?.narrowed).toBeLessThan(half);
    });

    it('counts a lone game beside whole pairs as one game', () => {
        const estimate = estimateOf([...pairs(2, 1), { games: 1, points: 1 }]);
        expect(estimate?.games).toBe(5);
        expect(estimate?.points).toEqual({ first: 4, second: 1 });
    });

    it('fits the estimate the duel pages read', () => {
        for (const units of [pairs(2), pairs(...repeat(10, 2)), pairs(1, 1.5, 0.5), pairs(...repeat(25, 0))]) {
            expect(duelEstimateSchema.safeParse(estimateOf(units)).success).toBe(true);
        }
    });
});
