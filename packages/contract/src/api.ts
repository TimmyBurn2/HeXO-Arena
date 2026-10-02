import { z } from 'zod';
import { analysisLeftSchema, analyzerDeclarationSchema, analyzerSchema } from './analysis';
import { botConcurrentGameCap, humanConcurrentGameCap, liveGameEntrySchema } from './games';
import { provisionalSchema, ratingSchema } from './leaderboard';
import { levelsSchema } from './levels';
import { cleanText, nameSyntaxSchema } from './names';
import { discordNamesSchema, nextPathSchema } from './sign-in';

export const devLoginPath = `/api/dev/login`;
export const logoutPath = `/api/auth/logout`;
export const guestPath = `/api/auth/guest`;
export const mePath = `/api/me`;
export const botsPath = `/api/bots`;
export const botPath = `/api/bots/{name}`;
export const botTokenPath = `/api/bots/{name}/token`;
export const botStreamPath = `/api/bot/stream`;
export const botAccountPath = `/api/bot/account`;

/** The session cookie where the site runs without TLS, as in development. */
export const sessionCookieName = `hexo_arena_session`;

/**
 * The session cookie over TLS: with the prefix, a browser refuses one a
 * sibling subdomain sets, so no other site under the domain can plant a session.
 */
export const secureSessionCookieName = `__Host-${sessionCookieName}`;

/** The session cookie's name where cookies carry Secure, or where they do not. */
export function sessionCookieNameFor(secure: boolean): string {
    return secure ? secureSessionCookieName : sessionCookieName;
}

/** How long an account's session, and its cookie, last after sign-in. */
export const sessionMaxAgeSeconds = 30 * 24 * 60 * 60;

// The stream writes a bare newline this often, so a quiet stream still
// proves itself alive.
export const streamKeepaliveMs = 10_000;

// A guest's name is a display label, `Guest ` plus four characters; the
// space keeps it outside the name syntax, so it never collides with an
// account.
export const guestLabelPattern = /^Guest [a-z0-9]{4}$/;

// The person's own live games, so a page can lead back to them; the
// live-game cap bounds how many there are.
const ownLiveGamesSchema = z
    .array(liveGameEntrySchema)
    .max(humanConcurrentGameCap)
    .meta({ id: `OwnLiveGames`, description: `The person's live games, newest first.` });

export const guestMeSchema = z
    .object({
        kind: z.literal(`guest`),
        name: z.string().regex(guestLabelPattern),
        liveGames: ownLiveGamesSchema,
    })
    .meta({ id: `Guest` });
export type GuestMe = z.infer<typeof guestMeSchema>;

// Who the session cookie names: a user by their global name with their
// current rating and the Discord account they signed in with, which only
// this read carries; an anonymous guest by its label (guests are never
// rated); or no one. Either person carries their own live games.
export const userMeSchema = z
    .object({
        kind: z.literal(`user`),
        name: z.string(),
        rating: ratingSchema,
        provisional: provisionalSchema,
        discord: discordNamesSchema.nullable(),
        liveGames: ownLiveGamesSchema,
        analysisOptOut: z.boolean().meta({ description: `True when the user asked that their games stay out of public analysis.` }),
        analysisLeft: analysisLeftSchema,
    })
    .meta({ id: `User`, description: `discord is null for a session made without Discord.` });
export type UserMe = z.infer<typeof userMeSchema>;

// The settings a user changes on their own account, each present field
// replacing the stored one.
export const meUpdateRequestSchema = z
    .strictObject({
        analysisOptOut: z
            .boolean()
            .optional()
            .meta({ description: `True deletes the community readings of every game the user played and hides the bots' own views of them; false lets new requests in.` }),
    })
    .meta({ id: `MeUpdate` });
export type MeUpdateRequest = z.infer<typeof meUpdateRequestSchema>;

export const meSchema = z.discriminatedUnion(`kind`, [userMeSchema, guestMeSchema]).nullable();
export type Me = z.infer<typeof meSchema>;

// A signed-in user keeps their account; guest minting never replaces it.
export const guestConflictErrorCodes = [`signed_in`] as const;

// Guest sessions live in memory under one global cap; minting past it
// answers 429 with this Retry-After.
export const guestLimitErrorCodes = [`guest_limit`] as const;
export const guestRetryAfterSeconds = 60;

// A guest session this long without a request ends, unless it sits in a
// live game.
export const guestIdleSeconds = 24 * 60 * 60;

// Bots one account may hold at once; creating past it answers bot_limit.
export const botCapPerUser = 3;

export const createBotRequestSchema = z.object({ name: nameSyntaxSchema });

// The dev login signs a chosen name in at once, or, given a Discord account
// instead, returns as a Discord sign-in does: a known account is signed in
// and sent to `next`, an unknown one sent on to choose its name.
export const devLoginRequestSchema = z.union([
    z.object({ name: nameSyntaxSchema }),
    z.object({ discord: discordNamesSchema, next: nextPathSchema.optional() }),
]);
export type DevLoginRequest = z.infer<typeof devLoginRequestSchema>;

