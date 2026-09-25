import { z } from 'zod';

export interface DiscordIdentity {
    id: string;
    username: string;
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
// constants are the whole surface behind the egress allowlist (SPEC.md
// section 9).
const authorizeEndpoint = `https://discord.com/oauth2/authorize`;
const tokenEndpoint = `https://discord.com/api/oauth2/token`;
const userEndpoint = `https://discord.com/api/users/@me`;

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });
const identityResponseSchema = z.object({
    id: z.string().min(1),
    username: z.string().min(1),
});

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
                return identityResponseSchema.parse(await userResponse.json());
            } catch (error) {
                if (error instanceof DiscordError) throw error;
                // A failed zod parse means Discord's shape moved; either way
                // the failure is upstream, not ours.
                throw new DiscordError(`discord oauth failed`, { cause: error });
            }
        },
    };
}
