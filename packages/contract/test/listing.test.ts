import { describe, expect, it } from 'vitest';
import { botConcurrentGameCap, botListingSchema, humanSeedRating } from '../src/index';

const listing = { name: `sealbot`, ownerName: `tom`, online: true, openForChallenges: true, rating: 1712, provisional: false };

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
});

describe('humanSeedRating', () => {
    it('starts a human at 1000, below a bot', () => {
        expect(humanSeedRating).toBe(1000);
    });
});
