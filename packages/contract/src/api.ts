import { z } from 'zod';
import { nameSyntaxSchema } from './names';

export const discordLoginPath = `/api/auth/discord/login`;
export const discordCallbackPath = `/api/auth/discord/callback`;
export const devLoginPath = `/api/dev/login`;
export const botsPath = `/api/bots`;
export const botPath = `/api/bots/{name}`;
export const botTokenPath = `/api/bots/{name}/token`;

export const sessionCookieName = `hexarena_session`;

export const createBotRequestSchema = z.object({ name: nameSyntaxSchema });
export const devLoginRequestSchema = z.object({ name: nameSyntaxSchema });

// 32 random bytes in base64url behind the hxo_ prefix (SPEC.md section 5).
export const botTokenPattern = /^hxo_[A-Za-z0-9_-]{43}$/;

export const botWithTokenSchema = z.object({
    name: z.string(),
    token: z.string().regex(botTokenPattern),
});

// ownerName is nullable because the spec reserves a hidden-owner state;
// today every listed bot carries its owner's name (SPEC.md section 7.3).
export const botListingSchema = z.object({
    name: z.string(),
    ownerName: z.string().nullable(),
});

// The Hexo-Bot-Api error shape: `error` is human-readable prose, `code` is
// the stable machine-readable half that callers branch on.
export const botCreateErrorCodes = [
    `unauthorized`,
    `invalid_name`,
    `name_reserved`,
    `bot_limit`,
    `name_taken`,
] as const;

export const unauthorizedErrorCodes = [`unauthorized`] as const;
export const notFoundErrorCodes = [`not_found`] as const;
export const devLoginErrorCodes = [`invalid_name`, `name_reserved`, `name_taken`] as const;

export function errorBodySchema(codes: readonly [string, ...string[]]) {
    return z.object({ error: z.string(), code: z.enum(codes) });
}