// The literal `1` is the only legal value; absence means false.
export const botStreamQuerySchema = z.object({ open: z.literal(`1`).optional() });
export const botDirectoryQuerySchema = z.object({ online: z.literal(`1`).optional(), analyzer: z.literal(`1`).optional() });

// 32 random bytes in base64url behind the hxo_ prefix.
export const botTokenPattern = /^hxo_[A-Za-z0-9_-]{43}$/;

export const botWithTokenSchema = z
    .object({
        name: z.string(),
        token: z.string().regex(botTokenPattern),
    })
    .meta({ id: `BotToken` });

export const botAboutSchema = z.string().max(280);

// Capped explicitly instead of leaning on the request body limit.
export const botVersionSchema = z.string().max(64);

// Link to the bot's source, http(s) only; the empty string clears it.
export const botRepoUrlSchema = z
    .url({ protocol: /^https?$/ })
    .max(2048)
    .or(z.literal(``));

// What a bot will play under, declared by the bot itself.
// A turn window below the 5 s floor never matches a legal clock, so it is
// accepted as declared rather than rejected.
export const acceptsSchema = z
    .object({
        turnMs: z
            .array(z.number().int())
            .min(2)
            .max(2)
            .nullable()
            .refine((window) => window === null || (window[0] ?? 0) <= (window[1] ?? 0), {
                message: `turnMs min must not exceed max`,
            })
            .meta({ description: `The turn clocks the bot plays, as the inclusive [min, max] of turnTimeMs; null refuses turn clocks.` }),
        match: z.boolean().meta({ description: `True to play any match clock.` }),
        unlimited: z.boolean().meta({ description: `True to play games with no clock.` }),
    })
    .meta({ id: `Accepts`, description: `The clocks the bot plays; a bot that never declared accepts plays none.` });
export type Accepts = z.infer<typeof acceptsSchema>;

// ownerName is nullable because a hidden-owner state is reserved; today
// every listed bot carries its owner's name.
export const botListingSchema = z
    .object({
        name: z.string(),
        ownerName: z.string().nullable(),
        online: z.boolean().meta({ description: `True while the bot holds its stream open.` }),
        openForChallenges: z.boolean().meta({ description: `True while the bot holds its stream open with open=1.` }),
        rating: ratingSchema,
        provisional: provisionalSchema,
        liveGames: z
            .number()
            .int()
            .min(0)
            .max(botConcurrentGameCap)
            .meta({ description: `The games the bot is playing now; at ${String(botConcurrentGameCap)} it takes no new one.` }),
        about: botAboutSchema.optional(),
        version: botVersionSchema.optional(),
        repoUrl: botRepoUrlSchema.optional(),
        accepts: acceptsSchema.optional(),
        levels: levelsSchema.nullable(),
        analyzer: analyzerSchema.nullable(),
    })
    .meta({ id: `BotListing`, description: `The declaration fields are absent until the bot declares them, and levels and analyzer are null.` });
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

// A declaration is shown on the bot's pages, so its text is cleaned rather
// than refused: a bot written against an earlier contract keeps declaring,
// and nothing that hides or reorders the text around it is ever stored.
// The cap counts the cleaned text.
const cleanedTo = (capped: z.ZodString) => z.string().transform(cleanText).pipe(capped);

// The self-declaration the token-holding process sends; every field
// optional, each present field replacing the stored one. Strict, so a
// typo'd key answers 400 instead of silently declaring nothing.
export const accountDeclarationSchema = z
    .strictObject({
        about: cleanedTo(botAboutSchema).optional().meta({ description: `At most 280 characters once cleaned; empty clears it.` }),
        version: cleanedTo(botVersionSchema).optional().meta({ description: `At most 64 characters once cleaned; empty clears it.` }),
        repoUrl: botRepoUrlSchema.optional(),
        accepts: acceptsSchema.optional(),
        levels: levelsSchema.nullable().optional(),
        analyzer: analyzerDeclarationSchema.nullable().optional(),
    })
    .meta({
        id: `AccountDeclaration`,
        description: [
            `Text is cleaned, never refused for what it holds: a line break or tab becomes a space, other control and format characters (bidirectional marks, zero-width characters, soft hyphens) are dropped, whitespace runs collapse, and the ends are trimmed.`,
            `A level's about and note are cleaned the same way.`,
        ].join(` `),
    });
export type AccountDeclaration = z.infer<typeof accountDeclarationSchema>;

// The bot's own view of itself: identity and rating as the directory
// shows them, plus the stored declaration.
export const botAccountSchema = z
    .object({
        name: z.string(),
        rating: ratingSchema,
        provisional: provisionalSchema,
        about: botAboutSchema.optional(),
        version: botVersionSchema.optional(),
        repoUrl: botRepoUrlSchema.optional(),
        accepts: acceptsSchema.optional(),
        levels: levelsSchema.nullable(),
        analyzer: analyzerSchema.nullable(),
    })
    .meta({ id: `Account`, description: `levels and analyzer are null until the bot declares them.` });
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
export const okSchema = z.object({ ok: z.literal(true) }).meta({ id: `Ok` });

export function errorBodySchema(codes: readonly [string, ...string[]]) {
    return z.object({ error: z.string(), code: z.enum(codes) });
}
