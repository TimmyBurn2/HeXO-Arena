import { controlOrBidiPattern, discordNameMaxLength, type DiscordNames } from '@hexo-arena/contract';
import { z } from 'zod';

/** A Discord account as the site keeps it: the id, and its names made safe to show. */
export interface DiscordIdentity {
    id: string;
    names: DiscordNames;
}

export interface DiscordOAuth {
    authorizeUrl(state: string): string;
    exchange(code: string): Promise<DiscordIdentity>;
}

export interface DiscordOAuthConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

// The only outbound calls in the process, by construction: these two
// constants are the whole surface behind the egress allowlist.
const authorizeEndpoint = `https://discord.com/oauth2/authorize`;
const tokenEndpoint = `https://discord.com/api/oauth2/token`;
const userEndpoint = `https://discord.com/api/users/@me`;

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });
// The avatar and every other field Discord sends are dropped here, unread.
const identityResponseSchema = z.object({
    id: z.string().min(1).max(32),
    username: z.string().min(1),
    global_name: z.string().nullish(),
});

const unsafe = new RegExp(controlOrBidiPattern.source, `gu`);

/**
 * A Discord name as the site shows it back: NFC, without control or
 * bidirectional characters, and at most {@link discordNameMaxLength}
 * characters; null when nothing is left.
 */
export function discordNameOf(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    const name = Array.from(raw.normalize(`NFC`).replace(unsafe, ``).trim())
        .slice(0, discordNameMaxLength)
        .join(``)
        .trim();
    return name === `` ? null : name;
}

/**
 * The names a Discord account shows; a username with nothing safe left
 * reads as its id, which Discord keeps to digits.
 */
export function discordNamesOf(id: string, username: string, globalName: string | null | undefined): DiscordNames {
    return { username: discordNameOf(username) ?? id.slice(0, discordNameMaxLength), displayName: discordNameOf(globalName) };
}

export class DiscordError extends Error {}

export function createDiscordOAuth(config: DiscordOAuthConfig): DiscordOAuth {
    return {
        authorizeUrl(state: string): string {
            const params = new URLSearchParams({
                client_id: config.clientId,
                response_type: `code`,
                scope: `identify`,
                redirect_uri: config.redirectUri,
                state,
                // An account that allowed the app before skips Discord's screen.
                prompt: `none`,
            });
            return `${authorizeEndpoint}?${params.toString()}`;
        },
        async exchange(code: string): Promise<DiscordIdentity> {
            const body = new URLSearchParams({
                grant_type: `authorization_code`,
                code,
                redirect_uri: config.redirectUri,
                client_id: config.clientId,
                client_secret: config.clientSecret,
            });
            try {
                const tokenResponse = await fetch(tokenEndpoint, {
                    method: `POST`,
                    headers: { 'content-type': `application/x-www-form-urlencoded` },
                    body,
                    signal: AbortSignal.timeout(10_000),
                });
                if (!tokenResponse.ok) throw new DiscordError(`token exchange failed`);
                const token = tokenResponseSchema.parse(await tokenResponse.json());
                const userResponse = await fetch(userEndpoint, {
                    headers: { authorization: `Bearer ${token.access_token}` },
                    signal: AbortSignal.timeout(10_000),
                });
                if (!userResponse.ok) throw new DiscordError(`identity lookup failed`);
                const account = identityResponseSchema.parse(await userResponse.json());
                return { id: account.id, names: discordNamesOf(account.id, account.username, account.global_name) };
            } catch (error) {
                if (error instanceof DiscordError) throw error;
                // A failed zod parse means Discord's shape moved; either way
                // the failure is upstream, not ours.
                throw new DiscordError(`discord oauth failed`, { cause: error });
            }
        },
    };
}
