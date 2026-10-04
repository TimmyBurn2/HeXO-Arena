import {
    botAccountPath,
    botChallengePath,
    botStreamPath,
    botTokenPath,
    botWithTokenSchema,
    botsPath,
    challengeAcceptPath,
    botListingSchema,
    devAccountSchema,
    devAccountsPath,
    finishedGamesPageSchema,
    finishedGamesPath,
    devLoginPath,
    gameEventSchema,
    gameEventsPath,
    gameMovePath,
    gameResignPath,
    gameSnapshotSchema,
    gamesPath,
    duelDetailSchema,
    duelListPath,
    duelListSchema,
    duelPath,
    sessionCookieName,
    streamEventSchema,
    tournamentDetailSchema,
    tournamentEntryPath,
    tournamentListSchema,
    tournamentPath,
    tournamentsPath,
    type AccountDeclaration,
    type createDuelRequestSchema,
    type BotListing,
    type AxialCoord,
    type CreateGameRequest,
    type DevAccount,
    type FinishedGamesQuery,
    type GameEvent,
    type GameSnapshot,
    type OpeningPlies,
    type DuelDetail,
    type DuelList,
    type StreamEvent,
    type TimeControl,
    type CreateRoundRobinRequest,
    type TournamentDetail,
    type TournamentList,
} from '@hexo-arena/contract';
import { setTimeout as sleep } from 'node:timers/promises';
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

// Refusals that clear by themselves: the caller over its request rate, a
// bot busy with a game or with other duels and round robins, or a bot not
// yet online and open.
const passing = new Set([`rate_limited`, `bot_busy`, `not_open`]);

/** How long a create call waits out a refusal that clears by itself before it gives up. */
export const refusalWaitMs = 60_000;

/**
 * Makes a create call until it is answered, waiting out a refusal that
 * clears by itself, by its Retry-After where it names one; any other
 * refusal, or one that outlasts the wait, fails with its code.
 */
