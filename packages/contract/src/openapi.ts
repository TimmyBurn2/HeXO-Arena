import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { stringify } from 'yaml';
import { z, type ZodType } from 'zod';
import { errorBodySchema } from './api';
import {
    analysesMemoMs,
    analysesPerGame,
    analysesPollMs,
    analysisCheckPath,
    analysisGraceMs,
    analysisHeuristicLimit,
    analysisListConflictErrorCodes,
    analysisListSchema,
    analysisPositionsPath,
    analysisQueueCap,
    analysisQueueExpiryMs,
    analysisQueueRetryAfterSeconds,
    analysisRequestConflictErrorCodes,
    analysisRequestQuotaErrorCodes,
    analysisRequestSchema,
    analysisRequestsPerUserDay,
    analysisWinInLimit,
    analyzerBenchMs,
    analyzerStrikeLimit,
    analyzerStrikeWindowMs,
    botAnalysisSocketPath,
    communityAnalysisSchema,
    gameAnalysesPath,
    liveGuardAheadTurns,
    meUpdateRequestSchema,
    positionBusyRetryAfterSeconds,
    positionCheckErrorCodes,
    positionCheckLimit,
    positionCheckPrefixLimit,
    positionCheckRequestSchema,
    positionHoldMs,
    positionReadingConflictErrorCodes,
    positionReadingQuotaErrorCodes,
    positionReadingRequestSchema,
    positionReadingSchema,
    positionReadingsPerUserDay,
    positionRequestLimit,
    userMeSchema,
    wholeGameSeconds,
    accountDeclarationSchema,
    accountExportLimit,
    accountExportSchema,
    accountInGameErrorCodes,
    accountNameMismatchErrorCodes,
    apiVersion,
    deleteAccountRequestSchema,
    deletedBotName,
    deletedPlayerName,
    meExportPath,
    reportGlobalLimit,
    reportLimit,
    reportPrefixLimit,
    reportReceiptSchema,
    reportRequestSchema,
    reportsPath,
    badRequestErrorCodes,
    botAccountPath,
    botAccountSchema,
    botCapPerUser,
    botConcurrentGameCap,
    botDailyCap,
    botDeleteConflictErrorCodes,
    botForbiddenErrorCodes,
    botGameResignPath,
    botGameSocketPath,
    botListingSchema,
    botStreamPath,
    botTokenPath,
    botWithTokenSchema,
    botsPath,
    botPath,
    botChallengePath,
    challengeAcceptErrorCodes,
    challengeAcceptPath,
    challengeInboxCap,
    challengeCancelPath,
    challengeCreateErrorCodes,
    challengeDeclinePath,
    challengeForbiddenErrorCodes,
    challengeSchema,
    challengeTtlMs,
    clientRequestLimit,
    challengeDailyCap,
    challengePairPendingCap,
    challengeQuotaErrorCodes,
    gameLimitErrorCodes,
    archiveReadGlobalLimit,
    archiveReadLimit,
    clientWatcherCap,
    guestMintLimit,
    guestMintPrefixLimit,
    guestSessionCap,
    seatWatcherCap,
    signInStartLimit,
    signInStartPrefixLimit,
    signInStateCap,
    botManagementLimit,
    engineDialLimit,
    engineFrameLimitBytes,
    engineStrayFrameCap,
    orphanForfeitMs,
    principalRequestLimit,
    streamOpenLimit,
    createBotRequestSchema,
    createChallengeRequestSchema,
    createGameRequestSchema,
    discordCallbackPath,
    discordExchangeLimit,
    discordLoginPath,
    discordNameMaxLength,
    gameCreateErrorCodes,
    gameEventSchema,
    gameEventsPath,
    gameCreateForbiddenErrorCodes,
    gameMoveErrorCodes,
    gameMovePath,
    gamePath,
    gameResignErrorCodes,
    gameResignPath,
    gameSnapshotSchema,
    gameWatcherCap,
    gamesPath,
    finishedGamesMemoMs,
    finishedGamesPageCap,
    finishedGamesPageSchema,
    finishedGamesPageSize,
    finishedGamesPath,
    finishedGamesQuerySchema,
    guestConflictErrorCodes,
    guestIdleSeconds,
    guestLimitErrorCodes,
    guestMeSchema,
    guestPath,
    guestRetryAfterSeconds,
    healthzPath,
    humanBotGameCap,
    humanConcurrentGameCap,
    humanGameStartLimit,
    logoutPath,
    mePath,
    meSchema,
    nextParam,
    nextPathMaxLength,
    nextPathSchema,
    humanMoveRequestSchema,
    leaderboardActiveDays,
    leaderboardCap,
    leaderboardPath,
    leaderboardSchema,
    playerPath,
    playerRecordMemoMs,
    playerRecordSchema,
    ratingHistoryCap,
    ratingHistoryPath,
    ratingHistoryQuerySchema,
    ratingHistorySchema,
    botSettingsPath,
    botSettingsSchema,
    botSettingsUpdateSchema,
    gameExportGlobalLimit,
    gameExportLimit,
    tournamentBotsPath,
    tournamentBotStatesSchema,
    tournamentPerBotCap,
    liveGamesQuerySchema,
    createTournamentRequestSchema,
    tournamentBotGamesMax,
    tournamentCreateErrorCodes,
    tournamentCreateForbiddenErrorCodes,
    tournamentDailyCap,
    tournamentGameCounts,
    tournamentLiveCap,
    tournamentQuotaErrorCodes,
    tournamentRunningListCap,
    tournamentStopConflictErrorCodes,
    tournamentStopForbiddenErrorCodes,
    tournamentStopPath,
    tournamentWithdrawConflictErrorCodes,
    tournamentWithdrawForbiddenErrorCodes,
    tournamentWithdrawPath,
    tournamentWithdrawRequestSchema,
    tournamentDetailMemoMs,
    tournamentDetailSchema,
    tournamentEntryPath,
    tournamentEntryRequestSchema,
    tournamentEntrySchema,
    tournamentExportPath,
    tournamentGamesMax,
    tournamentListPastCap,
    tournamentListQuerySchema,
    tournamentListSchema,
    tournamentPath,
    presenceGraceMs,
    tournamentsPath,
    tournamentWaitingCap,
    liveGameEntrySchema,
    liveGameListCap,
    liveGameListMemoMs,
    notFoundErrorCodes,
    okSchema,
    pairDailyCap,
    pausedErrorCodes,
    payloadTooLargeErrorCodes,
    publicRequestLimit,
    rateLimitedErrorCodes,
    rateText,
    rankableDeviation,
    requestBodyLimitBytes,
    serverLineLimitBytes,
    secureSessionCookieName,
    sessionCookieName,
    sessionHeartbeatMs,
    signInFailureParam,
    signInFailureSchema,
    signupAttemptCap,
    signupCookieName,
    signupCreatedSchema,
    signupExpiredErrorCodes,
    signupLimitErrorCodes,
    signupMaxAgeSeconds,
    signupNameErrorCodes,
    signupPath,
    signupRequestSchema,
    signupSchema,
    signupTakenErrorCodes,
    siteName,
    siteWatcherCap,
    streamBacklogLimitBytes,
    streamEventSchema,
    streamKeepaliveMs,
    unauthorizedErrorCodes,
    watcherLimitErrorCodes,
    watcherRetryAfterSeconds,
    welcomePath,
} from './index';

const seconds = (ms: number) => String(ms / 1000);
const kib = (bytes: number) => String(bytes / 1024);

