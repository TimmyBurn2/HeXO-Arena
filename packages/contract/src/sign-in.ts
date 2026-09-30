import { z } from 'zod';
import { nameSyntaxSchema } from './names';

export const discordLoginPath = `/api/auth/discord/login`;
export const discordCallbackPath = `/api/auth/discord/callback`;

/** Where a first sign-in continues: the page that asks for the public name. */
export const welcomePath = `/welcome`;

/** The query parameter that names where a sign-in returns. */
export const nextParam = `next`;

/** The longest return path a sign-in carries. */
export const nextPathMaxLength = 256;

// The pages a sign-in may return to, by first path segment, the root's
// empty; the welcome page and the API are never among them.
const returnPages: readonly string[] = [``, `play`, `ladder`, `bots`, `connect`, `profile`, `credits`, `legal`, `game`];

// A path and its query in characters a URL carries unescaped; no fragment,
// since a browser never sends one, and no backslash, which browsers read
// as a slash.
const nextPathPattern = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/?]*$/;

/**
 * Where a sign-in returns: a path on this site with its query, one leading
 * slash and never two in a row, so no browser reads it as another host, at
 * most {@link nextPathMaxLength} characters, on a page the site serves.
 */
export const nextPathSchema = z
    .string()
    .max(nextPathMaxLength)
    .regex(nextPathPattern)
    .refine((path) => !path.includes(`//`), { message: `a return path never holds two slashes in a row` })
    .refine((path) => returnPages.includes(path.slice(1).split(/[/?]/u)[0] ?? ``), { message: `a return path names a page of the site` })
    .meta({
        id: `NextPath`,
        description: `A path on this site, with its query, where a sign-in returns.`,
    });

/** A return path as sent, or the site's root when it is missing or not one. */
export function nextPathOf(value: unknown): string {
    const parsed = nextPathSchema.safeParse(value);
    return parsed.success ? parsed.data : `/`;
}

/** The Discord sign-in that returns to `next`. */
export function discordLoginHref(next: string): string {
    return `${discordLoginPath}?${new URLSearchParams({ [nextParam]: next }).toString()}`;
}

/**
 * Why a Discord sign-in did not finish, carried back to the page it
 * started from in the query parameter {@link signInFailureParam}: Discord
 * OAuth is not set up, the visitor cancelled at Discord, the state is
 * unknown, expired, or used, Discord refused or failed the sign-in, or the
 * account is banned.
 */
export const signInFailureSchema = z
    .enum([`unconfigured`, `cancelled`, `expired`, `rejected`, `banned`, `busy`])
    .meta({ id: `SignInFailure`, description: `Why a Discord sign-in did not finish.` });
export type SignInFailure = z.infer<typeof signInFailureSchema>;

/** The query parameter that names a failed sign-in's reason. */
export const signInFailureParam = `signin`;

/** Where a failed sign-in lands: the page it started from, naming the reason. */
export function signInFailurePath(reason: SignInFailure, next = `/`): string {
    const at = next.indexOf(`?`);
    const params = new URLSearchParams(at === -1 ? `` : next.slice(at + 1));
    params.set(signInFailureParam, reason);
    return `${at === -1 ? next : next.slice(0, at)}?${params.toString()}`;
}

/** The first sign-in's unfinished account: read it, create it, or drop it. */
export const signupPath = `/api/signup`;

/** The cookie that holds a first sign-in until the account is created. */
export const signupCookieName = `hexo_arena_signup`;

/** How long a first sign-in waits for its public name, and its cookie with it. */
export const signupMaxAgeSeconds = 15 * 60;

/** The most names one first sign-in may try; past it, the sign-up ends. */
export const signupAttemptCap = 10;

/** The longest Discord username or display name the site keeps. */
export const discordNameMaxLength = 32;

const discordName = z.string().min(1).max(discordNameMaxLength);

/**
 * The Discord account behind a session, as its owner reads it: the
 * username, and the display name when the account has one.
 */
export const discordNamesSchema = z
    .object({
        username: discordName,
        displayName: discordName.nullable(),
    })
    .meta({ id: `DiscordNames`, description: `The Discord account behind a session, shown only to its owner.` });
export type DiscordNames = z.infer<typeof discordNamesSchema>;

/**
 * A first sign-in waiting for its public name: the Discord account it
 * came from, a free name made from the username, and where it returns.
 */
export const signupSchema = z
    .object({
        discord: discordNamesSchema,
        suggestedName: nameSyntaxSchema,
        next: nextPathSchema,
    })
    .meta({ id: `Signup` });
export type Signup = z.infer<typeof signupSchema>;

export const signupRequestSchema = z.object({ name: nameSyntaxSchema }).meta({ id: `SignupRequest` });
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const signupCreatedSchema = z.object({ name: z.string() }).meta({ id: `SignupCreated` });

// A name that fails the syntax or is reserved, then one another player
// holds; a sign-up that is gone, or that tried too many names.
export const signupNameErrorCodes = [`invalid_name`, `name_reserved`] as const;
export const signupTakenErrorCodes = [`name_taken`] as const;
export const signupExpiredErrorCodes = [`signup_expired`] as const;
export const signupLimitErrorCodes = [`signup_limit`] as const;
