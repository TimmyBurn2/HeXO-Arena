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
export const streamPlayerSchema = z.object({ name: z.string() });
export type StreamPlayer = z.infer<typeof streamPlayerSchema>;

// Opening variety the server places itself; the unit is a full turn because
// stones come in pairs after the origin stone.
export const openingSchema = z.object({
    randomTurns: z.number().int().min(0).max(3),
});
export type Opening = z.infer<typeof openingSchema>;

export const challengeStatusSchema = z.enum([`created`, `declined`, `canceled`, `expired`]);
export type ChallengeStatus = z.infer<typeof challengeStatusSchema>;

export const challengeSchema = z.object({
    challengeId: z.string(),
    challenger: streamPlayerSchema,
    destUser: streamPlayerSchema,
    timeControl: timeControlSchema,
    status: challengeStatusSchema,
});
export type Challenge = z.infer<typeof challengeSchema>;

export const gameStartEventSchema = z.object({
    type: z.literal(`gameStart`),
    gameId: z.string(),
    side: sideSchema,
    opponent: streamPlayerSchema,
    timeControl: timeControlSchema,
    opening: openingSchema.optional(),
    rated: z.boolean(),
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
