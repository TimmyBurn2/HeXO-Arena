import {
    botAccountPath,
    botChallengePath,
    botStreamPath,
    botTokenPath,
    botWithTokenSchema,
    botsPath,
    challengeAcceptPath,
    devLoginPath,
    sessionCookieName,
    streamEventSchema,
    type Accepts,
    type StreamEvent,
    type TimeControl,
} from '@hexo-arena/contract';
import { z } from 'zod';

const errorCodeSchema = z.object({ code: z.string() });

/**
 * A call the target refused, with the contract error code when the body named one,
 * and the seconds to wait when the answer named them.
 */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null,
        readonly retryAfter: number | null,
        message: string,
    ) {
        super(message);
    }
}

async function refusal(response: Response, what: string): Promise<ApiError> {
    const body: unknown = await response.json().catch(() => null);
    const parsed = errorCodeSchema.safeParse(body);
    const code = parsed.success ? parsed.data.code : null;
    const wait = Number(response.headers.get(`retry-after`));
    const retryAfter = Number.isInteger(wait) && wait > 0 ? wait : null;
    return new ApiError(response.status, code, retryAfter, `${what} answered ${String(response.status)}${code === null ? `` : ` ${code}`}`);
}

function bearer(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
}

const json = { 'content-type': `application/json` };

/** What a held stream reports: its open, then each event. */
export interface StreamHandlers {
    opened(): void;
    event(event: StreamEvent): void;
}

/**
 * The bot and owner routes of one target server, spoken exactly as the
 * contract states them.
 */
export class ArenaClient {
    constructor(readonly origin: string) {}

    #url(path: string): string {
        return `${this.origin}${path}`;
    }

    /**
     * Signs in a synthetic identity through the dev login route and answers
     * the session cookie; a target without the route answers 404, which
     * surfaces as an ApiError with that status.
     */
    async devLogin(name: string): Promise<string> {
        const response = await fetch(this.#url(devLoginPath), {
            method: `POST`,
            headers: json,
            body: JSON.stringify({ name }),
        });
        if (response.status !== 200) throw await refusal(response, `dev login as ${name}`);
        const cookie = response.headers
            .getSetCookie()
            .map((line) => line.split(`;`)[0] ?? ``)
            .find((pair) => pair.startsWith(`${sessionCookieName}=`));
        if (cookie === undefined) throw new Error(`dev login as ${name} set no session cookie`);
        return cookie;
    }

    /**
     * A fresh token for the owner's bot: rotated when the bot exists, so a
     * rerun keeps its bots and their ratings, and created otherwise.
     */
    async claimBot(cookie: string, name: string): Promise<string> {
        const rotated = await fetch(this.#url(botTokenPath.replace(`{name}`, name)), {
            method: `POST`,
            headers: { cookie },
        });
        if (rotated.status === 200) return botWithTokenSchema.parse(await rotated.json()).token;
        if (rotated.status !== 404) throw await refusal(rotated, `token rotation for ${name}`);
        const created = await fetch(this.#url(botsPath), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify({ name }),
        });
        if (created.status !== 201) throw await refusal(created, `creating ${name}`);
        return botWithTokenSchema.parse(await created.json()).token;
    }

    async declare(token: string, accepts: Accepts, about: string): Promise<void> {
        const response = await fetch(this.#url(botAccountPath), {
            method: `PATCH`,
            headers: { ...bearer(token), ...json },
            body: JSON.stringify({ accepts, about }),
        });
        if (response.status !== 200) throw await refusal(response, `declaring the account`);
    }

    async challenge(token: string, target: string, timeControl: TimeControl, requestId: string): Promise<void> {
        const response = await fetch(this.#url(botChallengePath.replace(`{name}`, target)), {
            method: `POST`,
            headers: { ...bearer(token), ...json },
            body: JSON.stringify({ timeControl, requestId }),
        });
        if (response.status !== 201 && response.status !== 200) throw await refusal(response, `challenging ${target}`);
    }

    async accept(token: string, challengeId: string): Promise<void> {
        const response = await fetch(this.#url(challengeAcceptPath.replace(`{challengeId}`, challengeId)), {
            method: `POST`,
            headers: bearer(token),
        });
        if (response.status !== 200) throw await refusal(response, `accepting ${challengeId}`);
    }

    /**
     * Holds the bot's event stream open for challenges, reports the open,
     * and hands each event over as it arrives; settles when the server ends
     * the stream or the signal aborts it.
     */
    async stream(token: string, handlers: StreamHandlers, signal: AbortSignal): Promise<void> {
        const response = await fetch(this.#url(`${botStreamPath}?open=1`), { headers: bearer(token), signal });
        if (response.status !== 200 || response.body === null) throw await refusal(response, `opening the stream`);
        handlers.opened();
        let buffer = ``;
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
            buffer += chunk;
            let newline = buffer.indexOf(`\n`);
            while (newline !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                // A bare newline is the keepalive.
                if (line !== ``) handlers.event(streamEventSchema.parse(JSON.parse(line)));
                newline = buffer.indexOf(`\n`);
            }
        }
    }

    /** The engine-session websocket url for an origin-relative socket path. */
    engineUrl(socketUrl: string, token: string): string {
        const url = new URL(socketUrl, this.origin);
        url.protocol = url.protocol === `https:` ? `wss:` : `ws:`;
        url.searchParams.set(`token`, token);
        return url.toString();
    }
}