// Every other component is named by .meta({ id }) where its schema is
// defined, so each use renders as a $ref to one definition.
const badRequestError = errorBodySchema(badRequestErrorCodes).meta({ id: `BadRequestError` });
const unauthorizedError = errorBodySchema(unauthorizedErrorCodes).meta({ id: `UnauthorizedError` });
const notFoundError = errorBodySchema(notFoundErrorCodes).meta({ id: `NotFoundError` });
const bannedError = errorBodySchema(botForbiddenErrorCodes).meta({ id: `BannedError` });
const pausedError = errorBodySchema(pausedErrorCodes).meta({ id: `PausedError` });
const signedInError = errorBodySchema(guestConflictErrorCodes).meta({ id: `SignedInError` });
const rateLimitedError = errorBodySchema(rateLimitedErrorCodes).meta({ id: `RateLimitedError` });
const payloadTooLargeError = errorBodySchema(payloadTooLargeErrorCodes).meta({ id: `PayloadTooLargeError` });
const guestLimitError = errorBodySchema([...guestLimitErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `GuestLimitError` });
const watcherLimitError = errorBodySchema([...watcherLimitErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `WatcherLimitError` });
const botNameError = errorBodySchema([`invalid_name`, `name_reserved`]).meta({ id: `BotNameError` });
const signupNameError = errorBodySchema(signupNameErrorCodes).meta({ id: `SignupNameError` });
const signupTakenError = errorBodySchema(signupTakenErrorCodes).meta({ id: `SignupTakenError` });
const signupExpiredError = errorBodySchema(signupExpiredErrorCodes).meta({ id: `SignupExpiredError` });
const botLimitError = errorBodySchema([`bot_limit`]).meta({ id: `BotLimitError` });
const nameTakenError = errorBodySchema([`name_taken`]).meta({ id: `NameTakenError` });
const inGameError = errorBodySchema(botDeleteConflictErrorCodes).meta({ id: `InGameError` });
const nameMismatchError = errorBodySchema([...badRequestErrorCodes, ...accountNameMismatchErrorCodes]).meta({ id: `NameMismatchError` });
const inLiveGameError = errorBodySchema(accountInGameErrorCodes).meta({ id: `InLiveGameError` });
const gameLimitError = errorBodySchema([...gameLimitErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `GameLimitError` });
const challengeQuotaError = errorBodySchema([...challengeQuotaErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `ChallengeQuotaError` });
const signupEndedError = errorBodySchema([...signupExpiredErrorCodes, ...signupLimitErrorCodes]).meta({ id: `SignupEndedError` });
const gameCreateError = errorBodySchema([...badRequestErrorCodes, ...gameCreateErrorCodes]).meta({
    id: `GameCreateError`,
});
const gameCreateForbiddenError = errorBodySchema(gameCreateForbiddenErrorCodes).meta({ id: `GameCreateForbiddenError` });
const moveError = errorBodySchema([...badRequestErrorCodes, ...gameMoveErrorCodes]).meta({ id: `MoveError` });
const gameOverError = errorBodySchema(gameResignErrorCodes).meta({ id: `GameOverError` });
const challengeCreateError = errorBodySchema([...badRequestErrorCodes, ...challengeCreateErrorCodes]).meta({
    id: `ChallengeCreateError`,
});
const challengeForbiddenError = errorBodySchema([...botForbiddenErrorCodes, ...challengeForbiddenErrorCodes]).meta({
    id: `ChallengeForbiddenError`,
});
const challengeAcceptError = errorBodySchema([...badRequestErrorCodes, ...challengeAcceptErrorCodes]).meta({
    id: `ChallengeAcceptError`,
});
const positionCheckError = errorBodySchema(positionCheckErrorCodes).meta({ id: `PositionCheckError` });
const positionReadingConflictError = errorBodySchema(positionReadingConflictErrorCodes).meta({ id: `PositionReadingConflictError` });
const positionReadingQuotaError = errorBodySchema([...positionReadingQuotaErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `PositionReadingQuotaError` });
const analysisRequestConflictError = errorBodySchema(analysisRequestConflictErrorCodes).meta({ id: `AnalysisRequestConflictError` });
const analysisRequestQuotaError = errorBodySchema([...analysisRequestQuotaErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `AnalysisRequestQuotaError` });
const analysisListConflictError = errorBodySchema(analysisListConflictErrorCodes).meta({ id: `AnalysisListConflictError` });

// A raw component cannot hold a zod schema, so it points at a named one;
// each such schema also goes to the generator, or its $ref would dangle.
// The bot document states only what a bot meets; the site's own rates stay in the site's.
function registerSharedComponents(registry: OpenAPIRegistry, surface: `site` | `bot`) {
    const referenced: { type: 'schema'; schema: ZodType }[] = [];
    const json = (schema: ZodType) => {
        const id = schema.meta()?.id;
        if (id === undefined) throw new Error(`a shared response needs a named schema`);
        referenced.push({ type: 'schema', schema });
        return { 'application/json': { schema: { $ref: `#/components/schemas/${id}` } } };
    };
    const response = (name: string, description: string, schema: ZodType) =>
        registry.registerComponent('responses', name, { description, content: json(schema) }).ref;
    const retryAfter = registry.registerComponent('headers', 'RetryAfter', {
        description: `Seconds to wait before retrying.`,
        schema: { type: 'integer', minimum: 1 },
    }).ref;
    return {
        referenced,
        retryAfter,
        unauthorized: response(
            `Unauthorized`,
            `No session cookie, or the session is expired or unknown.`,
            unauthorizedError,
        ),
        botUnauthorized: response(`BotUnauthorized`, `Missing, unknown, or rotated bot token.`, unauthorizedError),
        signedInUser: response(`SignedInUser`, `No signed-in user: a guest, or no session at all.`, unauthorizedError),
        banned: response(
            `Banned`,
            `The bot's owner is banned; after the ban lifts, the owner must rotate the token.`,
            bannedError,
        ),
        gameCreateForbidden: response(`GameCreateForbidden`, `The bot is delisted and takes no new games (delisted). own_bot is no longer sent: a game against the caller's own bot is played unrated.`, gameCreateForbiddenError),
        notFound: response(
            `NotFound`,
            `The target does not exist or is not the caller's to act on.`,
            notFoundError,
        ),
        badRequest: response(`BadRequest`, `The request fails validation.`, badRequestError),
        gameOver: response(`GameOver`, `The game is already finished (game_over).`, gameOverError),
        paused: registry.registerComponent('responses', 'Paused', {
            description: `The site is paused: no new stream, challenge, or game starts, and open streams and live games continue. A bot with a live game, or playing the running weekly tournament, still opens its stream. Retry after Retry-After.`,
            headers: { 'Retry-After': retryAfter },
            content: json(pausedError),
        }).ref,
        rateLimited: registry.registerComponent('responses', 'RateLimited', {
            description:
                surface === `site`
                    ? `Too many requests (rate_limited): one client, by network address, makes ${rateText(clientRequestLimit)}; operations needing no credential take ${rateText(publicRequestLimit)} from all callers together; each bot, user, guest, or game seat makes ${rateText(principalRequestLimit)} with its credential, and an account changes its bots ${rateText(botManagementLimit)}. Retry after Retry-After.`
                    : `Too many requests (rate_limited). Per network address: ${rateText(clientRequestLimit)}. Per bot token, and per game token: ${rateText(principalRequestLimit)}. Without a credential, across all callers: ${rateText(publicRequestLimit)}. Retry after Retry-After.`,
            headers: { 'Retry-After': retryAfter },
            content: json(rateLimitedError),
        }).ref,
        payloadTooLarge: response(
            `PayloadTooLarge`,
            `The body is larger than ${kib(requestBodyLimitBytes)} KiB (payload_too_large).`,
            payloadTooLargeError,
        ),
        exportLimited: registry.registerComponent('responses', 'ExportLimited', {
            description: `Exports are downloaded at most ${rateText(gameExportLimit)} per client, and ${rateText(gameExportGlobalLimit)} across callers (rate_limited); or too many requests. Retry after Retry-After.`,
            headers: { 'Retry-After': retryAfter },
            content: json(rateLimitedError),
        }).ref,
        gameExport: registry.registerComponent('responses', 'GameExport', {
            description: [
                `A zip archive, stored without compression: one HTTTX v1 file per finished game, numbered in play order and named for its sides (01-x-vs-o.htttx), and games.csv, a row per game.`,
                `Each file carries the HTTTX v1 header (name, platform, utcdatetime as the game's start, playercross, playercircle, timecontrol for a match clock, endreason and winner where v1 defines them), then the turns from the origin, the opening's stones among them.`,
            ].join(` `),
            headers: { 'Content-Disposition': { description: `An attachment with a plain ASCII file name.`, schema: { type: 'string' } } },
            content: { 'application/zip': { schema: { type: 'string', format: 'binary' } } },
        }).ref,
        archiveLimited: registry.registerComponent('responses', 'ArchiveLimited', {
            description: `A finished game is read at most ${rateText(archiveReadLimit)} per client, and ${rateText(archiveReadGlobalLimit)} across callers (rate_limited); or too many requests. Retry after Retry-After.`,
            headers: { 'Retry-After': retryAfter },
            content: json(rateLimitedError),
        }).ref,
        gameId: registry.registerComponent('parameters', 'GameId', {
            name: 'gameId',
            in: 'path',
            required: true,
            description: `The game, as carried on gameStart and moveRequest.`,
            schema: { type: 'string' },
        }).ref,
        challengeId: registry.registerComponent('parameters', 'ChallengeId', {
            name: 'challengeId',
            in: 'path',
            required: true,
            description: `The challenge, as carried on its challenge line.`,
            schema: { type: 'string' },
        }).ref,
        botName: registry.registerComponent('parameters', 'BotName', {
            name: 'name',
            in: 'path',
            required: true,
            description: `The bot's name.`,
            schema: { type: 'string' },
        }).ref,
    };
}

