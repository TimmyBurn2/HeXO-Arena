import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { stringify } from 'yaml';
import type { ZodType } from 'zod';
import { errorBodySchema } from './api';
import {
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
    humanConcurrentGameCap,
    humanGameCooldownSeconds,
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
    tournamentDetailMemoMs,
    tournamentDetailSchema,
    tournamentEntryPath,
    tournamentEntryRequestSchema,
    tournamentEntrySchema,
    tournamentListPastCap,
    tournamentListSchema,
    tournamentPath,
    tournamentPresenceGraceMs,
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
        banned: response(
            `Banned`,
            `The bot's owner is banned; after the ban lifts, the owner must rotate the token.`,
            bannedError,
        ),
        gameCreateForbidden: response(`GameCreateForbidden`, `The bot is the caller's own (own_bot), or it is delisted and takes no new games (delisted).`, gameCreateForbiddenError),
        notFound: response(
            `NotFound`,
            `The target does not exist or is not the caller's to act on.`,
            notFoundError,
        ),
        badRequest: response(`BadRequest`, `The request fails validation.`, badRequestError),
        gameOver: response(`GameOver`, `The game is already finished (game_over).`, gameOverError),
        paused: registry.registerComponent('responses', 'Paused', {
            description: `The site is paused: no new stream, challenge, or game starts, and open streams and live games continue. Retry after Retry-After.`,
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
        method: 'post',
        path: gamesPath,
        summary: 'Start a game against a bot.',
        operationId: 'createGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `The bot must hold its stream open with open=1, have fewer than ${String(botConcurrentGameCap)} live games, and accept the clock. The caller, a user or guest, may hold ${String(humanConcurrentGameCap)} live games and create one every ${String(humanGameCooldownSeconds)} s. The server draws sides and places the opening; the bot receives gameStart. A game against a guest is unrated.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: createGameRequestSchema } } },
        },
        responses: {
            201: {
                description: `The new game's snapshot.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: `Validation failed (bad_request), the caller is at its live-game cap (human_busy), or the bot is not open (not_open), excludes the clock (clock_not_accepted), or is at its game cap or playing a tournament (bot_busy).`,
                content: {
                    'application/json': {
                        schema: gameCreateError,
                    },
                },
            },
            401: shared.unauthorized,
            403: shared.gameCreateForbidden,
            429: {
                description: `The caller is inside the creation cooldown (game_cooldown); or a signed-in caller has played this bot ${String(pairDailyCap)} times this UTC day (daily_pair_cap), until 00:00 UTC; Retry-After says how long either has left; or too many requests (rate_limited).`,
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
        description: `Games in progress, newest first, at most ${String(liveGameListCap)}, without pagination. Guest games are listed; finished games never are. The list is read at most once every ${seconds(liveGameListMemoMs)} s, and every caller in that time gets the same body.`,
        responses: {
            200: {
                description: `The live games.`,
                content: { 'application/json': { schema: liveGameEntrySchema.array() } },
            },
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

function registerTournamentPaths(registry: OpenAPIRegistry, shared: SharedComponents) {
    const tournamentId = registry.registerComponent('parameters', 'TournamentId', {
        name: 'id',
        in: 'path',
        required: true,
        description: `The tournament's id.`,
        schema: { type: 'string' },
    }).ref;

    registry.registerPath({
        method: 'get',
        path: tournamentsPath,
        summary: 'List tournaments.',
        operationId: 'listTournaments',
        tags: ['Tournaments'],
        security: [],
        description: `The running tournament, up to ${String(tournamentWaitingCap)} waiting, and the latest ${String(tournamentListPastCap)} over. The operator schedules each one: a paired round robin of bots, one per owner.`,
        responses: {
            200: { description: `The tournaments.`, content: { 'application/json': { schema: tournamentListSchema } } },
        },
    });

    registry.registerPath({
        method: 'get',
        path: tournamentPath,
        summary: 'Read a tournament.',
        operationId: 'getTournament',
        tags: ['Tournaments'],
        security: [],
        description: `Its entries, rounds, standings, and live games. Each pairing plays one opening twice, sides swapped, one game after the other; a game waits ${String(tournamentPresenceGraceMs / 1000)} s for a bot that is not connected. A tournament is read at most once every ${String(tournamentDetailMemoMs / 1000)} s, every caller in that time getting the same body.`,
        parameters: [tournamentId],
        responses: {
            200: { description: `The tournament.`, content: { 'application/json': { schema: tournamentDetailSchema } } },
            404: shared.notFound,
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
        description: `One StreamEvent per line, with a bare newline as keepalive every ${seconds(streamKeepaliveMs)} s. Opening a stream closes the bot's previous one. The bot is online while its stream is open. On open, each active game replays as gameStart, followed by moveRequest on the bot's turn. Play runs on the engine session that gameStart hands out.`,
        parameters: [
            {
                name: 'open',
                in: 'query',
                required: false,
                description: `Present as 1, the bot is open while the stream is: other bots may challenge it, and players on the website may start games against it, which arrive as gameStart with no challenge.`,
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
        description: `The bot's name, rating, and stored declaration.`,
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
        summary: `Declare the bot's about, version, repo, and what it accepts.`,
        operationId: 'updateAccount',
        tags: ['Account'],
        security: [{ bearerAuth: [] }],
        description: `Each present field replaces the stored one; an empty string clears a text field, and accepts is replaced whole. An unknown key answers 400. A challenge or game outside accepts answers clock_not_accepted.`,
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
        description: `The target must hold its stream open with open=1 and accept the clock. A bot plays at most ${String(botConcurrentGameCap)} games at once. The target holds at most ${String(challengeInboxCap)} pending challenges, ${String(challengePairPendingCap)} from each challenger. A challenge expires after ${seconds(challengeTtlMs)} s. Resending a requestId answers 200 with the stored challenge.`,
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
                description: `Validation failed (bad_request), the target is not open (not_open) or excludes the clock (clock_not_accepted), a side is at its game cap or playing a tournament (bot_busy), the target's inbox is full (inbox_full), or the challenger already has a challenge pending with the target (challenge_pending).`,
                content: {
                    'application/json': {
                        schema: challengeCreateError,
                    },
                },
            },
            429: {
                description: `Per UTC day a bot sends at most ${String(challengeDailyCap)} challenges (daily_challenge_cap) and plays at most ${String(botDailyCap)} bot-vs-bot games (daily_bot_cap), and a pair ${String(pairDailyCap)} (daily_pair_cap), with Retry-After running to 00:00 UTC; or too many requests (rate_limited).`,
                headers: { 'Retry-After': shared.retryAfter },
                content: { 'application/json': { schema: challengeQuotaError } },
            },
            401: shared.botUnauthorized,
            403: {
                description: `The challenger's owner owns the target (own_bot), either bot is delisted (delisted), or the challenger's owner is banned (banned).`,
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
                description: `The challenged bot is at its game cap, or a side is playing a tournament (bot_busy); the challenge stays pending.`,
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
