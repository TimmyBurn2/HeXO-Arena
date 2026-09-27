import {
    botDirectoryQuerySchema,
    botListingSchema,
    botWithTokenSchema,
    botsPath,
    createBotRequestSchema,
    createGameRequestSchema,
    gameEventsPath,
    gamesPath,
    gameSnapshotSchema,
    guestMeSchema,
    guestPath,
    logoutPath,
    mePath,
    meSchema,
    humanMoveRequestSchema,
    leaderboardEntrySchema,
    leaderboardPath,
    leaderboardQuerySchema,
    liveGameEntrySchema,
    type AxialCoord,
    type BotListing,
    type CreateGameRequest,
    type GameSnapshot,
    type GuestMe,
    type LeaderboardEntry,
    type LiveGameEntry,
    type Me,
} from '@hexo-arena/contract';
import type { ZodType } from 'zod';

export type LeaderboardKind = `all` | `bots` | `humans`;

/**
 * A failed call: status 0 carries a network or parse break, anything else
 * the server's answer with its stable code when the body had one.
 */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string | null,
        message: string,
    ) {
        super(message);
    }
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
    return new ApiError(response.status, code, `the server answered ${String(response.status)}`);
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

/** Mint a new token for an owned bot; the old one dies and the new one shows once. */
export function rotateBotToken(name: string): Promise<{ name: string; token: string }> {
    return sendJson(`/api/bots/${encodeURIComponent(name)}/token`, `POST`, {}, botWithTokenSchema);
}

/** Delete an owned bot; a bot seated in a live game answers in_game. */
export function deleteBot(name: string): Promise<void> {
    return sendEmpty(`/api/bots/${encodeURIComponent(name)}`, `DELETE`);
}

/**
 * The whole rankable board for one kind; the filter narrows the board, no
 * number on it changes.
 */
export function fetchLeaderboard(kind: LeaderboardKind): Promise<LeaderboardEntry[]> {
    const query = leaderboardQuerySchema.parse({ kind });
    const search = new URLSearchParams({ kind: query.kind });
    return getJson(`${leaderboardPath}?${search.toString()}`, leaderboardEntrySchema.array());
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

/** Any game; the session only decides whether the caller's side is present. */
export function fetchGameSnapshot(gameId: string): Promise<GameSnapshot> {
    return getJson(`/api/games/${encodeURIComponent(gameId)}`, gameSnapshotSchema);
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
