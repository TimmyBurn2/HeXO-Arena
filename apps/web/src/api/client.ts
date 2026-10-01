import {
    botDirectoryQuerySchema,
    botListingSchema,
    botWithTokenSchema,
    botsPath,
    createBotRequestSchema,
    createGameRequestSchema,
    finishedGamesPageSchema,
    finishedGamesPath,
    finishedGamesQuerySchema,
    gameEventsPath,
    gamesPath,
    gameSnapshotSchema,
    guestMeSchema,
    guestPath,
    logoutPath,
    mePath,
    meSchema,
    signupCreatedSchema,
    signupPath,
    signupRequestSchema,
    signupSchema,
    humanMoveRequestSchema,
    leaderboardPath,
    leaderboardQuerySchema,
    leaderboardSchema,
    legalDetailsPath,
    legalDetailsSchema,
    liveGameEntrySchema,
    type AxialCoord,
    type BotListing,
    type CreateGameRequest,
    type FinishedGamesPage,
    type FinishedGamesQuery,
    type GameSnapshot,
    type GuestMe,
    type LeaderboardEntry,
    type LegalDetails,
    type LiveGameEntry,
    type Me,
    type Signup,
} from '@hexo-arena/contract';
import type { ZodType } from 'zod';

export type LeaderboardKind = `all` | `bots` | `humans`;

/** Who the board holds by their latest rated game: the last 30 days, or everyone ranked. */
export type LeaderboardActive = `30d` | `all`;

/**
 * A failed call: status 0 carries a network or parse break, anything else
 * the server's answer with its stable code when the body had one, and the
 * seconds its Retry-After asks for when it sent one.
 */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null,
        message: string,
        readonly retryAfter: number | null = null,
    ) {
        super(message);
    }
}

/** The seconds a rate-limited refusal asks to wait, or null for any other failure. */
export function limitedFor(cause: unknown): number | null {
    return cause instanceof ApiError && cause.code === `rate_limited` ? cause.retryAfter : null;
}

async function getJson<T>(url: string, schema: ZodType<T>): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, { headers: { accept: `application/json` }, cache: `no-store` });
    } catch (cause) {
        throw new ApiError(0, null, cause instanceof Error ? cause.message : `network`);
    }
    if (!response.ok) {
        throw await failureOf(response);
    }
    return schema.parse(await response.json());
}

async function failureOf(response: Response): Promise<ApiError> {
    const body: unknown = await response.json().catch(() => null);
    const code =
        typeof body === `object` && body !== null && `code` in body && typeof body.code === `string`
            ? body.code
            : null;
    const wait = Number(response.headers.get(`retry-after`));
    return new ApiError(response.status, code, `the server answered ${String(response.status)}`, Number.isInteger(wait) && wait > 0 ? wait : null);
}

async function sendJson<T>(url: string, method: string, body: unknown, schema: ZodType<T>): Promise<T> {
    let response: Response;
    try {
        response = await fetch(url, {
            method,
            headers: { 'content-type': `application/json`, accept: `application/json` },
            body: JSON.stringify(body),
            cache: `no-store`,
        });
    } catch (cause) {
        throw new ApiError(0, null, cause instanceof Error ? cause.message : `network`);
    }
    if (!response.ok) {
        throw await failureOf(response);
    }
    return schema.parse(await response.json());
}

async function sendEmpty(url: string, method: string): Promise<void> {
    let response: Response;
    try {
        response = await fetch(url, { method, cache: `no-store` });
    } catch (cause) {
        throw new ApiError(0, null, cause instanceof Error ? cause.message : `network`);
    }
    if (!response.ok) {
        throw await failureOf(response);
    }
}

/** Who the session names; null means signed out, never an error. */
export function fetchMe(): Promise<Me> {
    return getJson(mePath, meSchema);
}

/** End the session, account or guest; idempotent. */
export function signOut(): Promise<void> {
    return sendEmpty(logoutPath, `POST`);
}

/** Start an anonymous, unrated session, or rejoin the one this browser holds. */
export function startGuest(): Promise<GuestMe> {
    return sendJson(guestPath, `POST`, {}, guestMeSchema);
}

/** The first sign-in waiting for its public name; a gone one answers 410. */
export function fetchSignup(): Promise<Signup> {
    return getJson(signupPath, signupSchema);
}