type SharedComponents = ReturnType<typeof registerSharedComponents>;

function registerSiteSurface(registry: OpenAPIRegistry, shared: SharedComponents) {
    registry.registerComponent('securitySchemes', 'sessionCookie', {
        type: 'apiKey',
        in: 'cookie',
        name: secureSessionCookieName,
        description: `An HttpOnly session cookie, set by a Discord sign-in, a created account, or the guest route; named ${sessionCookieName} where the site runs without TLS. A write carrying it from another origin, by the browser's Sec-Fetch-Site, answers 403 cross_origin.`,
    });
    registry.registerComponent('securitySchemes', 'signupCookie', {
        type: 'apiKey',
        in: 'cookie',
        name: signupCookieName,
        description: `An HttpOnly cookie for a first sign-in waiting for its public name, set by the Discord OAuth callback for ${String(signupMaxAgeSeconds / 60)} minutes.`,
    });
    // Named where the callback's redirect describes it, so the reasons are listed.
    shared.referenced.push({ type: 'schema', schema: signInFailureSchema });

    registry.registerPath({
        method: 'get',
        path: healthzPath,
        summary: 'Liveness probe.',
        // No response content: the probe carries one bit, which doubles as
        // the pause signal for uptime monitors.
        responses: {
            200: { description: 'The process is up and serving.' },
            503: { description: 'The process is up and paused.' },
        },
    });

    registry.registerPath({
        method: 'get',
        path: discordLoginPath,
        summary: 'Start Discord OAuth: redirect to the authorize endpoint.',
        operationId: 'discordLogin',
        tags: ['Auth'],
        description: `Each redirect carries a fresh state and nonce, valid once at the callback, and asks Discord to skip its screen for an app the account already allowed. The state keeps the return path.`,
        parameters: [
            {
                name: nextParam,
                in: 'query',
                required: false,
                description: `Where the sign-in returns: a path on this site with its query, at most ${String(nextPathMaxLength)} characters. Missing or invalid, the sign-in returns to /.`,
                schema: { type: 'string', maxLength: nextPathMaxLength },
            },
        ],
        responses: {
            302: {
                description: `Redirect to Discord's authorize endpoint; or to the return path with ${signInFailureParam}=unconfigured when Discord OAuth is not set up, or with ${signInFailureParam}=busy past ${rateText(signInStartLimit)} per client or ${rateText(signInStartPrefixLimit)} per IPv6 /48, or with ${String(signInStateCap)} sign-ins waiting on Discord.`,
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: discordCallbackPath,
        summary: 'Finish Discord OAuth: sign in, or hold a first sign-in.',
        operationId: 'discordCallback',
        tags: ['Auth'],
        description: `Requests the identify scope only and keeps the Discord id, username, and display name. A known account is signed in unless it is banned. An unknown account creates nothing: the callback holds a sign-up for ${String(signupMaxAgeSeconds / 60)} minutes behind the signup cookie and sends the visitor to ${welcomePath} to choose a public name. A failed sign-in creates no session.`,
        responses: {
            302: {
                description: `A redirect to the return path with the session cookie set, to ${welcomePath} with the signup cookie set, or on failure to the return path with ${signInFailureParam} naming a SignInFailure; error=access_denied from Discord reads as cancelled. Codes confirmed with Discord are held to ${rateText(discordExchangeLimit)} across every caller; past that the callback answers busy without asking Discord.`,
                headers: {
                    Location: {
                        description: `The return path, ${welcomePath}, or the return path with ${signInFailureParam}= and the reason.`,
                        schema: { type: 'string' },
                    },
                },
            },
        },
    });

    // Named here, since only the sign-up's own schemas reference it.
    shared.referenced.push({ type: 'schema', schema: nextPathSchema });

    registry.registerPath({
        method: 'get',
        path: signupPath,
        summary: 'Read the first sign-in waiting for its public name.',
        operationId: 'getSignup',
        tags: ['Auth'],
        security: [{ signupCookie: [] }],
        description: `The Discord account the sign-in came from, names up to ${String(discordNameMaxLength)} characters, a name made from its username that is free at the time of the read, and where the sign-in returns once the account exists.`,
        responses: {
            200: {
                description: `The waiting sign-up.`,
                content: { 'application/json': { schema: signupSchema } },
            },
            410: {
                description: `No sign-up waits for this cookie: it expired, was used, or never existed.`,
                content: { 'application/json': { schema: signupExpiredError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: signupPath,
        summary: 'Create the account under the chosen public name.',
        operationId: 'createAccount',
        tags: ['Auth'],
        security: [{ signupCookie: [] }],
        description: `Creates the account and its session, ends whatever session the browser held, a guest's with its games, and clears the signup cookie. The name shares one global namespace with bots and never changes. A sign-up takes at most ${String(signupAttemptCap)} names; past that it ends.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: signupRequestSchema } } },
        },
        responses: {
            201: {
                description: `The account exists; the session cookie is set.`,
                content: { 'application/json': { schema: signupCreatedSchema } },
            },
            400: {
                description: `The chosen public name fails the name syntax or is reserved.`,
                content: { 'application/json': { schema: signupNameError } },
            },
            409: {
                description: `Another user or a bot holds the chosen name's fold.`,
                content: { 'application/json': { schema: signupTakenError } },
            },
            410: {
                description: `No sign-up waits for this cookie (signup_expired), or it tried ${String(signupAttemptCap)} names and has ended (signup_limit); signing in again starts a new one.`,
                content: { 'application/json': { schema: signupEndedError } },
            },
        },
    });

    registry.registerPath({
        method: 'delete',
        path: signupPath,
        summary: 'Drop the first sign-in without creating the account.',
        operationId: 'cancelSignup',
        tags: ['Auth'],
        security: [{ signupCookie: [] }, {}],
        description: `Idempotent: deletes whatever the cookie holds and clears the cookie.`,
        responses: {
            204: { description: 'Nothing of the sign-up is kept.' },
        },
    });

    registry.registerPath({
        method: 'get',
        path: mePath,
        summary: 'Who the session names.',
        operationId: 'me',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }, {}],
        description: `Reads the session cookie alone; without a live session the answer is null, never 401.`,
        responses: {
            200: {
                description: `The session's user or guest, or null.`,
                content: { 'application/json': { schema: meSchema } },
            },
        },
    });

    registry.registerPath({
        method: 'patch',
        path: mePath,
        summary: `Change the signed-in user's settings.`,
        operationId: 'updateMe',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        description: `Each present field replaces the stored one. While a user is opted out, requests to read their games are refused; positions on the analysis board stay readable.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: meUpdateRequestSchema } } },
        },
        responses: {
            200: {
                description: `The user after the change.`,
                content: { 'application/json': { schema: userMeSchema } },
            },
            400: shared.badRequest,
            401: shared.signedInUser,
        },
    });

    registry.registerPath({
        method: 'post',
        path: logoutPath,
        summary: 'Sign out: end the session and clear its cookie.',
        operationId: 'logout',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }, {}],
        description: `Idempotent: without a live session it still clears the cookie. Ending a guest session aborts its live games.`,
        responses: {
            204: { description: 'The session is gone and the cookie cleared.' },
        },
    });

    registry.registerPath({
        method: 'delete',
        path: mePath,
        summary: 'Delete the signed-in account.',
        operationId: 'deleteAccount',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        description: `The body names the account's public name. The account, its sessions, and its bots are deleted, and its name is freed; its games stay, the account reading as ${deletedPlayerName} and each kept bot as ${deletedBotName}. Its bots' live games are aborted and their tournament entries withdrawn. Every session ends and the cookie clears.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: deleteAccountRequestSchema } } },
        },
        responses: {
            204: { description: `The account is gone and the cookie cleared.` },
            400: {
                description: `Validation failed (bad_request), or the name is not the account's (name_mismatch).`,
                content: { 'application/json': { schema: nameMismatchError } },
            },
            401: shared.unauthorized,
            409: {
                description: `The account is seated in a live game (in_live_game); it finishes or resigns first.`,
                content: { 'application/json': { schema: inLiveGameError } },
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: meExportPath,
        summary: `Download the signed-in account's data.`,
        operationId: 'exportAccount',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }],
        description: `Every row tied to the account as one JSON attachment. An account downloads ${rateText(accountExportLimit)}.`,
        responses: {
            200: {
                description: `The account's data.`,
                headers: { 'Content-Disposition': { description: `An attachment named for the account and the day.`, schema: { type: 'string' } } },
                content: { 'application/json': { schema: accountExportSchema } },
            },
            401: shared.unauthorized,
        },
    });

    registry.registerPath({
        method: 'post',
        path: guestPath,
        summary: 'Start an anonymous guest session.',
        operationId: 'startGuest',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }, {}],
        description: `The session lives in server memory only and ends at sign-out, a Discord sign-in, or a restart. It also ends after ${String(guestIdleSeconds / 3600)} h without a request, unless it sits in a live game. Every guest game is unrated, and stays in the public record under the guest's label.`,
        responses: {
            200: {
                description: 'The caller already holds this guest session.',
                content: { 'application/json': { schema: guestMeSchema } },
            },
            201: {
                description: `A new guest session; the session cookie is set.`,
                content: { 'application/json': { schema: guestMeSchema } },
            },
            409: {
                description: `A user is signed in.`,
                content: { 'application/json': { schema: signedInError } },
            },
            429: {
                description: `The global cap of ${String(guestSessionCap)} guest sessions is full (guest_limit), retry after ${String(guestRetryAfterSeconds)} s; or one client started ${rateText(guestMintLimit)}, or one IPv6 /48 ${rateText(guestMintPrefixLimit)} (rate_limited), or too many requests.`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: guestLimitError } },
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: leaderboardPath,
        summary: 'List rankable players by rating.',
        operationId: 'getLeaderboard',
        tags: ['Directory'],
        security: [],
        description: `Rankable players, highest rating first, ties by name fold, at most ${String(leaderboardCap)}. A player is rankable at a rating deviation of ${String(rankableDeviation)} or below. Banned users, delisted bots, and bots of banned owners never appear. Bots and humans share one rating pool.`,
        parameters: [
            {
                name: 'kind',
                in: 'query',
                required: false,
                description: `Narrows the board to bots or humans; all when absent.`,
                schema: { type: 'string', enum: ['bots', 'humans', 'all'] },
            },
            {
                name: 'active',
                in: 'query',
                required: false,
                description: `Players whose latest rated game finished in the last ${String(leaderboardActiveDays)} days, or all; ${String(leaderboardActiveDays)} days when absent.`,
                schema: { type: 'string', enum: ['30d', 'all'] },
            },
        ],
        responses: {
            200: {
                description: 'The board.',
                content: {
                    'application/json': { schema: leaderboardSchema },
                },
            },
            400: shared.badRequest,
        },
    });

    registry.registerPath({
        method: 'post',
        path: botsPath,
        summary: 'Create a bot owned by the session user.',
        operationId: 'createBot',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `Mints the bot's token; this response is its only appearance. Names share one global namespace with users and never change.`,
        request: {
            body: { content: { 'application/json': { schema: createBotRequestSchema } } },
        },
        responses: {
            201: {
                description: `The bot and its token.`,
                content: { 'application/json': { schema: botWithTokenSchema } },
            },
            400: {
                description: `The name fails the name syntax or is reserved.`,
                content: {
                    'application/json': { schema: botNameError },
                },
            },
            401: shared.unauthorized,
            403: {
                description: `The owner already holds ${String(botCapPerUser)} bots.`,
                content: { 'application/json': { schema: botLimitError } },
            },
            409: {
                description: `The name fold is taken by a user or a bot.`,
                content: { 'application/json': { schema: nameTakenError } },
            },
        },
    });

    registry.registerPath({
        method: 'delete',
        path: botPath,
        summary: 'Delete a bot owned by the session user.',
        operationId: 'deleteBot',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `A bot with rated games or a tournament is kept: its games and ratings stay, it reads as ${deletedBotName}, and its name stays reserved. Any other bot is deleted with its games and its name freed.`,
        parameters: [shared.botName],
        responses: {
            204: { description: 'The bot and its token are gone.' },
            401: shared.unauthorized,
            404: shared.notFound,
            409: {
                description: `The bot is seated in a live game.`,
                content: { 'application/json': { schema: inGameError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: botTokenPath,
        summary: 'Rotate a bot token.',
        operationId: 'rotateBotToken',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `The previous token stops working at once.`,
        parameters: [shared.botName],
        responses: {
            200: {
                description: `The bot and its new token, shown only here.`,
                content: { 'application/json': { schema: botWithTokenSchema } },
            },
            401: shared.unauthorized,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'get',
        path: botSettingsPath,
        summary: `Read a bot's settings, as its owner.`,
        operationId: 'getBotSettings',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `The choices the owner makes for the bot on the website, beside what the bot declares, and the client it last connected with. Another person's bot answers not_found.`,
        parameters: [shared.botName],
        responses: {
            200: { description: `The bot's settings.`, content: { 'application/json': { schema: botSettingsSchema } } },
            401: shared.unauthorized,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'patch',
        path: botSettingsPath,
        summary: `Change a bot's settings, as its owner.`,
        operationId: 'updateBotSettings',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `Each present field replaces the stored one; an empty about or repoUrl clears the owner's, and the declared one shows again. With duels by others off, the bot leaves every running duel and round robin someone else set up, and one left with fewer than two bots is cut short.`,
        parameters: [shared.botName],
        request: {
            body: { required: true, content: { 'application/json': { schema: botSettingsUpdateSchema } } },
        },
        responses: {
            200: { description: `The bot's settings after the change.`, content: { 'application/json': { schema: botSettingsSchema } } },
            400: shared.badRequest,
            401: shared.unauthorized,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'post',
        path: gamesPath,
        summary: 'Start a game against a bot.',
        operationId: 'createGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: [
            `The bot must hold its stream open with open=1, or at all if it is the caller's own, have fewer than ${String(botConcurrentGameCap)} live games, and accept the clock.`,
            `The caller may hold ${String(humanConcurrentGameCap)} live games, ${String(humanBotGameCap)} per bot.`,
            `The bot receives gameStart. A guest's game, or one against the caller's own bot, is unrated.`,
        ].join(` `),
        request: {
            body: { required: true, content: { 'application/json': { schema: createGameRequestSchema } } },
        },
        responses: {
            201: {
                description: `The new game's snapshot.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: `Validation failed (bad_request), the caller is at its live-game cap (human_busy) or already plays this bot (pair_busy), or the bot is not open (not_open), excludes the clock (clock_not_accepted), declares no such level (unknown_level), or is at its game cap or playing the weekly tournament (bot_busy).`,
                content: {
                    'application/json': {
                        schema: gameCreateError,
                    },
                },
            },
            401: shared.unauthorized,
            403: shared.gameCreateForbidden,
            429: {
                description: `The caller started games faster than ${rateText(humanGameStartLimit)} (game_cooldown); or a signed-in caller has played this bot rated ${String(pairDailyCap)} times this UTC day (daily_pair_cap), until 00:00 UTC; Retry-After says how long either has left; or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: gameLimitError } },
            },
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'get',
        path: gamesPath,
        summary: 'List live games.',
        operationId: 'listLiveGames',
        tags: ['Games'],
        security: [],
        description: `Games in progress, newest first, at most ${String(liveGameListCap)}, without pagination. Guest games are listed, tests only when asked; finished games never are. The list is read at most once every ${seconds(liveGameListMemoMs)} s, and every caller in that time gets the same body.`,
        request: { query: liveGamesQuerySchema },
        responses: {
            200: {
                description: `The live games.`,
                content: { 'application/json': { schema: liveGameEntrySchema.array() } },
            },
            400: shared.badRequest,
        },
    });

    registry.registerPath({
        method: 'get',
        path: finishedGamesPath,
        summary: 'List finished games.',
        operationId: 'listFinishedGames',
        tags: ['Games'],
        security: [],
        description: [
            `Finished games, newest first, ${String(finishedGamesPageSize)} a page, at most ${String(finishedGamesPageCap)} pages per set of filters; before reaches older games.`,
            `Guest games are listed, unrated, under the guest's label.`,
            `An unknown name answers not_found; a deleted player is never a filter.`,
            `An identical query is read at most once every ${seconds(finishedGamesMemoMs)} s, every caller then getting one body.`,
        ].join(` `),
        request: { query: finishedGamesQuerySchema },
        responses: {
            200: {
                description: `One page of games.`,
                content: { 'application/json': { schema: finishedGamesPageSchema } },
            },
            400: shared.badRequest,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'get',
        path: gamePath,
        summary: `Read any game.`,
        operationId: 'getGameSnapshot',
        tags: ['Games'],
        security: [{ sessionCookie: [] }, {}],
        description: `Board, turn, and clock in one read; a finished game carries its result. Anyone may read any game.`,
        parameters: [shared.gameId],
        responses: {
            200: {
                description: `The game's snapshot.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            404: shared.notFound,
            429: shared.archiveLimited,
        },
    });

    registry.registerPath({
        method: 'get',
        path: gameEventsPath,
        summary: `Watch a game live.`,
        operationId: 'watchGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }, {}],
        description: `Server-sent events: on open a snapshot, then a turn event per applied turn, then a finish event, and the stream closes. A finished game sends its snapshot and closes. A comment line comes every ${seconds(streamKeepaliveMs)} s. Events carry no ids and nothing replays: a reconnect gets a fresh snapshot.`,
        parameters: [shared.gameId],
        responses: {
            200: {
                description: `The event stream; the server ends one that leaves more than ${kib(streamBacklogLimitBytes)} KiB unread.`,
                content: { 'text/event-stream': { schema: gameEventSchema } },
            },
            404: shared.notFound,
            429: {
                description: `Watchers without a seat are capped at ${String(gameWatcherCap)} per game, ${String(siteWatcherCap)} in total, and ${String(clientWatcherCap)} per client, and a seat holds at most ${String(seatWatcherCap)} streams of its own game (watcher_limit), retry after ${String(watcherRetryAfterSeconds)} s; or a finished game read too often, as on getGameSnapshot, or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: watcherLimitError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: gameMovePath,
        summary: `Play the two placements of the caller's turn.`,
        operationId: 'playHumanMove',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `Places both stones of the caller's turn. A win on the first placement ends the game, and the second is not applied. An illegal move answers 400 and forfeits nothing.`,
        parameters: [shared.gameId],
        request: {
            body: { required: true, content: { 'application/json': { schema: humanMoveRequestSchema } } },
        },
        responses: {
            200: {
                description: `The snapshot after the move.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: `Validation failed (bad_request), it is not the caller's turn (not_your_turn), a cell is taken (cell_occupied) or out of range (out_of_range), or the game is over (game_over).`,
                content: {
                    'application/json': {
                        schema: moveError,
                    },
                },
            },
            401: shared.unauthorized,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'post',
        path: gameResignPath,
        summary: 'Resign a game the caller plays in.',
        operationId: 'resignHumanGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `The opponent wins with reason surrender.`,
        parameters: [shared.gameId],
        responses: {
            200: {
                description: `The finished snapshot.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: shared.gameOver,
            401: shared.unauthorized,
            404: shared.notFound,
        },
    });

    registerTournamentPaths(registry, shared);
    registerPlayerPaths(registry, shared);
    registerAnalysisPaths(registry, shared);

    registry.registerPath({
        method: 'post',
        path: reportsPath,
        summary: 'Report something on the site to the operator.',
        operationId: 'createReport',
        tags: ['Reports'],
        security: [{ sessionCookie: [] }, {}],
        description: `Anyone may report, signed in or not; the report is stored for the operator, who closes it with a note. One client sends ${rateText(reportLimit)}, one IPv6 /48 ${rateText(reportPrefixLimit)}, and every caller together ${rateText(reportGlobalLimit)}.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: reportRequestSchema } } },
        },
        responses: {
            201: { description: `The report is stored.`, content: { 'application/json': { schema: reportReceiptSchema } } },
            400: shared.badRequest,
        },
    });
}

const tournamentEntryError = errorBodySchema([...badRequestErrorCodes, `clock_not_accepted`]).meta({ id: `TournamentEntryError` });
const failingBot = { bot: z.string().optional().meta({ description: `The first bot the refusal names, so the setup marks it.` }) };
const tournamentCreateError = errorBodySchema([...badRequestErrorCodes, ...tournamentCreateErrorCodes])
    .extend(failingBot)
    .meta({ id: `TournamentCreateError` });
const tournamentCreateForbiddenError = errorBodySchema(tournamentCreateForbiddenErrorCodes)
    .extend({ bot: z.string().optional().meta({ description: `The bot taken out of play.` }) })
    .meta({ id: `TournamentCreateForbiddenError` });
const tournamentQuotaError = errorBodySchema([...tournamentQuotaErrorCodes, ...rateLimitedErrorCodes]).meta({ id: `TournamentQuotaError` });
const tournamentStopForbiddenError = errorBodySchema(tournamentStopForbiddenErrorCodes).meta({ id: `TournamentStopForbiddenError` });
const tournamentStopConflictError = errorBodySchema(tournamentStopConflictErrorCodes).meta({ id: `TournamentStopConflictError` });
const tournamentWithdrawForbiddenError = errorBodySchema(tournamentWithdrawForbiddenErrorCodes).meta({ id: `TournamentWithdrawForbiddenError` });
const tournamentWithdrawConflictError = errorBodySchema(tournamentWithdrawConflictErrorCodes).meta({ id: `TournamentWithdrawConflictError` });
const tournamentForbiddenError = errorBodySchema([`not_owner`, `delisted`]).meta({ id: `TournamentForbiddenError` });
const tournamentClosedError = errorBodySchema([`closed`, `full`]).meta({ id: `TournamentClosedError` });

function registerPlayerPaths(registry: OpenAPIRegistry, shared: SharedComponents) {
    const name = registry.registerComponent('parameters', 'PlayerName', {
        name: 'name',
        in: 'path',
        required: true,
        description: `A player's name, matched case-folded: a bot or a human.`,
        schema: { type: 'string' },
    }).ref;

    registry.registerPath({
        method: 'get',
        path: playerPath,
        summary: `Read a player's record.`,
        operationId: 'getPlayerRecord',
        tags: ['Players'],
        security: [],
        description: `Games won, lost, and without a winner, by side, forfeits, the most played opponents, and a bot's tournament places. A name no player holds answers not_found. A record is read at most once every ${String(playerRecordMemoMs / 1000)} s, every caller in that time getting the same body.`,
        parameters: [name],
        responses: {
            200: { description: `The record.`, content: { 'application/json': { schema: playerRecordSchema } } },
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'get',
        path: ratingHistoryPath,
        summary: `Read a player's rating history.`,
        operationId: 'getRatingHistory',
        tags: ['Players'],
        security: [],
        description: `The rating after each rated game in the range, the newest ${String(ratingHistoryCap)} at most. A name no player holds answers not_found.`,
        parameters: [name],
        request: { query: ratingHistoryQuerySchema },
        responses: {
            200: { description: `The history.`, content: { 'application/json': { schema: ratingHistorySchema } } },
            400: shared.badRequest,
            404: shared.notFound,
        },
    });
}

function registerAnalysisPaths(registry: OpenAPIRegistry, shared: SharedComponents) {
    const untilMidnight = `until 00:00 UTC, which Retry-After names`;

    registry.registerPath({
        method: 'post',
        path: analysisPositionsPath,
        summary: 'Ask an analyzer to read a position.',
        operationId: 'requestPositionReading',
        tags: ['Analysis'],
        security: [{ sessionCookie: [] }],
        description: `Held up to ${seconds(positionHoldMs)} s for a reading by the named analyzer, or any ready one, which reads for the asked seconds up to its own most. A kept reading answers at once and costs nothing. Refused for a position a live game holds or runs on from, and to a caller seated in a live game.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: positionReadingRequestSchema } } },
        },
        responses: {
            200: {
                description: `The reading, a place in the queue, or a failure.`,
                content: { 'application/json': { schema: positionReadingSchema } },
            },
            400: {
                description: `Validation failed, or the position holds two stones on a cell or a six (bad_request).`,
                content: { 'application/json': { schema: badRequestError } },
            },
            401: shared.signedInUser,
            409: {
                description: `A live game holds the position, held it a turn or two ago, or leads to it within ${String(liveGuardAheadTurns)} turns, under any turn, mirror, color swap, or shift (live_position); the caller sits in a live game (seated); no ready analyzer takes it (no_analyzer); or a newer request from the caller replaced it (superseded).`,
                content: { 'application/json': { schema: positionReadingConflictError } },
            },
            429: {
                description: `The caller's ${String(positionReadingsPerUserDay)} positions this UTC day are spent (analysis_limit), ${untilMidnight}; the analyzers' queues are full (analysis_busy), retry after ${String(positionBusyRetryAfterSeconds)} s; or a user sent more than ${rateText(positionRequestLimit)} (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: positionReadingQuotaError } },
            },
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'post',
        path: analysisCheckPath,
        summary: 'Clear a position against live games.',
        operationId: 'checkPosition',
        tags: ['Analysis'],
        security: [{ sessionCookie: [] }, {}],
        description: `For an engine the browser runs itself: the same refusal a position request meets, without asking any analyzer. A caller without a session meets only the position's. One client clears ${rateText(positionCheckLimit)}, and one IPv6 /48 ${rateText(positionCheckPrefixLimit)}.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: positionCheckRequestSchema } } },
        },
        responses: {
            204: { description: `No live game stands in the way.` },
            400: shared.badRequest,
            409: {
                description: `The position is a live game's, or leads on from one (live_position); or the caller sits in a live game (seated).`,
                content: { 'application/json': { schema: positionCheckError } },
            },
            429: {
                description: `The client cleared more than ${rateText(positionCheckLimit)}, or its IPv6 /48 more than ${rateText(positionCheckPrefixLimit)} (rate_limited); or too many requests. Retry after Retry-After.`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: rateLimitedError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: gameAnalysesPath,
        summary: 'Ask for a finished game to be read whole.',
        operationId: 'requestAnalysis',
        tags: ['Analysis'],
        security: [{ sessionCookie: [] }],
        description: `A community analyzer reads each position from the first turn after the opening, ${String(wholeGameSeconds)} s each. A game holds ${String(analysesPerGame.done)} finished readings from different analyzers and owners, and ${String(analysesPerGame.pending)} pending. No analyzer reads a game its owner's account or bots played. A request waits ${String(analysisQueueExpiryMs / 60_000)} minutes for an analyzer at most.`,
        parameters: [shared.gameId],
        request: {
            body: { required: false, content: { 'application/json': { schema: analysisRequestSchema } } },
        },
        responses: {
            202: {
                description: `The request, queued.`,
                content: { 'application/json': { schema: communityAnalysisSchema } },
            },
            400: shared.badRequest,
            401: shared.signedInUser,
            404: shared.notFound,
            409: {
                description: `The game has a reading pending (analysis_pending) or ${String(analysesPerGame.done)} finished (analysis_full); the caller has requests pending at their cap (pending_limit); the game runs past the turn cap or holds no turn to read (not_analysable); no analyzer may take it (no_analyzer); a player in it opted out (opted_out); or it is live (game_live).`,
                content: { 'application/json': { schema: analysisRequestConflictError } },
            },
            429: {
                description: `The caller's ${String(analysisRequestsPerUserDay)} requests this UTC day are spent (analysis_limit), ${untilMidnight}; ${String(analysisQueueCap)} games wait across the site (analysis_queue_full), retry after ${String(analysisQueueRetryAfterSeconds)} s; or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: analysisRequestQuotaError } },
            },
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'get',
        path: gameAnalysesPath,
        summary: `Read a finished game's readings.`,
        operationId: 'listAnalyses',
        tags: ['Analysis'],
        security: [],
        description: `Community readings, with the lines read so far, and each bot seat's own view: the evaluation and considerations it sent with its moves. A page polls every ${seconds(analysesPollMs)} s while one is queued or running. A game's readings are read at most once every ${seconds(analysesMemoMs)} s, every caller then getting one body.`,
        parameters: [shared.gameId],
        responses: {
            200: { description: `The readings.`, content: { 'application/json': { schema: analysisListSchema } } },
            404: shared.notFound,
            409: {
                description: `The game is live (game_live); its readings open once it ends.`,
                content: { 'application/json': { schema: analysisListConflictError } },
            },
        },
    });
}

function registerTournamentPaths(registry: OpenAPIRegistry, shared: SharedComponents) {
    const tournamentId = registry.registerComponent('parameters', 'TournamentId', {
        name: 'id',
        in: 'path',
        required: true,
        description: `The tournament's id: t_, or d_ for a duel kept from the duels of old.`,
        schema: { type: 'string' },
    }).ref;

    registry.registerPath({
        method: 'get',
        path: tournamentsPath,
        summary: 'List tournaments.',
        operationId: 'listTournaments',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }, {}],
        description: [
            `Up to ${String(tournamentRunningListCap)} running, ${String(tournamentWaitingCap)} waiting, and the latest ${String(tournamentListPastCap)} over: every one, one bot's, an unknown bot answering not_found, the caller's, or tests.`,
            `For a signed-in caller, the list of every bot names under yours their bot in each, and its place.`,
            `A duel's summary carries its pair for its score cells.`,
        ].join(` `),
        request: { query: tournamentListQuerySchema },
        responses: {
            200: { description: `The tournaments.`, content: { 'application/json': { schema: tournamentListSchema } } },
            400: shared.badRequest,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'post',
        path: tournamentsPath,
        summary: 'Set up a duel or a round robin of bots.',
        operationId: 'createTournament',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }],
        description: [
            `The picked bots start at once, never rated: two play a duel, three or more a round robin, a round's pairs at once.`,
            `One person's bots alone make a test.`,
            `A person runs ${String(tournamentLiveCap)} at once and sets up ${String(tournamentDailyCap)} a UTC day; a bot plays in ${String(tournamentPerBotCap)} at once, at most ${String(tournamentBotGamesMax.event)} games in one, ${String(tournamentBotGamesMax.test)} in a test.`,
        ].join(` `),
        request: {
            body: { required: true, content: { 'application/json': { schema: createTournamentRequestSchema } } },
        },
        responses: {
            201: { description: `The new duel or round robin.`, content: { 'application/json': { schema: tournamentDetailSchema } } },
            400: {
                description: [
                    `Validation failed (bad_request); a bot is not open (not_open), though the caller's own bot need not be, takes no duels or round robins from others (duel_refused), excludes the clock (clock_not_accepted), declares no such level (unknown_level), or is busy (bot_busy);`,
                    `more than ${String(Math.max(...tournamentGameCounts))} games a pair outside a test (test_only); a bot past its most games (too_many_games); or the caller runs ${String(tournamentLiveCap)} already (tournament_busy).`,
                ].join(` `),
                content: { 'application/json': { schema: tournamentCreateError } },
            },
            401: shared.signedInUser,
            403: {
                description: `A picked bot is delisted (delisted), or its owner is banned (banned).`,
                content: { 'application/json': { schema: tournamentCreateForbiddenError } },
            },
            404: shared.notFound,
            429: {
                description: `The caller set up ${String(tournamentDailyCap)} duels and round robins this UTC day (daily_tournament_cap), until 00:00 UTC, which Retry-After names; or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: tournamentQuotaError } },
            },
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'get',
        path: tournamentBotsPath,
        summary: `Read the bots' tournament states.`,
        operationId: 'listTournamentBots',
        tags: ['Tournaments'],
        security: [],
        description: `Every listed bot, as the bot list orders it, with its owner's switch for duels by others and the running duels and round robins people set up that it plays in. Read at most once every ${String(tournamentDetailMemoMs / 1000)} s, every caller in that time getting the same body.`,
        responses: {
            200: { description: `The listed bots' tournament states.`, content: { 'application/json': { schema: tournamentBotStatesSchema } } },
        },
    });

    registry.registerPath({
        method: 'get',
        path: tournamentPath,
        summary: 'Read a tournament.',
        operationId: 'getTournament',
        tags: ['Tournaments'],
        security: [],
        description: `Its entries, rounds, standings, live games, the bots games wait for, and a test's estimates. A game waits ${String(presenceGraceMs / 1000)} s for a bot not ready, then scores a no-show; a person's is cut short once fewer than two bots play. A tournament is read at most once every ${String(tournamentDetailMemoMs / 1000)} s, every caller in that time getting the same body.`,
        parameters: [tournamentId],
        responses: {
            200: { description: `The tournament.`, content: { 'application/json': { schema: tournamentDetailSchema } } },
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'get',
        path: tournamentExportPath,
        summary: `Download a tournament's games.`,
        operationId: 'exportTournament',
        tags: ['Tournaments'],
        security: [],
        description: `Every game over so far, at most ${String(tournamentGamesMax)}, numbered in the order played, any game under way left out; games.csv names each game's round, and standings.csv holds the standings as they stand.`,
        parameters: [tournamentId],
        responses: {
            200: shared.gameExport,
            404: shared.notFound,
            429: shared.exportLimited,
        },
    });

    registry.registerPath({
        method: 'post',
        path: tournamentStopPath,
        summary: 'Stop a duel or round robin.',
        operationId: 'stopTournament',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }],
        description: `The person who set a duel or round robin up stops it while it runs: no further game starts, the live ones play on to their results, and the standings stand.`,
        parameters: [tournamentId],
        responses: {
            200: { description: `The tournament, stopped.`, content: { 'application/json': { schema: tournamentDetailSchema } } },
            401: shared.signedInUser,
            403: { description: `The caller did not set it up (not_yours).`, content: { 'application/json': { schema: tournamentStopForbiddenError } } },
            404: shared.notFound,
            409: { description: `It is already over (over).`, content: { 'application/json': { schema: tournamentStopConflictError } } },
        },
    });

    registry.registerPath({
        method: 'post',
        path: tournamentWithdrawPath,
        summary: 'Withdraw a bot from a duel or round robin.',
        operationId: 'withdrawFromTournament',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }],
        description: [
            `A bot's owner takes it out of a running duel or round robin a person set up: its live game plays on, and its games still to come score for its opponents.`,
            `Leaving fewer than two bots to play, as in a duel, cuts it short. The operator's weekly answers not_found.`,
        ].join(` `),
        parameters: [tournamentId],
        request: { body: { required: true, content: { 'application/json': { schema: tournamentWithdrawRequestSchema } } } },
        responses: {
            200: { description: `The tournament, the bot withdrawn.`, content: { 'application/json': { schema: tournamentDetailSchema } } },
            400: shared.badRequest,
            401: shared.signedInUser,
            403: { description: `The caller does not own the bot (not_owner).`, content: { 'application/json': { schema: tournamentWithdrawForbiddenError } } },
            404: shared.notFound,
            409: {
                description: `The tournament is over (over), or the bot plays no further game in it: never in its field, or withdrawn already (not_playing).`,
                content: { 'application/json': { schema: tournamentWithdrawConflictError } },
            },
        },
    });

    registry.registerPath({
        method: 'put',
        path: tournamentEntryPath,
        summary: 'Enter a bot, or replace the entered one.',
        operationId: 'enterTournament',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }],
        description: `While the tournament waits, its owner enters one bot, replacing any bot the owner entered before. From the start to the end an entrant takes no other new game, and challenges to or from it answer bot_busy.`,
        parameters: [tournamentId],
        request: { body: { content: { 'application/json': { schema: tournamentEntryRequestSchema } } } },
        responses: {
            200: { description: `The entry.`, content: { 'application/json': { schema: tournamentEntrySchema } } },
            400: { description: `Validation failed (bad_request), or the bot does not accept the clock (clock_not_accepted).`, content: { 'application/json': { schema: tournamentEntryError } } },
            401: shared.unauthorized,
            403: { description: `The bot is someone else's (not_owner), or it is delisted (delisted).`, content: { 'application/json': { schema: tournamentForbiddenError } } },
            404: shared.notFound,
            409: { description: `The tournament no longer waits (closed), or holds its most entries (full).`, content: { 'application/json': { schema: tournamentClosedError } } },
        },
    });

    registry.registerPath({
        method: 'delete',
        path: tournamentEntryPath,
        summary: `Withdraw the caller's entry.`,
        operationId: 'withdrawTournamentEntry',
        tags: ['Tournaments'],
        security: [{ sessionCookie: [] }],
        description: `While the tournament waits; without an entry nothing changes.`,
        parameters: [tournamentId],
        responses: {
            204: { description: `No bot of the caller is entered.` },
            401: shared.unauthorized,
            404: shared.notFound,
            409: { description: `The tournament no longer waits (closed).`, content: { 'application/json': { schema: tournamentClosedError } } },
        },
    });
}

function registerBotSurface(registry: OpenAPIRegistry, shared: SharedComponents) {
    registry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque',
        description: `A bot token (hxo_...), minted and rotated by the owner on the website.`,
    });

    registry.registerPath({
        method: 'get',
        path: botsPath,
        summary: 'List public bots.',
        operationId: 'listBots',
        tags: ['Directory'],
        security: [],
        description: `The listed roster, ordered by name fold, without pagination. Delisted bots and bots of banned owners are hidden.`,
        parameters: [
            {
                name: 'online',
                in: 'query',
                required: false,
                description: `Present as 1, narrows the roster to bots holding a stream open.`,
                schema: { type: 'string', enum: ['1'] },
            },
            {
                name: 'analyzer',
                in: 'query',
                required: false,
                description: `Present as 1, narrows the roster to bots that declare an analyzer.`,
                schema: { type: 'string', enum: ['1'] },
            },
        ],
        responses: {
            200: {
                description: `The roster.`,
                content: {
                    'application/json': { schema: botListingSchema.array() },
                },
            },
            400: shared.badRequest,
        },
    });

    registry.registerPath({
        method: 'get',
        path: botStreamPath,
        summary: `Open the bot's event stream.`,
        operationId: 'openStream',
        tags: ['Stream'],
        security: [{ bearerAuth: [] }],
        description: `One StreamEvent per line, with a bare newline as keepalive every ${seconds(streamKeepaliveMs)} s. Opening a stream closes the bot's previous one. The bot is online while its stream is open. On open, each active game replays as gameStart, followed on the bot's turn by moveRequest, which is deprecated. Play runs on the engine session that gameStart hands out.`,
        parameters: [
            {
                name: 'open',
                in: 'query',
                required: false,
                description: `Present as 1, the bot is open while the stream is: other bots may challenge it, and players on the website may start games against it, which arrive as gameStart with no challenge. Its owner's games against it, the games of duels and round robins its owner set up, and the weekly tournament's games reach it without open=1.`,
                schema: { type: 'string', enum: ['1'] },
            },
        ],
        responses: {
            200: {
                description: `The event stream, as NDJSON; no line is longer than ${kib(serverLineLimitBytes)} KiB. The server ends a stream that leaves more than ${kib(streamBacklogLimitBytes)} KiB unread. A bot whose stream stays closed for ${seconds(orphanForfeitMs)} s forfeits its live games.`,
                content: {
                    'application/x-ndjson': { schema: streamEventSchema },
                },
            },
            400: shared.badRequest,
            401: shared.botUnauthorized,
            403: shared.banned,
            429: {
                description: `A bot opens at most ${rateText(streamOpenLimit)} (rate_limited), or too many requests; a refused open leaves the open stream alone. Retry after Retry-After.`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: rateLimitedError } },
            },
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'get',
        path: botAccountPath,
        summary: `Read the bot's own account.`,
        operationId: 'getAccount',
        tags: ['Account'],
        security: [{ bearerAuth: [] }],
        description: `The bot's name, rating, and stored declaration; about and repoUrl read as the bot's pages show them.`,
        responses: {
            200: {
                description: `The account.`,
                content: { 'application/json': { schema: botAccountSchema } },
            },
            401: shared.botUnauthorized,
            403: shared.banned,
        },
    });

    registry.registerPath({
        method: 'patch',
        path: botAccountPath,
        summary: `Declare what the bot accepts, its version, its levels, and its analyzer.`,
        operationId: 'updateAccount',
        tags: ['Account'],
        security: [{ bearerAuth: [] }],
        description: [
            `Each present field replaces the stored one; an empty string clears a text field, accepts, levels, and analyzer are replaced whole, and null clears levels or withdraws the analyzer. An unknown key answers 400. A challenge or game outside accepts answers clock_not_accepted.`,
            `Levels picked on the website reach the bot as gameStart.level; challenges and the weekly tournament play the default.`,
        ].join(` `),
        request: {
            body: {
                required: true,
                content: { 'application/json': { schema: accountDeclarationSchema } },
            },
        },
        responses: {
            200: {
                description: `The account after the update.`,
                content: { 'application/json': { schema: botAccountSchema } },
            },
            400: shared.badRequest,
            401: shared.botUnauthorized,
            403: shared.banned,
        },
    });

    registry.registerComponent('securitySchemes', 'gameToken', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque',
        description: `A game token (hgs_...) from a gameStart line.`,
    });

    registry.registerPath({
        method: 'get',
        path: botGameSocketPath,
        summary: 'Open the per-game engine session.',
        operationId: 'openEngineSession',
        tags: ['Engine session'],
        security: [],
        description: [
            `Speaks htttx basic_websocket v1-alpha: the bot dials, then answers each move_request with a move_response of two cells that echoes its request_id, or the answer is dropped.`,
            `The bot declares no capabilities but must handle move_skips, so previous may hold several turns, and request_id.`,
            `A new connection replaces the previous one.`,
            `An illegal move forfeits.`,
        ].join(` `),
        parameters: [
            shared.gameId,
            {
                name: 'token',
                in: 'query',
                required: true,
                description: `The game token from the gameStart line.`,
                schema: { type: 'string' },
            },
        ],
        responses: {
            101: {
                description: [
                    `Switching protocols; the engine session is open.`,
                    `The server first sends setup, whose board holds the origin stone alone.`,
                    `On each of the bot's turns it sends move_request with side, request_id, move_time_limit in seconds when there is a clock, and previous: every turn this connection has not seen, the opening's included, oldest first, as {side, pieces}.`,
                    `Every ${seconds(sessionHeartbeatMs)} s it sends heartbeat, with waiting true while it waits on this bot's move; the bot never answers a heartbeat, and a bot that hears waiting true while it is not working on a move hangs up and redials.`,
                    `No frame the server sends exceeds ${kib(serverLineLimitBytes)} KiB.`,
                    `It closes with 1009 for a bot frame over ${kib(engineFrameLimitBytes)} KiB, with 1008 after more than ${String(engineStrayFrameCap)} frames in one session that answer no outstanding request, a malformed frame, or a protocol violation, and with 1008 when more than ${kib(streamBacklogLimitBytes)} KiB go unread.`,
                    `A close forfeits nothing, but the clock runs; dial again while the game token is valid.`,
                    `A move's evaluation and up to two considerations, when present, are published with the finished game.`,
                ].join(` `),
            },
            404: {
                description: `Unknown game, or a game token that is expired or rotated.`,
                content: { 'application/json': { schema: notFoundError } },
            },
            429: {
                description: `A seat dials at most ${rateText(engineDialLimit)} (rate_limited), or too many requests; a refused dial leaves an open session alone. Retry after Retry-After.`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: rateLimitedError } },
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: botAnalysisSocketPath,
        summary: 'Open the analysis session.',
        operationId: 'openAnalysisSession',
        tags: ['Analysis session'],
        security: [],
        description: [
            `Speaks htttx basic_websocket v1-alpha, the server as client, one position at a time: setup with the position's stones, then move_request with previous empty, side, move_time_limit, and request_id.`,
            `The bot answers move_response with move.evaluation and considerations up to its declared lines, best first.`,
            `interrupt drops the outstanding request unanswered.`,
            `Analysis never counts toward the game cap.`,
        ].join(` `),
        parameters: [
            {
                name: 'token',
                in: 'query',
                required: true,
                description: `The analysis token from the analysisSession line.`,
                schema: { type: 'string' },
            },
        ],
        responses: {
            101: {
                description: [
                    `Switching protocols; the analysis session is open, and a new connection replaces the previous one.`,
                    `A bot with a live game is sent nothing unless it declared whilePlaying, and a game's move request never waits on a reading.`,
                    `An evaluation is of the board after its line: win_in counts turns from that board, its side to move first; a line that completes six is valued for its mover, as win_in 1 with the mover's sign or a heuristic in its favor.`,
                    `A reading fails when the answer comes more than ${seconds(analysisGraceMs)} s past move_time_limit, a line is no legal turn from the position or repeats one, the move carries no evaluation, or an evaluation contradicts the board or passes a win_in of ${String(analysisWinInLimit)} or a heuristic of ${String(analysisHeuristicLimit)} either way.`,
                    `${String(analyzerStrikeLimit)} failures within ${String(analyzerStrikeWindowMs / 60_000)} minutes bench the analyzer for ${String(analyzerBenchMs / 60_000)} minutes.`,
                    `heartbeat, frame sizes, stray frames, and closes are as on the engine session; withdrawing the declaration closes the session.`,
                ].join(` `),
            },
            401: {
                description: `Missing, unknown, expired, or replaced analysis token.`,
                content: { 'application/json': { schema: unauthorizedError } },
            },
            404: {
                description: `The bot no longer declares an analyzer.`,
                content: { 'application/json': { schema: notFoundError } },
            },
            429: {
                description: `A bot dials its analysis session at most ${rateText(engineDialLimit)} (rate_limited), or too many requests; a refused dial leaves an open session alone.`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: rateLimitedError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: botGameResignPath,
        summary: 'Resign a game with its game token.',
        operationId: 'resignBotGame',
        tags: ['Engine session'],
        security: [{ gameToken: [] }],
        description: `The opponent wins with reason surrender; no engine session is needed.`,
        parameters: [shared.gameId],
        responses: {
            200: {
                description: `Resigned.`,
                content: { 'application/json': { schema: okSchema } },
            },
            400: shared.gameOver,
            401: {
                description: 'Missing, unknown, expired, or rotated game token.',
                content: { 'application/json': { schema: unauthorizedError } },
            },
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'post',
        path: botChallengePath,
        summary: 'Challenge another bot.',
        operationId: 'createChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: [
            `The target must hold its stream open with open=1 and accept the clock. A bot plays at most ${String(botConcurrentGameCap)} games at once.`,
            `The target holds at most ${String(challengeInboxCap)} pending challenges, ${String(challengePairPendingCap)} from each challenger. A challenge expires after ${seconds(challengeTtlMs)} s. Resending a requestId answers 200 with the stored challenge.`,
            `Two bots of one owner play each other unrated.`,
        ].join(` `),
        parameters: [
            {
                name: 'name',
                in: 'path',
                required: true,
                description: `The challenged bot's name.`,
                schema: { type: 'string' },
            },
        ],
        request: {
            body: { required: true, content: { 'application/json': { schema: createChallengeRequestSchema } } },
        },
        responses: {
            201: {
                description: `The challenge, pending in the target's inbox.`,
                content: { 'application/json': { schema: challengeSchema } },
            },
            200: {
                description: `The stored challenge for a known requestId, with the status it reached.`,
                content: { 'application/json': { schema: challengeSchema } },
            },
            400: {
                description: `Validation failed or the bot challenged itself (bad_request), the target is not open (not_open) or excludes the clock (clock_not_accepted), a side is at its game cap or playing the weekly tournament (bot_busy), the target's inbox is full (inbox_full), or the challenger already has a challenge pending with the target (challenge_pending).`,
                content: {
                    'application/json': {
                        schema: challengeCreateError,
                    },
                },
            },
            429: {
                description: `Per UTC day a bot sends at most ${String(challengeDailyCap)} challenges (daily_challenge_cap) and plays at most ${String(botDailyCap)} rated bot-vs-bot games (daily_bot_cap), and a pair ${String(pairDailyCap)} (daily_pair_cap), with Retry-After running to 00:00 UTC; or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: challengeQuotaError } },
            },
            401: shared.botUnauthorized,
            403: {
                description: `Either bot is delisted (delisted), or the challenger's owner is banned (banned). own_bot is no longer sent: a challenge between two bots of one owner is played unrated.`,
                content: {
                    'application/json': {
                        schema: challengeForbiddenError,
                    },
                },
            },
            404: shared.notFound,
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeAcceptPath,
        summary: 'Accept a challenge as the challenged bot.',
        operationId: 'acceptChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenged bot may accept. The game starts at once, and both bots receive gameStart.`,
        parameters: [shared.challengeId],
        responses: {
            200: {
                description: `Accepted.`,
                content: { 'application/json': { schema: okSchema } },
            },
            400: {
                description: `The challenged bot is at its game cap, or a side is playing the weekly tournament (bot_busy); the challenge stays pending.`,
                content: {
                    'application/json': {
                        schema: challengeAcceptError,
                    },
                },
            },
            401: shared.botUnauthorized,
            403: shared.banned,
            404: shared.notFound,
            503: shared.paused,
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeDeclinePath,
        summary: 'Decline a challenge as the challenged bot.',
        operationId: 'declineChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenged bot may decline; the challenger receives challengeDeclined.`,
        parameters: [shared.challengeId],
        responses: {
            200: {
                description: 'Declined.',
                content: { 'application/json': { schema: okSchema } },
            },
            401: shared.botUnauthorized,
            403: shared.banned,
            404: shared.notFound,
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeCancelPath,
        summary: 'Cancel a challenge the caller issued.',
        operationId: 'cancelChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenger may cancel; the target receives challengeCanceled.`,
        parameters: [shared.challengeId],
        responses: {
            200: {
                description: 'Canceled.',
                content: { 'application/json': { schema: okSchema } },
            },
            401: shared.botUnauthorized,
            403: shared.banned,
            404: shared.notFound,
        },
    });
}

// Any request may meet a rate limit,
// so an operation without a 429 of its own takes the shared one;
// one with named codes lists rate_limited beside them.
// Any body may pass the size limit.
function limitEveryOperation(registry: OpenAPIRegistry, shared: SharedComponents): void {
    for (const definition of registry.definitions) {
        if (definition.type !== `route`) continue;
        const { request, responses } = definition.route;
        if (!(`429` in responses)) responses[429] = shared.rateLimited;
        if (request?.body !== undefined) responses[413] = shared.payloadTooLarge;
    }
}

/**
 * The definitions behind the bot surface alone: every operation a bot token or
 * game token secures, plus the public bot directory.
 */
export function botSurfaceDefinitions() {
    const registry = new OpenAPIRegistry();
    const shared = registerSharedComponents(registry, `bot`);
    registerBotSurface(registry, shared);
    limitEveryOperation(registry, shared);
    return [...registry.definitions, ...shared.referenced];
}

/**
 * Renders a document as the committed YAML.
 */
export function renderOpenApiYaml(document: unknown) {
    // Sorted keys keep a committed file byte-stable across regenerations.
    // A repeated object, such as a shared $ref, is written out in full rather
    // than as a yaml alias.
    return stringify(document, { sortMapEntries: true, lineWidth: 100, aliasDuplicateObjects: false });
}

export function buildOpenApiDocument() {
    const registry = new OpenAPIRegistry();
    const shared = registerSharedComponents(registry, `site`);
    registerSiteSurface(registry, shared);
    registerBotSurface(registry, shared);
    limitEveryOperation(registry, shared);
    const generator = new OpenApiGeneratorV3([...registry.definitions, ...shared.referenced]);
    return generator.generateDocument({
        openapi: '3.0.3',
        info: { title: siteName, version: apiVersion },
    });
}
