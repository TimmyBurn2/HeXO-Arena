import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { stringify } from 'yaml';
import type { ZodType } from 'zod';
import { errorBodySchema } from './api';
import {
    accountDeclarationSchema,
    apiVersion,
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
    createBotRequestSchema,
    createChallengeRequestSchema,
    createGameRequestSchema,
    discordCallbackPath,
    discordLoginPath,
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
    humanMoveRequestSchema,
    leaderboardEntrySchema,
    leaderboardPath,
    liveGameEntrySchema,
    liveGameListCap,
    notFoundErrorCodes,
    okSchema,
    pairDailyCap,
    pausedErrorCodes,
    pausedRetryAfterSeconds,
    rankableDeviation,
    sessionCookieName,
    sessionHeartbeatMs,
    siteName,
    siteWatcherCap,
    streamEventSchema,
    streamKeepaliveMs,
    unauthorizedErrorCodes,
    watcherLimitErrorCodes,
    watcherRetryAfterSeconds,
} from './index';

const seconds = (ms: number) => String(ms / 1000);

// Every other component is named by .meta({ id }) where its schema is
// defined, so each use renders as a $ref to one definition.
const badRequestError = errorBodySchema(badRequestErrorCodes).meta({ id: `BadRequestError` });
const unauthorizedError = errorBodySchema(unauthorizedErrorCodes).meta({ id: `UnauthorizedError` });
const notFoundError = errorBodySchema(notFoundErrorCodes).meta({ id: `NotFoundError` });
const bannedError = errorBodySchema(botForbiddenErrorCodes).meta({ id: `BannedError` });
const pausedError = errorBodySchema(pausedErrorCodes).meta({ id: `PausedError` });
const oauthUnconfiguredError = errorBodySchema([`oauth_unconfigured`]).meta({ id: `OAuthUnconfiguredError` });
const badStateError = errorBodySchema([`bad_state`]).meta({ id: `BadStateError` });
const discordError = errorBodySchema([`discord_error`]).meta({ id: `DiscordError` });
const signedInError = errorBodySchema(guestConflictErrorCodes).meta({ id: `SignedInError` });
const guestLimitError = errorBodySchema(guestLimitErrorCodes).meta({ id: `GuestLimitError` });
const watcherLimitError = errorBodySchema(watcherLimitErrorCodes).meta({ id: `WatcherLimitError` });
const botNameError = errorBodySchema([`invalid_name`, `name_reserved`]).meta({ id: `BotNameError` });
const botLimitError = errorBodySchema([`bot_limit`]).meta({ id: `BotLimitError` });
const nameTakenError = errorBodySchema([`name_taken`]).meta({ id: `NameTakenError` });
const inGameError = errorBodySchema(botDeleteConflictErrorCodes).meta({ id: `InGameError` });
const gameCreateError = errorBodySchema([...badRequestErrorCodes, ...gameCreateErrorCodes]).meta({
    id: `GameCreateError`,
});
const delistedError = errorBodySchema(gameCreateForbiddenErrorCodes).meta({ id: `DelistedError` });
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
function registerSharedComponents(registry: OpenAPIRegistry) {
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
        delisted: response(`Delisted`, `The bot is delisted and takes no new games.`, delistedError),
        notFound: response(
            `NotFound`,
            `The target does not exist or is not the caller's to act on.`,
            notFoundError,
        ),
        badRequest: response(`BadRequest`, `The request fails validation.`, badRequestError),
        gameOver: response(`GameOver`, `The game is already finished (game_over).`, gameOverError),
        oauthUnconfigured: response(
            `OAuthUnconfigured`,
            `Discord OAuth credentials are not configured.`,
            oauthUnconfiguredError,
        ),
        paused: registry.registerComponent('responses', 'Paused', {
            description: `The site is paused: nothing new starts, while open streams and live games run on. Retry after ${String(pausedRetryAfterSeconds)} s.`,
            headers: { 'Retry-After': retryAfter },
            content: json(pausedError),
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
        name: sessionCookieName,
        description: `An HttpOnly session cookie, set by the Discord OAuth callback or the guest route.`,
    });

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
        description: `Each redirect carries a fresh state and nonce, valid once at the callback.`,
        responses: {
            302: { description: `Redirect to Discord's authorize endpoint.` },
            503: shared.oauthUnconfigured,
        },
    });

    registry.registerPath({
        method: 'get',
        path: discordCallbackPath,
        summary: 'Finish Discord OAuth: create the session.',
        operationId: 'discordCallback',
        tags: ['Auth'],
        description: `Requests the identify scope only: the Discord id and username.`,
        responses: {
            302: { description: `The session cookie is set; redirect to /.` },
            400: {
                description: `The state is unknown, expired, or already used.`,
                content: { 'application/json': { schema: badStateError } },
            },
            403: {
                description: `The Discord identity belongs to a banned user; no session is created.`,
                content: { 'application/json': { schema: bannedError } },
            },
            502: {
                description: `Discord rejected the code or the identity lookup failed.`,
                content: { 'application/json': { schema: discordError } },
            },
            503: shared.oauthUnconfigured,
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
        method: 'post',
        path: guestPath,
        summary: 'Start an anonymous guest session.',
        operationId: 'startGuest',
        tags: ['Auth'],
        security: [{ sessionCookie: [] }, {}],
        description: `The session lives in server memory only and ends at sign-out, a Discord sign-in, or a restart. It also ends after ${String(guestIdleSeconds / 3600)} h without a request, unless it sits in a live game. Every guest game is unrated.`,
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
                description: `The global guest cap is full; retry after ${String(guestRetryAfterSeconds)} s.`,
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
        description: `Rankable players, highest rating first, ties by name fold, without pagination. A player is rankable at a rating deviation of ${String(rankableDeviation)} or below. Banned users, delisted bots, and bots of banned owners never appear. Bots and humans share one rating pool.`,
        parameters: [
            {
                name: 'kind',
                in: 'query',
                required: false,
                description: `Narrows the board to bots or humans; all when absent.`,
                schema: { type: 'string', enum: ['bots', 'humans', 'all'] },
            },
        ],
        responses: {
            200: {
                description: 'The board.',
                content: {
                    'application/json': { schema: leaderboardEntrySchema.array() },
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
        description: `A bot with rated games is anonymized: it becomes a deleted-<n> placeholder, its games and ratings stay, and its name stays reserved. A bot without rated games is deleted and its name freed.`,
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
                description: `Validation failed (bad_request), the caller is at its live-game cap (human_busy) or inside the creation cooldown (game_cooldown), or the bot is not open (not_open), excludes the clock (clock_not_accepted), or is at its game cap (bot_busy).`,
                content: {
                    'application/json': {
                        schema: gameCreateError,
                    },
                },
            },
            401: shared.unauthorized,
            403: shared.delisted,
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
        description: `Games in progress, newest first, at most ${String(liveGameListCap)}, without pagination. Guest games are listed; finished games never are.`,
        responses: {
            200: {
                description: `The live games.`,
                content: { 'application/json': { schema: liveGameEntrySchema.array() } },
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: gamePath,
        summary: `Read any game.`,
        operationId: 'getGameSnapshot',
        tags: ['Games'],
        security: [{ sessionCookie: [] }, {}],
        description: `Board, turn, and clock in one read; a finished game carries its result. Anyone may read a game, a guest's while the guest's session lives.`,
        parameters: [shared.gameId],
        responses: {
            200: {
                description: `The game's snapshot.`,
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            404: shared.notFound,
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
                description: `The event stream.`,
                content: { 'text/event-stream': { schema: gameEventSchema } },
            },
            404: shared.notFound,
            429: {
                description: `Watchers without a seat are capped at ${String(gameWatcherCap)} per game and ${String(siteWatcherCap)} in total; retry after ${String(watcherRetryAfterSeconds)} s. A seated caller is never refused.`,
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
                description: `Present as 1, the bot takes challenges and games while the stream is open.`,
                schema: { type: 'string', enum: ['1'] },
            },
        ],
        responses: {
            200: {
                description: `The event stream, as NDJSON.`,
                content: {
                    'application/x-ndjson': { schema: streamEventSchema },
                },
            },
            400: shared.badRequest,
            401: shared.botUnauthorized,
            403: shared.banned,
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
        description: `Speaks htttx basic_websocket v1-alpha, the server as client and the bot as bot. The bot must support the move_skips and request_id capabilities. A new connection replaces the previous one. Each move_request lists in previous only the turns this connection has not seen. Heartbeats come every ${seconds(sessionHeartbeatMs)} s. A move_response must echo request_id, or it is dropped. An illegal move forfeits.`,
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
            101: { description: 'Switching protocols; the engine session is open.' },
            404: {
                description: `Unknown game, or a game token that is expired or rotated.`,
                content: { 'application/json': { schema: notFoundError } },
            },
        },
    });

    registry.registerPath({
        method: 'post',
        path: botGameResignPath,
        summary: 'Resign a game over the engine-session token.',
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
        description: `The target must hold its stream open with open=1 and accept the clock. A bot plays at most ${String(botConcurrentGameCap)} games at once. Per UTC day, a bot plays at most ${String(botDailyCap)} bot-vs-bot games, and a pair ${String(pairDailyCap)}. The target holds at most ${String(challengeInboxCap)} pending challenges. A challenge expires after ${seconds(challengeTtlMs)} s. Resending a requestId answers 200 with the stored challenge.`,
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
                description: `Validation failed (bad_request), the target is not open (not_open) or excludes the clock (clock_not_accepted), a side is at its game cap (bot_busy), the target's inbox is full (inbox_full), or the pair (daily_pair_cap) or a bot (daily_bot_cap) is at its daily cap.`,
                content: {
                    'application/json': {
                        schema: challengeCreateError,
                    },
                },
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
                description: `The challenged bot is at its game cap (bot_busy); the challenge stays pending.`,
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

/**
 * The definitions behind the bot surface alone: every operation a bot token or
 * game token secures, plus the public bot directory.
 */
export function botSurfaceDefinitions() {
    const registry = new OpenAPIRegistry();
    const shared = registerSharedComponents(registry);
    registerBotSurface(registry, shared);
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
    const shared = registerSharedComponents(registry);
    registerSiteSurface(registry, shared);
    registerBotSurface(registry, shared);
    const generator = new OpenApiGeneratorV3([...registry.definitions, ...shared.referenced]);
    return generator.generateDocument({
        openapi: '3.0.3',
        info: { title: siteName, version: apiVersion },
    });
}
