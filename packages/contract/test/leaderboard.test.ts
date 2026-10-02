import { describe, expect, it } from 'vitest';
import { leaderboardCap, leaderboardEntrySchema, leaderboardQuerySchema, leaderboardSchema } from '../src/leaderboard';

describe('leaderboardQuerySchema', () => {
    it('shows everyone active in the last 30 days when nothing is asked for', () => {
        expect(leaderboardQuerySchema.parse({})).toEqual({ kind: `all`, active: `30d` });
    });

    it('accepts bots and humans and rejects anything else', () => {
        expect(leaderboardQuerySchema.parse({ kind: `bots` }).kind).toBe(`bots`);
        expect(leaderboardQuerySchema.parse({ kind: `humans` }).kind).toBe(`humans`);
        expect(leaderboardQuerySchema.safeParse({ kind: `bot` }).success).toBe(false);
    });

    it('reaches every rankable player with all, and nothing between', () => {
        expect(leaderboardQuerySchema.parse({ active: `all` }).active).toBe(`all`);
        expect(leaderboardQuerySchema.safeParse({ active: `7d` }).success).toBe(false);
    });
});

const human = { rank: 1, name: `ann`, kind: `human`, rating: 1612, games: 48, lastPlayedAt: `2026-10-01T08:49:13Z` };
const bot = { ...human, name: `alpha`, kind: `bot`, ownerName: `ann`, online: true };

describe('leaderboardEntrySchema', () => {
    it('carries whole-point ratings and ranks from one', () => {
        expect(leaderboardEntrySchema.safeParse(human).success).toBe(true);
        expect(leaderboardEntrySchema.safeParse({ ...human, rank: 0 }).success).toBe(false);
        expect(leaderboardEntrySchema.safeParse({ ...human, rating: 1612.5 }).success).toBe(false);
    });

    it('names a bot\'s owner and presence, and nothing of the kind for a human', () => {
        expect(leaderboardEntrySchema.parse(bot)).toEqual(bot);
        expect(leaderboardEntrySchema.safeParse({ ...bot, ownerName: null }).success).toBe(true);
        expect(leaderboardEntrySchema.safeParse({ ...bot, online: undefined }).success).toBe(false);
        expect(leaderboardEntrySchema.parse({ ...human, online: true })).not.toHaveProperty(`online`);
    });

    it('counts the rated games played and when the latest finished', () => {
        expect(leaderboardEntrySchema.safeParse({ ...human, games: 0 }).success).toBe(false);
        expect(leaderboardEntrySchema.safeParse({ ...human, lastPlayedAt: `yesterday` }).success).toBe(false);
    });
});

describe('leaderboardSchema', () => {
    it('lists at most the cap', () => {
        expect(leaderboardSchema.safeParse(Array.from({ length: leaderboardCap }, () => human)).success).toBe(true);
        expect(leaderboardSchema.safeParse(Array.from({ length: leaderboardCap + 1 }, () => human)).success).toBe(false);
    });
});
