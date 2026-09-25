import { z } from 'zod';
import { htttxMoveRequestSchema, htttxSideSchema } from './htttx';

// One line of the bot event stream, discriminated by `type`; the set of
// kinds is closed, so an unknown discriminator is a hard parse failure.

// Play order in the wire vocabulary: `x` places the opening stone, `o` second.
export const sideSchema = htttxSideSchema;
export type Side = z.infer<typeof sideSchema>;

export const finishReasonSchema = z.enum([
    `aborted`,
    `disconnect`,
    `surrender`,
    `timeout`,
    `terminated`,
    `six-in-a-row`,
]);
export type FinishReason = z.infer<typeof finishReasonSchema>;

// Durations in milliseconds; the floors are contract promises a bot can
// rely on when choosing what to accept.
export const timeControlSchema = z.discriminatedUnion(`mode`, [
    z.object({ mode: z.literal(`unlimited`) }),
    z.object({ mode: z.literal(`turn`), turnTimeMs: z.number().int().min(5_000) }),
    z.object({
        mode: z.literal(`match`),
        mainTimeMs: z.number().int().min(60_000),
        incrementMs: z.number().int().min(0),
    }),
]);
export type TimeControl = z.infer<typeof timeControlSchema>;

// A player in a game or challenge, named by the one global namespace shared
// by users and bots; the name is immutable, so it identifies without an id.
// rating is the current Glicko-2 rating in whole points; provisional holds
// while the deviation is above the leaderboard threshold.
export const streamPlayerSchema = z.object({
    name: z.string(),
    rating: z.number().int(),
    provisional: z.boolean(),
});
export type StreamPlayer = z.infer<typeof streamPlayerSchema>;

// Opening variety the server places itself; the unit is a full turn because
// stones come in pairs after the origin stone.
export const openingSchema = z.object({
    randomTurns: z.number().int().min(0).max(3),
});
export type Opening = z.infer<typeof openingSchema>;

// Server-placed opening variety after the origin stone, in stones: stones
// come two per turn, so an odd count would hand a player a half turn
// nothing can answer. Every request surface speaks stones; gameStart
// carries them as randomTurns.
export const openingStonesSchema = z
    .number()
    .int()
    .min(0)
    .max(6)
    .refine((stones) => stones % 2 === 0, { message: `opening stones must come in pairs` });
export type OpeningStones = z.infer<typeof openingStonesSchema>;

export const defaultOpeningStones = 2;

// Which side takes the first player turn: the origin stone is automatic,
// so the first turn is the first thing a player actually does.
export const firstPlayerSchema = z.enum([`challenger`, `challenged`, `random`]);
export type FirstPlayer = z.infer<typeof firstPlayerSchema>;

export const challengeStatusSchema = z.enum([
    `created`,
    `accepted`,
    `declined`,
    `canceled`,
    `expired`,
]);
export type ChallengeStatus = z.infer<typeof challengeStatusSchema>;

// The whole offer, so the challenged side sees exactly what it accepts:
// clock, opening, and who takes the first turn.
export const challengeSchema = z.object({
    challengeId: z.string(),
    challenger: streamPlayerSchema,
    destUser: streamPlayerSchema,
    timeControl: timeControlSchema,
    openingStones: openingStonesSchema,
    firstPlayer: firstPlayerSchema,
    status: challengeStatusSchema,
});
export type Challenge = z.infer<typeof challengeSchema>;

// The per-game engine-session handoff: socketUrl is origin-relative and
// the token travels as the `token` query parameter on the upgrade. Both
// are short-lived, and every gameStart replay mints a fresh pair, so a
// reconnecting bot reads a new one off its stream.
export const engineSessionSchema = z.object({
    socketUrl: z.string(),
    token: z.string(),
});
export type EngineSession = z.infer<typeof engineSessionSchema>;

export const gameStartEventSchema = z.object({
    type: z.literal(`gameStart`),
    gameId: z.string(),
    side: sideSchema,
    opponent: streamPlayerSchema,
    timeControl: timeControlSchema,
    opening: openingSchema.optional(),
    rated: z.boolean(),
    engine: engineSessionSchema,
});
export type GameStartEvent = z.infer<typeof gameStartEventSchema>;

export const moveRequestEventSchema = z.object({
    type: z.literal(`moveRequest`),
    gameId: z.string(),
    request: htttxMoveRequestSchema,
});
export type MoveRequestEvent = z.infer<typeof moveRequestEventSchema>;

export const gameFinishEventSchema = z.object({
    type: z.literal(`gameFinish`),
    gameId: z.string(),
    // Null when there is no winner: an abort, a termination, or a disconnect
    // that left neither side connected.
    winner: sideSchema.nullable(),
    reason: finishReasonSchema,
});
export type GameFinishEvent = z.infer<typeof gameFinishEventSchema>;

export const challengeCreatedEventSchema = z.object({
    type: z.literal(`challenge`),
    challenge: challengeSchema,
});

// A withdrawal reaches the target, a decline the challenger, an expiry both.
export const challengeCanceledEventSchema = z.object({
    type: z.literal(`challengeCanceled`),
    reason: z.enum([`canceled`, `expired`]),
    challenge: challengeSchema,
});

export const challengeDeclinedEventSchema = z.object({
    type: z.literal(`challengeDeclined`),
    challenge: challengeSchema,
});

export const challengeEventSchema = z.discriminatedUnion(`type`, [
    challengeCreatedEventSchema,
    challengeCanceledEventSchema,
    challengeDeclinedEventSchema,
]);
export type ChallengeEvent = z.infer<typeof challengeEventSchema>;

// Flat and closed: the challenge variants are members like the rest, so the
// discriminator resolves every line in one step.
export const streamEventSchema = z.discriminatedUnion(`type`, [
    gameStartEventSchema,
    moveRequestEventSchema,
    gameFinishEventSchema,
    challengeCreatedEventSchema,
    challengeCanceledEventSchema,
    challengeDeclinedEventSchema,
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;
