import { z } from 'zod';
import {
    defaultOpeningTurns,
    firstPlayerSchema,
    openingTurnsSchema,
    timeControlSchema,
} from './stream';

export const botChallengePath = `/api/bot/challenge/{name}`;
export const challengeAcceptPath = `/api/bot/challenge/{challengeId}/accept`;
export const challengeDeclinePath = `/api/bot/challenge/{challengeId}/decline`;
export const challengeCancelPath = `/api/bot/challenge/{challengeId}/cancel`;

// The idempotency key for challenge creation, scoped to the challenger:
// resending the same id returns the stored challenge with whatever outcome
// it reached, so a retry can never stack a second inbox entry.
export const challengeRequestIdSchema = z.string().min(1).max(128);

export const createChallengeRequestSchema = z.object({
    timeControl: timeControlSchema,
    openingTurns: openingTurnsSchema.default(defaultOpeningTurns),
    firstPlayer: firstPlayerSchema.default(`random`),
    requestId: challengeRequestIdSchema,
});
export type CreateChallengeRequest = z.infer<typeof createChallengeRequestSchema>;

// The challenged side's gates, in the caller's order: presence and the
// open declaration, the declared clock, both sides' concurrent caps, the
// target's inbox bound, then the daily caps.
export const challengeCreateErrorCodes = [
    `not_open`,
    `clock_not_accepted`,
    `bot_busy`,
    `inbox_full`,
    `daily_pair_cap`,
    `daily_bot_cap`,
] as const;

// The challenger's owner also owns the target: an owner cannot farm their
// own bots against each other. A delisted bot neither challenges nor is
// challenged, whichever side it sits on.
export const challengeForbiddenErrorCodes = [`own_bot`, `delisted`] as const;

// Acceptance re-checks the one gate that can have moved since creation.
export const challengeAcceptErrorCodes = [`bot_busy`] as const;
