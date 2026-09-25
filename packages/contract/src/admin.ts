import { z } from 'zod';
import { nameSyntaxSchema } from './names';

// The admin socket speaks one JSON request per connection, ended by a
// newline or by the client closing its side, and answers with one JSON
// line. It is not HTTP, so none of this reaches openapi.yaml.

export const adminRequestLimitBytes = 16 * 1024;

// Game ids are opaque on the public surface; the admin side knows their
// shape so a typo fails parsing instead of reading as an unknown game.
export const adminGameIdSchema = z.string().regex(/^g_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

// Every mutation carries its reason into the audit row.
export const adminReasonSchema = z.string().trim().min(1).max(500);

export const adminRequestSchema = z.discriminatedUnion(`op`, [
    z.strictObject({ op: z.literal(`status`) }),
    z.strictObject({ op: z.literal(`pause`), reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`resume`), reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`ban-user`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`unban-user`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`delete-user`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`delist-bot`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`relist-bot`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    z.strictObject({ op: z.literal(`revoke-bot`), name: nameSyntaxSchema, reason: adminReasonSchema }),
    // One game by id, or every live game of one bot: the shape of a bot
    // gone rogue.
    z
        .strictObject({
            op: z.literal(`abort-game`),
            gameId: adminGameIdSchema.optional(),
            bot: nameSyntaxSchema.optional(),
            reason: adminReasonSchema,
        })
        .refine((request) => (request.gameId === undefined) !== (request.bot === undefined), {
            message: `name exactly one of gameId and bot`,
        }),
    // Each exclusion is a game id or a player name standing for all of that
    // player's games; the two cannot collide, since a game id is longer
    // than any name.
    z.strictObject({
        op: z.literal(`recompute-ratings`),
        exclude: z.array(z.union([adminGameIdSchema, nameSyntaxSchema])).max(100).default([]),
        reason: adminReasonSchema,
    }),
]);
export type AdminRequest = z.infer<typeof adminRequestSchema>;
export type AdminMutation = Exclude<AdminRequest, { op: `status` }>;

export const adminActionSchema = z.object({
    actor: z.string(),
    action: z.string(),
    target: z.string().nullable(),
    reason: z.string(),
    at: z.number().int(),
});
export type AdminAction = z.infer<typeof adminActionSchema>;

export const adminStatusSchema = z.object({
    uptimeSeconds: z.number().int().min(0),
    paused: z.boolean(),
    liveStreams: z.number().int().min(0),
    activeGames: z.number().int().min(0),
    recentActions: z.array(adminActionSchema).max(10),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;

// `unchanged` answers a mutation that would change nothing, which then
// writes no audit row.
export const adminErrorCodes = [`bad_request`, `not_found`, `unchanged`] as const;
export type AdminErrorCode = (typeof adminErrorCodes)[number];

export const adminResponseSchema = z.discriminatedUnion(`kind`, [
    z.object({ kind: z.literal(`status`), status: adminStatusSchema }),
    z.object({ kind: z.literal(`done`), summary: z.string() }),
    z.object({ kind: z.literal(`error`), error: z.string(), code: z.enum(adminErrorCodes) }),
]);
export type AdminResponse = z.infer<typeof adminResponseSchema>;
