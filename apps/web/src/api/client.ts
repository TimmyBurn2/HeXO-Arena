import {
    analysisListSchema,
    analysisRequestSchema,
    communityAnalysisSchema,
    gameAnalysesPath,
    type AnalysisList,
    type CommunityAnalysis,
    deleteAccountRequestSchema,
    meExportPath,
    reportReceiptSchema,
    reportRequestSchema,
    reportsPath,
    type ReportReceipt,
    type ReportRequest,
    botDirectoryQuerySchema,
    botListingSchema,
    botSettingsPath,
    botSettingsSchema,
    botWithTokenSchema,
    botsPath,
    createBotRequestSchema,
    createGameRequestSchema,
    createDuelRequestSchema,
    duelBotStatesSchema,
    duelBotsPath,
    duelDetailSchema,
    duelListPath,
    duelListQuerySchema,
    duelListSchema,
    duelPath,
    duelStopPath,
    type CreateDuelRequest,
    type DuelBotState,
    type DuelDetail,
    type DuelList,
    type DuelListQuery,
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
    meUpdateRequestSchema,
    userMeSchema,
    type MeUpdateRequest,
    type UserMe,
    signupCreatedSchema,
    signupPath,
    signupRequestSchema,
    signupSchema,
    humanMoveRequestSchema,
    leaderboardPath,
    leaderboardQuerySchema,
    leaderboardSchema,
    liveGameEntrySchema,
    type AxialCoord,
    type BotListing,
    type BotSettings,
    type BotSettingsUpdate,
    type CreateGameRequest,
    type FinishedGamesPage,
    type FinishedGamesQuery,
    type GameSnapshot,
    type GuestMe,
    type LeaderboardEntry,
    type LiveGameEntry,
    type Me,
    type Signup,
    tournamentDetailSchema,
    tournamentEntryPath,
    tournamentEntrySchema,
    tournamentListSchema,
    tournamentPath,
    tournamentsPath,
    type TournamentDetail,
    type TournamentEntry,
    type TournamentList,
    playerPath,
    playerRecordSchema,
    ratingHistoryPath,
    ratingHistorySchema,
    type PlayerRecord,
    type RatingPoint,
    type RatingRange,
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

/** Change the signed-in user's own settings; the answer is the user after the change. */
export function updateMe(changes: MeUpdateRequest): Promise<UserMe> {
    return sendJson(mePath, `PATCH`, meUpdateRequestSchema.parse(changes), userMeSchema);
}

/** End the session, account or guest; idempotent. */
export function signOut(): Promise<void> {
    return sendEmpty(logoutPath, `POST`);
}

/** Delete the signed-in account, named as the person typed it; a seat in a live game answers in_live_game. */
export async function deleteAccount(name: string): Promise<void> {
    let response: Response;
    try {
        response = await fetch(mePath, {
            method: `DELETE`,
            headers: { 'content-type': `application/json`, accept: `application/json` },
            body: JSON.stringify(deleteAccountRequestSchema.parse({ name })),
            cache: `no-store`,
        });
    } catch (cause) {
        throw new ApiError(0, null, cause instanceof Error ? cause.message : `network`);
    }
    if (!response.ok) throw await failureOf(response);
}

// The file name the server gives the download, or one of the same shape.
function attachmentName(response: Response): string {
    const named = /filename="([^"]+)"/u.exec(response.headers.get(`content-disposition`) ?? ``)?.[1];
    return named ?? `hexo-arena-data.json`;
}

/**
 * The signed-in account's data as the file the server words it: passed on
 * to the person byte for byte, so the page never reads into it.
 */
export async function fetchAccountData(): Promise<{ file: Blob; name: string }> {
    let response: Response;
    try {
        response = await fetch(meExportPath, { headers: { accept: `application/json` }, cache: `no-store` });
    } catch (cause) {
        throw new ApiError(0, null, cause instanceof Error ? cause.message : `network`);
    }
    if (!response.ok) throw await failureOf(response);
    return { file: await response.blob(), name: attachmentName(response) };
}