/** Create the account under the chosen name; the session cookie comes with the answer. */
export async function createAccount(name: string): Promise<void> {
    await sendJson(signupPath, `POST`, signupRequestSchema.parse({ name }), signupCreatedSchema);
}

/** Drop the first sign-in; nothing of it is kept. */
export function cancelSignup(): Promise<void> {
    return sendEmpty(signupPath, `DELETE`);
}

/** Mint a new token for an owned bot; the old one dies and the new one shows once. */
export function rotateBotToken(name: string): Promise<{ name: string; token: string }> {
    return sendJson(`/api/bots/${encodeURIComponent(name)}/token`, `POST`, {}, botWithTokenSchema);
}

/** Delete an owned bot; a bot seated in a live game answers in_game. */
export function deleteBot(name: string): Promise<void> {
    return sendEmpty(`/api/bots/${encodeURIComponent(name)}`, `DELETE`);
}

/**
 * The rankable board for one kind and window; either filter narrows the
 * board, no number on it changes.
 */
export function fetchLeaderboard(kind: LeaderboardKind, active: LeaderboardActive = `30d`): Promise<LeaderboardEntry[]> {
    const query = leaderboardQuerySchema.parse({ kind, active });
    const search = new URLSearchParams({ kind: query.kind, active: query.active });
    return getJson(`${leaderboardPath}?${search.toString()}`, leaderboardSchema);
}

/**
 * Every listed bot, optionally narrowed to online ones; the default is the
 * whole roster so day one does not filter itself to zero rows.
 */
export function fetchBots(onlineOnly: boolean): Promise<BotListing[]> {
    const query = botDirectoryQuerySchema.parse(onlineOnly ? { online: `1` } : {});
    const search = query.online === `1` ? `?online=1` : ``;
    return getJson(`${botsPath}${search}`, botListingSchema.array());
}

/** Register a bot under the signed-in account; the token shows once. */
export function createBot(name: string): Promise<{ name: string; token: string }> {
    return sendJson(botsPath, `POST`, createBotRequestSchema.parse({ name }), botWithTokenSchema);
}

/** Start a game against an open bot; the answer is the seated snapshot. */
export function createGame(request: CreateGameRequest): Promise<GameSnapshot> {
    return sendJson(gamesPath, `POST`, createGameRequestSchema.parse(request), gameSnapshotSchema);
}

/** The games in progress, newest first, as far as the list's cap reaches. */
export function fetchLiveGames(): Promise<LiveGameEntry[]> {
    return getJson(gamesPath, liveGameEntrySchema.array());
}

/** The newest page of finished games, unfiltered: the latest results first. */
export function fetchRecentGames(): Promise<FinishedGamesPage> {
    return getJson(finishedGamesPath, finishedGamesPageSchema);
}

/** One page of finished games for a query; a name no player holds answers 404. */
export function fetchFinishedGames(query: FinishedGamesQuery): Promise<FinishedGamesPage> {
    const search = new URLSearchParams(Object.entries(finishedGamesQuerySchema.parse(query)).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const tail = search.size === 0 ? `` : `?${search.toString()}`;
    return getJson(`${finishedGamesPath}${tail}`, finishedGamesPageSchema);
}

/** Any game; the session only decides whether the caller's side is present. */
export function fetchGameSnapshot(gameId: string): Promise<GameSnapshot> {
    return getJson(`/api/games/${encodeURIComponent(gameId)}`, gameSnapshotSchema);
}

/** The operator's details that the legal pages fill in. */
export function fetchLegalDetails(): Promise<LegalDetails> {
    return getJson(legalDetailsPath, legalDetailsSchema);
}

/** Where a game's live events stream from, for EventSource. */
export function gameEventsUrl(gameId: string): string {
    return gameEventsPath.replace(`{gameId}`, encodeURIComponent(gameId));
}

/** Play one full turn; the answer is the snapshot after it lands. */
export function playHumanMove(gameId: string, cells: readonly AxialCoord[]): Promise<GameSnapshot> {
    return sendJson(
        `/api/games/${encodeURIComponent(gameId)}/move`,
        `POST`,
        humanMoveRequestSchema.parse({ cells }),
        gameSnapshotSchema,
    );
}

/** Resign; the answer is the finished snapshot. */
export function resignGame(gameId: string): Promise<GameSnapshot> {
    return sendJson(`/api/games/${encodeURIComponent(gameId)}/resign`, `POST`, {}, gameSnapshotSchema);
}
