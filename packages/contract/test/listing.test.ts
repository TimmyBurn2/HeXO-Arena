import { describe, expect, it } from 'vitest';
import { botConcurrentGameCap, botListingSchema, humanSeedRating } from '../src/index';

const listing = { name: `sealbot`, ownerName: `quinn`, online: true, openForChallenges: true, rating: 1712, provisional: false, levels: null, analyzer: null };

describe('botListingSchema', () => {
    it(`carries the bot's live games, from none to its cap of ${String(botConcurrentGameCap)}`, () => {
        for (const liveGames of [0, botConcurrentGameCap]) {
            expect(botListingSchema.parse({ ...listing, liveGames }).liveGames).toBe(liveGames);
        }
        for (const liveGames of [-1, botConcurrentGameCap + 1, 1.5]) {
            expect(botListingSchema.safeParse({ ...listing, liveGames }).success).toBe(false);
        }
        expect(botListingSchema.safeParse(listing).success).toBe(false);
    });

    it(`carries the bot's levels, null until it declares them`, () => {
        const levels = { default: `b`, list: [{ id: `a`, label: `a` }, { id: `b`, label: `b` }] };
        expect(botListingSchema.parse({ ...listing, liveGames: 0, levels }).levels).toEqual(levels);
        expect(botListingSchema.parse({ ...listing, liveGames: 0 }).levels).toBeNull();
        const { levels: _omitted, ...withoutLevels } = listing;
        expect(botListingSchema.safeParse({ ...withoutLevels, liveGames: 0 }).success).toBe(false);
    });
});

describe('botListingSchema analyzer', () => {
    it(`carries the bot's analyzer and whether it can read now, null until it declares one`, () => {
        const analyzer = { maxSeconds: 5, lines: 3, whilePlaying: false, values: { scale: 1, cuts: null, meaning: `raw` }, ready: true };
        expect(botListingSchema.parse({ ...listing, liveGames: 0, analyzer }).analyzer).toEqual(analyzer);
        expect(botListingSchema.parse({ ...listing, liveGames: 0 }).analyzer).toBeNull();
        const { analyzer: _omitted, ...withoutAnalyzer } = listing;
        expect(botListingSchema.safeParse({ ...withoutAnalyzer, liveGames: 0 }).success).toBe(false);
        expect(botListingSchema.safeParse({ ...listing, liveGames: 0, analyzer: { ...analyzer, maxSeconds: 11 } }).success).toBe(false);
    });
});

describe('humanSeedRating', () => {
    it('starts a human at 1000, below a bot', () => {
        expect(humanSeedRating).toBe(1000);
    });
});