/** Send a report to the operator; anyone may, signed in or not. */
export function sendReport(report: ReportRequest): Promise<ReportReceipt> {
    return sendJson(reportsPath, `POST`, reportRequestSchema.parse(report), reportReceiptSchema);
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

/** An owned bot's settings, which only its owner reads. */
export function fetchBotSettings(name: string): Promise<BotSettings> {
    return getJson(botSettingsPath.replace(`{name}`, encodeURIComponent(name)), botSettingsSchema);
}

/** Change an owned bot's settings; the answer is the settings after the change, and a refused value answers bad_request. */
export function updateBotSettings(name: string, changes: BotSettingsUpdate): Promise<BotSettings> {
    return sendJson(botSettingsPath.replace(`{name}`, encodeURIComponent(name)), `PATCH`, changes, botSettingsSchema);
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
 * Every listed bot, optionally narrowed to online ones, to analyzers, or to both;
 * the default is the whole roster so day one does not filter itself to zero rows.
 */
export function fetchBots(onlineOnly: boolean, analyzersOnly = false): Promise<BotListing[]> {
    const query = botDirectoryQuerySchema.parse({ ...(onlineOnly ? { online: `1` } : {}), ...(analyzersOnly ? { analyzer: `1` } : {}) });
    const search = new URLSearchParams();
    if (query.online !== undefined) search.set(`online`, query.online);
    if (query.analyzer !== undefined) search.set(`analyzer`, query.analyzer);
    return getJson(`${botsPath}${search.size === 0 ? `` : `?${search.toString()}`}`, botListingSchema.array());
}

/** The bots that declare an analyzer, online or not; each says whether it can read now. */
export function fetchAnalyzers(): Promise<BotListing[]> {
    return fetchBots(false, true);
}

/** Register a bot under the signed-in account; the token shows once. */
export function createBot(name: string): Promise<{ name: string; token: string }> {
    return sendJson(botsPath, `POST`, createBotRequestSchema.parse({ name }), botWithTokenSchema);
}

/** Start a game against an open bot; the answer is the seated snapshot. */
export function createGame(request: CreateGameRequest): Promise<GameSnapshot> {
    return sendJson(gamesPath, `POST`, createGameRequestSchema.parse(request), gameSnapshotSchema);
}

/** The games in progress, newest first, as far as the list's cap reaches; tests only when asked. */
export function fetchLiveGames(tests = false): Promise<LiveGameEntry[]> {
    return getJson(tests ? `${gamesPath}?tests=1` : gamesPath, liveGameEntrySchema.array());
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

/** A finished game's readings: community ones and each bot seat's own. */
export function fetchAnalyses(gameId: string): Promise<AnalysisList> {
    return getJson(gameAnalysesPath.replace(`{gameId}`, encodeURIComponent(gameId)), analysisListSchema);
}

/** Ask for a finished game to be read whole, by the analyzer named or by any; the answer is the request, queued. */
export function requestAnalysis(gameId: string, analyzer: string | null): Promise<CommunityAnalysis> {
    const body = analysisRequestSchema.parse(analyzer === null ? {} : { analyzer });
    return sendJson(gameAnalysesPath.replace(`{gameId}`, encodeURIComponent(gameId)), `POST`, body, communityAnalysisSchema);
}

/** Resign; the answer is the finished snapshot. */
export function resignGame(gameId: string): Promise<GameSnapshot> {
    return sendJson(`/api/games/${encodeURIComponent(gameId)}/resign`, `POST`, {}, gameSnapshotSchema);
}

/** The running tournament, those waiting, and the latest over. */
export function fetchTournaments(): Promise<TournamentList> {
    return getJson(tournamentsPath, tournamentListSchema);
}

/** One tournament in full. */
export function fetchTournament(id: string): Promise<TournamentDetail> {
    return getJson(tournamentPath.replace(`{id}`, encodeURIComponent(id)), tournamentDetailSchema);
}

/** Enters the signed-in owner's bot, replacing any bot of theirs entered before. */
export function enterTournament(id: string, bot: string): Promise<TournamentEntry> {
    return sendJson(tournamentEntryPath.replace(`{id}`, encodeURIComponent(id)), `PUT`, { bot }, tournamentEntrySchema);
}

/** Withdraws the signed-in owner's entry. */
export function withdrawTournamentEntry(id: string): Promise<void> {
    return sendEmpty(tournamentEntryPath.replace(`{id}`, encodeURIComponent(id)), `DELETE`);
}

/** A player's record by name: a bot or a human. */
export function fetchPlayerRecord(name: string): Promise<PlayerRecord> {
    return getJson(playerPath.replace(`{name}`, encodeURIComponent(name)), playerRecordSchema);
}

/** A player's rating after each rated game in the range, oldest first. */
export function fetchRatingHistory(name: string, range: RatingRange): Promise<RatingPoint[]> {
    return getJson(`${ratingHistoryPath.replace(`{name}`, encodeURIComponent(name))}?range=${range}`, ratingHistorySchema);
}

/** Running duels and the latest over, filtered as the query asks. */
export function fetchDuels(query: DuelListQuery = {}): Promise<DuelList> {
    const search = new URLSearchParams(Object.entries(duelListQuerySchema.parse(query)).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const tail = search.size === 0 ? `` : `?${search.toString()}`;
    return getJson(`${duelListPath}${tail}`, duelListSchema);
}

/** One duel as its page reads it. */
export function fetchDuel(id: string): Promise<DuelDetail> {
    return getJson(duelPath.replace(`{id}`, encodeURIComponent(id)), duelDetailSchema);
}

/** Every listed bot's switch for duels by others and the bots it duels now. */
export function fetchDuelBots(): Promise<DuelBotState[]> {
    return getJson(duelBotsPath, duelBotStatesSchema);
}

/** Start a duel or a test between two bots; the answer is the duel. */
export function createDuel(request: CreateDuelRequest): Promise<DuelDetail> {
    return sendJson(duelListPath, `POST`, createDuelRequestSchema.parse(request), duelDetailSchema);
}

/** Stop a running duel: no further game starts, and the live one plays on. */
export function stopDuel(id: string): Promise<DuelDetail> {
    return sendJson(duelStopPath.replace(`{id}`, encodeURIComponent(id)), `POST`, {}, duelDetailSchema);
}