export async function waitingOut<T>(create: () => Promise<T>, log: (line: string) => void, pollMs = 1_000): Promise<T> {
    const deadline = Date.now() + refusalWaitMs;
    for (;;) {
        try {
            return await create();
        } catch (error) {
            if (!(error instanceof ApiError) || error.code === null || !passing.has(error.code) || Date.now() >= deadline) throw error;
            log(`${error.message}; trying again`);
            await sleep(error.retryAfter === null ? pollMs : error.retryAfter * 1_000);
        }
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
        return (await this.#rotate(cookie, name)) ?? this.createBot(cookie, name);
    }

    /** A fresh token for a bot the owner already holds. */
    async rotateToken(cookie: string, name: string): Promise<string> {
        const token = await this.#rotate(cookie, name);
        if (token === null) throw new Error(`no bot named ${name} to rotate`);
        return token;
    }

    /** A new bot of the owner's and its first token. */
    async createBot(cookie: string, name: string): Promise<string> {
        const created = await fetch(this.#url(botsPath), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify({ name }),
        });
        if (created.status !== 201) throw await refusal(created, `creating ${name}`);
        return botWithTokenSchema.parse(await created.json()).token;
    }

    // Null when the owner holds no such bot.
    async #rotate(cookie: string, name: string): Promise<string | null> {
        const rotated = await fetch(this.#url(botTokenPath.replace(`{name}`, name)), {
            method: `POST`,
            headers: { cookie },
        });
        if (rotated.status === 200) return botWithTokenSchema.parse(await rotated.json()).token;
        if (rotated.status !== 404) throw await refusal(rotated, `token rotation for ${name}`);
        return null;
    }

    async declare(token: string, declaration: AccountDeclaration): Promise<void> {
        const response = await fetch(this.#url(botAccountPath), {
            method: `PATCH`,
            headers: { ...bearer(token), ...json },
            body: JSON.stringify(declaration),
        });
        if (response.status !== 200) throw await refusal(response, `declaring the account`);
    }

    async challenge(token: string, target: string, timeControl: TimeControl, requestId: string, openingPlies?: OpeningPlies): Promise<void> {
        const response = await fetch(this.#url(botChallengePath.replace(`{name}`, target)), {
            method: `POST`,
            headers: { ...bearer(token), ...json },
            body: JSON.stringify({ timeControl, requestId, ...(openingPlies !== undefined && { openingPlies }) }),
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

    /** Every listed bot. */
    async listBots(): Promise<BotListing[]> {
        const response = await fetch(this.#url(botsPath));
        if (response.status !== 200) throw await refusal(response, `listing the bots`);
        return botListingSchema.array().parse(await response.json());
    }

    /** The games a query names, counted past the page cap; the query names a player. */
    async finishedCount(query: FinishedGamesQuery): Promise<number> {
        const search = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === `string`));
        const response = await fetch(this.#url(`${finishedGamesPath}?${search.toString()}`));
        if (response.status !== 200) throw await refusal(response, `counting finished games`);
        return finishedGamesPageSchema.parse(await response.json()).record?.games ?? 0;
    }

    async tournaments(query: { bot?: string } = {}): Promise<TournamentList> {
        const response = await fetch(this.#url(`${tournamentsPath}${query.bot === undefined ? `` : `?${new URLSearchParams({ bot: query.bot }).toString()}`}`));
        if (response.status !== 200) throw await refusal(response, `listing the tournaments`);
        return tournamentListSchema.parse(await response.json());
    }

    /** One tournament as its page reads it. */
    async tournament(id: string): Promise<TournamentDetail> {
        const response = await fetch(this.#url(tournamentPath.replace(`{id}`, id)));
        if (response.status !== 200) throw await refusal(response, `reading tournament ${id}`);
        return tournamentDetailSchema.parse(await response.json());
    }

    /** Sets a round robin of bots up as the signed-in person; the answer is the round robin. */
    async createRoundRobin(cookie: string, request: Partial<CreateRoundRobinRequest> & Pick<CreateRoundRobinRequest, `bots` | `timeControl`>): Promise<TournamentDetail> {
        const response = await fetch(this.#url(tournamentsPath), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify(request),
        });
        if (response.status !== 201) throw await refusal(response, `setting up a round robin of ${request.bots.map((bot) => bot.name).join(`, `)}`);
        return tournamentDetailSchema.parse(await response.json());
    }

    /** Enters the owner's bot in a waiting tournament. */
    async enterTournament(cookie: string, tournamentId: string, bot: string): Promise<void> {
        const response = await fetch(this.#url(tournamentEntryPath.replace(`{id}`, tournamentId)), {
            method: `PUT`,
            headers: { cookie, ...json },
            body: JSON.stringify({ bot }),
        });
        if (response.status !== 200) throw await refusal(response, `entering ${bot}`);
    }

    /** Starts a duel between two bots as the signed-in person; the answer is the duel. */
    async createDuel(cookie: string, request: z.input<typeof createDuelRequestSchema>): Promise<DuelDetail> {
        const response = await fetch(this.#url(duelListPath), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify(request),
        });
        if (response.status !== 201) throw await refusal(response, `starting a duel of ${request.first} and ${request.second}`);
        return duelDetailSchema.parse(await response.json());
    }

    /** One duel as its page reads it. */
    async duel(id: string): Promise<DuelDetail> {
        const response = await fetch(this.#url(duelPath.replace(`{id}`, id)));
        if (response.status !== 200) throw await refusal(response, `reading duel ${id}`);
        return duelDetailSchema.parse(await response.json());
    }

    /** The running and recent duel one bot plays. */
    async listDuels(bot: string): Promise<DuelList> {
        const response = await fetch(this.#url(`${duelListPath}?${new URLSearchParams({ bot }).toString()}`));
        if (response.status !== 200) throw await refusal(response, `listing the duel of ${bot}`);
        return duelListSchema.parse(await response.json());
    }

    /** The seeded personas as they stand; a target without the dev routes answers 404. */
    async devAccounts(): Promise<DevAccount[]> {
        const response = await fetch(this.#url(devAccountsPath));
        if (response.status !== 200) throw await refusal(response, `listing the dev accounts`);
        return devAccountSchema.array().parse(await response.json());
    }

    /** Starts a human game against a bot; the answer is the seated snapshot. */
    async createGame(cookie: string, request: CreateGameRequest): Promise<GameSnapshot> {
        const response = await fetch(this.#url(gamesPath), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify(request),
        });
        if (response.status !== 201) throw await refusal(response, `starting a game against ${request.bot}`);
        return gameSnapshotSchema.parse(await response.json());
    }

    async move(cookie: string, gameId: string, cells: readonly [AxialCoord, AxialCoord]): Promise<void> {
        const response = await fetch(this.#url(gameMovePath.replace(`{gameId}`, gameId)), {
            method: `POST`,
            headers: { cookie, ...json },
            body: JSON.stringify({ cells }),
        });
        if (response.status !== 200) throw await refusal(response, `moving in ${gameId}`);
    }

    async resign(cookie: string, gameId: string): Promise<void> {
        const response = await fetch(this.#url(gameResignPath.replace(`{gameId}`, gameId)), {
            method: `POST`,
            headers: { cookie },
        });
        if (response.status !== 200) throw await refusal(response, `resigning ${gameId}`);
    }

    /**
     * Follows a game's event stream from its snapshot on, handing over each
     * event as it arrives; settles when the server ends the stream or the
     * signal aborts it.
     */
    async gameEvents(cookie: string, gameId: string, onEvent: (event: GameEvent) => void, signal: AbortSignal): Promise<void> {
        const response = await fetch(this.#url(gameEventsPath.replace(`{gameId}`, gameId)), { headers: { cookie }, signal });
        if (response.status !== 200 || response.body === null) throw await refusal(response, `following ${gameId}`);
        let buffer = ``;
        for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
            buffer += chunk;
            let end = buffer.indexOf(`\n\n`);
            while (end !== -1) {
                const frame = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const fields = new Map(frame.split(`\n`).map((line) => [line.slice(0, line.indexOf(`:`)), line.slice(line.indexOf(`:`) + 1).trim()]));
                // A frame of comment lines alone is the keepalive.
                const name = fields.get(`event`);
                if (name !== undefined) {
                    const data: unknown = JSON.parse(fields.get(`data`) ?? `null`);
                    onEvent(gameEventSchema.parse({ event: name, data }));
                }
                end = buffer.indexOf(`\n\n`);
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
