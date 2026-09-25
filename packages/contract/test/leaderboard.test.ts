import { describe, expect, it } from 'vitest';
import { leaderboardEntrySchema, leaderboardQuerySchema } from '../src/leaderboard';

describe('leaderboardQuerySchema', () => {
    it('shows everyone when no kind is asked for', () => {
        expect(leaderboardQuerySchema.parse({})).toEqual({ kind: `all` });
    });

    it('accepts bots and humans and rejects anything else', () => {
        expect(leaderboardQuerySchema.parse({ kind: `bots` }).kind).toBe(`bots`);
        expect(leaderboardQuerySchema.parse({ kind: `humans` }).kind).toBe(`humans`);
        expect(leaderboardQuerySchema.safeParse({ kind: `bot` }).success).toBe(false);
    });
});

describe('leaderboardEntrySchema', () => {
    it('carries whole-point ratings and ranks from one', () => {
        expect(leaderboardEntrySchema.safeParse({ rank: 1, name: `alpha`, kind: `bot`, rating: 1612 }).success).toBe(true);
        expect(leaderboardEntrySchema.safeParse({ rank: 0, name: `alpha`, kind: `bot`, rating: 1612 }).success).toBe(false);
        expect(leaderboardEntrySchema.safeParse({ rank: 1, name: `alpha`, kind: `bot`, rating: 1612.5 }).success).toBe(false);
    });
});
