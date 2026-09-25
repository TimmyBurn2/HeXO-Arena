import { z } from 'zod';
import { nameSyntaxSchema } from './names';

export const discordLoginPath = `/api/auth/discord/login`;
export const discordCallbackPath = `/api/auth/discord/callback`;
export const devLoginPath = `/api/dev/login`;
export const logoutPath = `/api/auth/logout`;
export const guestPath = `/api/auth/guest`;
export const mePath = `/api/me`;
export const botsPath = `/api/bots`;
export const botPath = `/api/bots/{name}`;
export const botTokenPath = `/api/bots/{name}/token`;
export const botStreamPath = `/api/bot/stream`;
export const botAccountPath = `/api/bot/account`;

export const sessionCookieName = `hexarena_session`;

// A guest's name is a display label, `Guest ` plus four characters; the
// space keeps it outside the name syntax, so it never collides with an
// account.
export const guestLabelPattern = /^Guest [a-z0-9]{4}$/;

export const guestMeSchema = z.object({
    kind: z.literal(`guest`),
    name: z.string().regex(guestLabelPattern),
});
export type GuestMe = z.infer<typeof guestMeSchema>;

// Who the session cookie names: a user by their global name, an anonymous
// guest by its label, or no one.
export const meSchema = z
    .discriminatedUnion(`kind`, [z.object({ kind: z.literal(`user`), name: z.string() }), guestMeSchema])
    .nullable();
export type Me = z.infer<typeof meSchema>;

// A signed-in user keeps their account; guest minting never replaces it.
export const guestConflictErrorCodes = [`signed_in`] as const;

// Guest sessions live in memory under one global cap; minting past it
// answers 429 with this Retry-After.
export const guestLimitErrorCodes = [`guest_limit`] as const;
export const guestRetryAfterSeconds = 60;

export const createBotRequestSchema = z.object({ name: nameSyntaxSchema });
export const devLoginRequestSchema = z.object({ name: nameSyntaxSchema });

// The literal `1` is the only legal value; absence means false.
export const botStreamQuerySchema = z.object({ open: z.literal(`1`).optional() });
export const botDirectoryQuerySchema = z.object({ online: z.literal(`1`).optional() });

// 32 random bytes in base64url behind the hxo_ prefix.
export const botTokenPattern = /^hxo_[A-Za-z0-9_-]{43}$/;

export const botWithTokenSchema = z.object({
    name: z.string(),
    token: z.string().regex(botTokenPattern),
});

export const botAboutSchema = z.string().max(280);

// Capped explicitly instead of leaning on the request body limit.
export const botVersionSchema = z.string().max(64);

// Link to the bot's source, http(s) only; the empty string clears it.
export const botRepoUrlSchema = z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .or(z.literal(``));

// What a bot will play under, declared by the bot itself; `turnMs` is the
// accepted turn-clock window [min, max] in milliseconds or null to decline
// turn clocks entirely. A window below the 5 s floor never matches a legal
// clock, so it is accepted as declared rather than rejected.
export const acceptsSchema = z.object({
    turnMs: z
        .array(z.number().int())
        .min(2)
        .max(2)
        .nullable()
        .refine((window) => window === null || (window[0] ?? 0) <= (window[1] ?? 0), {
            message: `turnMs min must not exceed max`,
        }),
    match: z.boolean(),
    unlimited: z.boolean(),
});
export type Accepts = z.infer<typeof acceptsSchema>;

// ownerName is nullable because a hidden-owner state is reserved; today
// every listed bot carries its owner's name.
// online and openForChallenges are live views of who holds a stream open;
// the declaration fields are absent until the bot declares itself.
// rating is the Glicko-2 rating rounded to a whole point; provisional holds
// while the deviation is above the leaderboard threshold.
export const botListingSchema = z.object({
    name: z.string(),
    ownerName: z.string().nullable(),
    online: z.boolean(),
    openForChallenges: z.boolean(),
    rating: z.number().int(),
    provisional: z.boolean(),
    about: botAboutSchema.optional(),
    version: botVersionSchema.optional(),
    repoUrl: botRepoUrlSchema.optional(),
    accepts: acceptsSchema.optional(),
});
export type BotListing = z.infer<typeof botListingSchema>;

// The Hexo-Bot-Api error shape: `error` is human-readable prose, `code` is
// the stable machine-readable half that callers branch on.
export const botCreateErrorCodes = [
    `unauthorized`,
    `invalid_name`,
    `name_reserved`,
    `bot_limit`,
    `name_taken`,
] as const;

// The self-declaration the token-holding process sends; every field
// optional, each present field replacing the stored one. Strict, so a
// typo'd key answers 400 instead of silently declaring nothing.
export const accountDeclarationSchema = z.strictObject({
    about: botAboutSchema.optional(),
    version: botVersionSchema.optional(),
    repoUrl: botRepoUrlSchema.optional(),
    accepts: acceptsSchema.optional(),
});
export type AccountDeclaration = z.infer<typeof accountDeclarationSchema>;

// The bot's own view of itself: identity and rating as the directory
// shows them, plus the stored declaration.
export const botAccountSchema = z.object({
    name: z.string(),
    rating: z.number().int(),
    provisional: z.boolean(),
    about: botAboutSchema.optional(),
    version: botVersionSchema.optional(),
    repoUrl: botRepoUrlSchema.optional(),
    accepts: acceptsSchema.optional(),
});
export type BotAccount = z.infer<typeof botAccountSchema>;

export const unauthorizedErrorCodes = [`unauthorized`] as const;
export const notFoundErrorCodes = [`not_found`] as const;
export const devLoginErrorCodes = [`invalid_name`, `name_reserved`, `name_taken`] as const;
export const badRequestErrorCodes = [`bad_request`] as const;
export const botForbiddenErrorCodes = [`banned`] as const;

// A bot seated in a live game cannot be deleted: deletion would end the
// game, and ending it unrated would be an escape from a losing position.
export const botDeleteConflictErrorCodes = [`in_game`] as const;

// While the site is paused, whatever would start something new answers 503
// with this Retry-After; streams already open and games already live run
// on untouched.
export const pausedErrorCodes = [`paused`] as const;
export const pausedRetryAfterSeconds = 60;

// The acceptance body of actions that have nothing to report beyond that.
export const okSchema = z.object({ ok: z.literal(true) });

export function errorBodySchema(codes: readonly [string, ...string[]]) {
    return z.object({ error: z.string(), code: z.enum(codes) });
}
