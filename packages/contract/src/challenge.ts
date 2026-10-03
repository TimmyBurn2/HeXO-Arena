import { z } from 'zod';
import {
    firstPlayerSchema,
    openingPliesRequestSchema,
    timeControlSchema,
} from './stream';

export const botChallengePath = `/api/bot/challenge/{name}`;
export const challengeAcceptPath = `/api/bot/challenge/{challengeId}/accept`;
export const challengeDeclinePath = `/api/bot/challenge/{challengeId}/decline`;
export const challengeCancelPath = `/api/bot/challenge/{challengeId}/cancel`;

// A pending challenge expires after this; the target's inbox holds at most
// the cap, and the daily caps count games per UTC day: the pair cap a
// pair's, two bots or a signed-in human and a bot, the bot cap a bot's
// bot-vs-bot games.
export const challengeTtlMs = 60_000;
export const challengeInboxCap = 10;
export const pairDailyCap = 20;
export const botDailyCap = 100;

// The idempotency key for challenge creation, scoped to the challenger:
// resending the same id returns the stored challenge with whatever outcome
// it reached, so a retry can never stack a second inbox entry.
export const challengeRequestIdSchema = z.string().min(1).max(128);

export const createChallengeRequestSchema = z.object({
    timeControl: timeControlSchema,
    openingPlies: openingPliesRequestSchema,
    firstPlayer: firstPlayerSchema.default(`random`),
    requestId: challengeRequestIdSchema,
});
export type CreateChallengeRequest = z.infer<typeof createChallengeRequestSchema>;

// The challenged side's gates, in the caller's order: presence and the
// open declaration, the declared clock, both sides' concurrent caps, the
// target's inbox bound, and a challenge already pending between the pair.
export const challengeCreateErrorCodes = [
    `not_open`,
    `clock_not_accepted`,
    `bot_busy`,
    `inbox_full`,
    `challenge_pending`,
] as const;

// The daily caps, which the UTC day's turn lifts, so they answer 429 with the wait.
export const challengeQuotaErrorCodes = [`daily_challenge_cap`, `daily_pair_cap`, `daily_bot_cap`] as const;

// A delisted bot neither challenges nor is challenged, whichever side it
// sits on. own_bot is never sent, since two bots of one owner play unrated,
// and stays listed until a major version may drop it.
export const challengeForbiddenErrorCodes = [`own_bot`, `delisted`] as const;

// Acceptance re-checks the one gate that can have moved since creation.
export const challengeAcceptErrorCodes = [`bot_busy`] as const;
