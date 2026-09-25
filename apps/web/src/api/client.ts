import {
    botDirectoryQuerySchema,
    botListingSchema,
    botWithTokenSchema,
    botsPath,
    createBotRequestSchema,
    createGameRequestSchema,
    gamesPath,
    gameSnapshotSchema,
    humanMoveRequestSchema,
    leaderboardEntrySchema,
    leaderboardPath,
    leaderboardQuerySchema,
    type AxialCoord,
    type BotListing,
    type CreateGameRequest,
    type GameSnapshot,
    type LeaderboardEntry,
} from '@hexarena/contract';
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

/** One game as the seated human reads it; the read is session-authed. */
export function fetchGameSnapshot(gameId: string): Promise<GameSnapshot> {
    return getJson(`/api/games/${encodeURIComponent(gameId)}`, gameSnapshotSchema);
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
