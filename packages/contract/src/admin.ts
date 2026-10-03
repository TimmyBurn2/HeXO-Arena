import { z } from 'zod';
import { analysisIdSchema } from './analysis';
import { botClientSchema } from './api';
import { scheduledClockSchema } from './games';
import { nameSyntaxSchema } from './names';
import { reportReasonSchema } from './reports';
import { duelIdSchema } from './duels';
import { openingPliesSchema } from './stream';
import {
    adminTournamentRuleSchema,
    adminTournamentSchema,
    defaultTournamentOpening,
    tournamentDaysAhead,
    tournamentIdSchema,
    tournamentMaxEntrants,
    tournamentMinPresent,
    tournamentNamePatternSchema,
    tournamentNameSchema,
    tournamentRuleIdSchema,
    tournamentTimeOfDaySchema,
    tournamentWeekdaySchema,
} from './tournaments';

// The admin socket speaks one JSON request per connection, ended by a
// newline or by the client closing its side, and answers with one JSON
// line. It is not HTTP, so none of this reaches openapi.yaml.

export const adminRequestLimitBytes = 16 * 1024;

// Game ids are opaque on the public surface; the admin side knows their
// shape so a typo fails parsing instead of reading as an unknown game.
export const adminGameIdSchema = z.string().regex(/^g_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

// Every mutation carries its reason into the audit row.
export const adminReasonSchema = z.string().trim().min(1).max(500);

const tournamentEntrantsSchema = z.number().int().min(tournamentMinPresent).max(tournamentMaxEntrants);

/**
 * What a backup taken on demand is for, such as `pre-update`: it names the
 * file, so it stays short and safe in a file name.
 */
export const adminBackupLabelSchema = z
    .string()
    .max(32)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const adminRequestSchema = z.discriminatedUnion(`op`, [
    z.strictObject({ op: z.literal(`status`) }),
    // A labelled backup is kept apart from the nightly ones, which never
    // replace it.
    z.strictObject({ op: z.literal(`backup`), label: adminBackupLabelSchema.optional() }),
    z.strictObject({ op: z.literal(`bot`), name: nameSyntaxSchema }),
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
    z.strictObject({
        op: z.literal(`tournament-create`),
        name: tournamentNameSchema,
        startsAt: z.iso.datetime({ offset: true }),
        timeControl: scheduledClockSchema,
        openingPlies: openingPliesSchema.default(defaultTournamentOpening),
        maxEntrants: tournamentEntrantsSchema.default(tournamentMaxEntrants),
        reason: adminReasonSchema,
    }),
    z.strictObject({ op: z.literal(`tournament-cancel`), id: tournamentIdSchema, reason: adminReasonSchema }),
    z.strictObject({
        op: z.literal(`tournament-schedule-add`),
        weekday: tournamentWeekdaySchema,
        time: tournamentTimeOfDaySchema,
        namePattern: tournamentNamePatternSchema,
        timeControl: scheduledClockSchema,
        openingPlies: openingPliesSchema.default(defaultTournamentOpening),
        maxEntrants: tournamentEntrantsSchema.default(tournamentMaxEntrants),
        daysAhead: z.number().int().min(tournamentDaysAhead.min).max(tournamentDaysAhead.max).default(tournamentDaysAhead.default),
        reason: adminReasonSchema,
    }),
    z.strictObject({ op: z.literal(`tournament-schedule-list`) }),
    z.strictObject({ op: z.literal(`tournament-schedule-remove`), id: tournamentRuleIdSchema, reason: adminReasonSchema }),
    // The reason is the closing note the report keeps.
    z.strictObject({ op: z.literal(`report-close`), id: z.number().int().min(1), reason: adminReasonSchema }),
    // A reading that lies or misleads goes, with its lines; the audit row keeps why.
    z.strictObject({ op: z.literal(`delete-analysis`), id: analysisIdSchema, reason: adminReasonSchema }),
    // No further game of the duel starts; a live one plays on.
    z.strictObject({ op: z.literal(`duel-stop`), id: duelIdSchema, reason: adminReasonSchema }),
]);
export type AdminRequest = z.infer<typeof adminRequestSchema>;
export type AdminMutation = Exclude<AdminRequest, { op: `status` | `backup` | `bot` | `tournament-schedule-list` }>;

export const adminActionSchema = z.object({
    actor: z.string(),
    action: z.string(),
    target: z.string().nullable(),
    reason: z.string(),
    at: z.number().int(),
});
export type AdminAction = z.infer<typeof adminActionSchema>;

/** Open reports the status shows, the oldest first. */
export const adminOpenReportsShown = 20;

export const adminReportSchema = z.object({
    id: z.number().int().min(1),
    subject: z.string(),
    reason: reportReasonSchema,
    details: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    at: z.number().int(),
});
export type AdminReport = z.infer<typeof adminReportSchema>;

/** The census counts the bots whose stream opened within this many days. */
export const clientCensusDays = 14;

export const adminClientCountSchema = z.object({
    // hexo-bridge/<release>, or other.
    client: z.string(),
    bots: z.number().int().min(1),
});
export type AdminClientCount = z.infer<typeof adminClientCountSchema>;

// One bot as the operator looks it up: its owner, presence, and the client
// it last connected with, which only the owner and the operator see.
export const adminBotSchema = z.object({
    name: z.string(),
    owner: z.string(),
    online: z.boolean(),
    open: z.boolean(),
    liveGames: z.number().int().min(0),
    delisted: z.boolean(),
    version: z.string().nullable(),
    client: botClientSchema.nullable(),
    clientAt: z.number().int().nullable(),
});
export type AdminBot = z.infer<typeof adminBotSchema>;

export const adminStatusSchema = z.object({
    uptimeSeconds: z.number().int().min(0),
    paused: z.boolean(),
    liveStreams: z.number().int().min(0),
    activeGames: z.number().int().min(0),
    // Client keys the rate limits hold, and requests since start that carried no public address:
    // after a deploy, visits from two networks should make two keys,
    // or the forwarded address is not reaching the app.
    clientKeys: z.number().int().min(0),
    keylessRequests: z.number().int().min(0),
    tournaments: z.array(adminTournamentSchema),
    tournamentRules: z.array(adminTournamentRuleSchema),
    liveDuels: z.number().int().min(0),
    clients: z.array(adminClientCountSchema),
    recentActions: z.array(adminActionSchema).max(10),
    openReportCount: z.number().int().min(0),
    openReports: z.array(adminReportSchema).max(adminOpenReportsShown),
});
export type AdminStatus = z.infer<typeof adminStatusSchema>;

// `unchanged` answers a mutation that would change nothing, which then
// writes no audit row.
export const adminErrorCodes = [`bad_request`, `not_found`, `unchanged`] as const;
export type AdminErrorCode = (typeof adminErrorCodes)[number];

export const adminResponseSchema = z.discriminatedUnion(`kind`, [
    z.object({ kind: z.literal(`status`), status: adminStatusSchema }),
    z.object({ kind: z.literal(`bot`), bot: adminBotSchema }),
    z.object({ kind: z.literal(`tournament-rules`), rules: z.array(adminTournamentRuleSchema) }),
    z.object({ kind: z.literal(`done`), summary: z.string() }),
    z.object({ kind: z.literal(`error`), error: z.string(), code: z.enum(adminErrorCodes) }),
]);
export type AdminResponse = z.infer<typeof adminResponseSchema>;
