import { describe, expect, it } from 'vitest';
import {
    botChallengePath,
    challengeAcceptPath,
    challengeCancelPath,
    challengeDeclinePath,
    createChallengeRequestSchema,
} from '../src/challenge';

const turnControl = { mode: `turn` as const, turnTimeMs: 30_000 };

describe('createChallengeRequestSchema', () => {
    it('fills in the default opening and first player when none is asked for', () => {
        const parsed = createChallengeRequestSchema.parse({
            timeControl: turnControl,
            requestId: `retry-1`,
        });
        expect(parsed.openingStones).toBe(2);
        expect(parsed.firstPlayer).toBe(`random`);
    });

    it('keeps the time-control floors from the stream contract', () => {
        expect(
            createChallengeRequestSchema.safeParse({
                timeControl: { mode: `turn`, turnTimeMs: 4_999 },
                requestId: `retry-1`,
            }).success,
        ).toBe(false);
    });

    it('rejects an odd opening count and a missing request id', () => {
        expect(
            createChallengeRequestSchema.safeParse({
                timeControl: turnControl,
                openingStones: 3,
                requestId: `retry-1`,
            }).success,
        ).toBe(false);
        expect(
            createChallengeRequestSchema.safeParse({
                timeControl: turnControl,
            }).success,
        ).toBe(false);
        expect(
            createChallengeRequestSchema.safeParse({
                timeControl: turnControl,
                requestId: ``,
            }).success,
        ).toBe(false);
    });
});

describe('challenge paths', () => {
    it('names the target by its global name and actions by challenge id', () => {
        expect(botChallengePath).toBe(`/api/bot/challenge/{name}`);
        expect(challengeAcceptPath).toBe(`/api/bot/challenge/{challengeId}/accept`);
        expect(challengeDeclinePath).toBe(`/api/bot/challenge/{challengeId}/decline`);
        expect(challengeCancelPath).toBe(`/api/bot/challenge/{challengeId}/cancel`);
    });
});
