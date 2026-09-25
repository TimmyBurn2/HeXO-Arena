import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { errorBodySchema } from './api';
import {
    accountDeclarationSchema,
    apiVersion,
    badRequestErrorCodes,
    botAccountPath,
    botAccountSchema,
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
    challengeCancelPath,
    challengeCreateErrorCodes,
    challengeDeclinePath,
    challengeForbiddenErrorCodes,
    challengeSchema,
    createBotRequestSchema,
    createChallengeRequestSchema,
    createGameRequestSchema,
    discordCallbackPath,
    discordLoginPath,
    gameCreateErrorCodes,
    gameCreateForbiddenErrorCodes,
    gameMovePath,
    gamePath,
    gameResignPath,
    gameSnapshotSchema,
    gamesPath,
    healthzPath,
    humanMoveRequestSchema,
    leaderboardEntrySchema,
    leaderboardPath,
    notFoundErrorCodes,
    okSchema,
    pausedErrorCodes,
    pausedRetryAfterSeconds,
    sessionCookieName,
    streamEventSchema,
    unauthorizedErrorCodes,
} from './index';

const unauthorized = () => ({
    description: `No session cookie, or the session is expired or unknown.`,
    content: { 'application/json': { schema: errorBodySchema(unauthorizedErrorCodes) } },
});

const notFound = () => ({
    description: `No such bot, or one that is not the caller's to act on; the two are indistinguishable on purpose.`,
    content: { 'application/json': { schema: errorBodySchema(notFoundErrorCodes) } },
});

const botUnauthorized = () => ({
    description: `Missing, unknown, or rotated token.`,
    content: { 'application/json': { schema: errorBodySchema(unauthorizedErrorCodes) } },
});

const botForbidden = () => ({
    description: `The bot's owner is banned; the token answers this until the ban lifts, and dies then.`,
    content: { 'application/json': { schema: errorBodySchema(botForbiddenErrorCodes) } },
});

const badRequest = () => ({
    description: `The request fails validation.`,
    content: { 'application/json': { schema: errorBodySchema(badRequestErrorCodes) } },
});

const paused = () => ({
    description: `The site is paused: nothing new starts, while open streams and live games run on. Retry after the advertised delay.`,
    headers: {
        'Retry-After': {
            description: `Seconds to wait before retrying; ${String(pausedRetryAfterSeconds)} while paused.`,
            schema: { type: 'integer', minimum: 1 },
        },
    } as const,
    content: { 'application/json': { schema: errorBodySchema(pausedErrorCodes) } },
});

// A fresh object per registration: one shared object would serialize as a
// yaml alias.
const gameIdParameter = () =>
    ({
        name: 'gameId',
        in: 'path',
        required: true,
        description: `The game, as carried on gameStart and moveRequest.`,
        schema: { type: 'string' },
    }) as const;

const challengeIdParameter = () =>
    ({
        name: 'challengeId',
        in: 'path',
        required: true,
        description: `The challenge, as carried on its challenge line.`,
        schema: { type: 'string' },
    }) as const;

export function buildOpenApiDocument() {
    const registry = new OpenAPIRegistry();
    registry.registerComponent('securitySchemes', 'sessionCookie', {
        type: 'apiKey',
        in: 'cookie',
        name: sessionCookieName,
        description: `A browser session, set by the Discord OAuth callback and readable only by the server.`,
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
        description: `Mandatory state and nonce, generated per redirect and validated once at the callback.`,
        responses: {
            302: { description: `Redirect to Discord's authorize endpoint.` },
            503: {
                description: `Discord OAuth credentials are not configured.`,
                content: { 'application/json': { schema: errorBodySchema([`oauth_unconfigured`]) } },
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: discordCallbackPath,
        summary: 'Finish Discord OAuth: create the session.',
        operationId: 'discordCallback',
        tags: ['Auth'],
        description: `Identify scope only: the Discord id and username, never an email. On success sets the session cookie and redirects to the app root.`,
        responses: {
            302: { description: `Session cookie set; redirect to /.` },
            400: {
                description: `The state is unknown, expired, or already used.`,
                content: { 'application/json': { schema: errorBodySchema([`bad_state`]) } },
            },
            403: {
                description: `The Discord identity belongs to a banned user; no session is created.`,
                content: { 'application/json': { schema: errorBodySchema([`banned`]) } },
            },
            502: {
                description: `Discord rejected the code or the identity lookup failed.`,
                content: { 'application/json': { schema: errorBodySchema([`discord_error`]) } },
            },
            503: {
                description: `Discord OAuth credentials are not configured.`,
                content: { 'application/json': { schema: errorBodySchema([`oauth_unconfigured`]) } },
            },
        },
    });

    registry.registerComponent('securitySchemes', 'bearerAuth', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque',
        description: `A bot token, Authorization: Bearer hxo_..., minted and rotated by the owner on the website; there is no token endpoint.`,
    });

    registry.registerPath({
        method: 'get',
        path: botsPath,
        summary: 'List public bots.',
        operationId: 'listBots',
        tags: ['Directory'],
        security: [],
        description: `The whole listed roster, ordered by name fold; delisted bots and bots of banned owners are hidden. Hobby scale, no pagination yet. online and openForChallenges are live views of who holds a stream open; the declaration fields appear once the bot declares itself. rating is Glicko-2 in whole points, provisional while the deviation is above 75.`,
        parameters: [
            {
                name: 'online',
                in: 'query',
                required: false,
                description: `Narrows the roster to bots holding a stream open.`,
                schema: { type: 'string', enum: ['1'] },
            },
        ],
        responses: {
            200: {
                description: 'The bot roster.',
                content: {
                    'application/json': { schema: botListingSchema.array() },
                },
            },
            400: badRequest(),
        },
    });

    registry.registerPath({
        method: 'get',
        path: leaderboardPath,
        summary: 'List rankable players by rating.',
        operationId: 'getLeaderboard',
        tags: ['Directory'],
        security: [],
        description: `Players at deviation 75 or below, highest Glicko-2 rating first, ties by name fold; provisional players, banned users, delisted bots, and bots of banned owners never appear. Bots and humans share one pool; hobby scale, no pagination yet.`,
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
            400: badRequest(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: botsPath,
        summary: 'Create a bot owned by the session user.',
        operationId: 'createBot',
        tags: ['Bots'],
        security: [{ sessionCookie: [] }],
        description: `Mints the token exactly once; this response is the only place it ever appears in the clear. Names share one global namespace with users and are immutable.`,
        request: {
            body: { content: { 'application/json': { schema: createBotRequestSchema } } },
        },
        responses: {
            201: {
                description: 'The bot exists; the token will not be shown again.',
                content: { 'application/json': { schema: botWithTokenSchema } },
            },
            400: {
                description: `The name fails the syntax rules or is reserved.`,
                content: {
                    'application/json': { schema: errorBodySchema([`invalid_name`, `name_reserved`]) },
                },
            },
            401: unauthorized(),
            403: {
                description: `The owner already holds the per-user bot cap (3).`,
                content: { 'application/json': { schema: errorBodySchema([`bot_limit`]) } },
            },
            409: {
                description: `The name fold is already taken, by a user or a bot.`,
                content: { 'application/json': { schema: errorBodySchema([`name_taken`]) } },
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
        description: `A bot with rated games is anonymized: its games and every rating they moved stay, it is renamed to a deleted-<n> placeholder, and its name stays reserved. A bot without rated games is deleted outright and its name is freed.`,
        parameters: [
            {
                name: 'name',
                in: 'path',
                required: true,
                description: `Targeting by name is unambiguous: names are immutable and fold-unique.`,
                schema: { type: 'string' },
            },
        ],
        responses: {
            204: { description: 'The bot and its token are gone.' },
            401: unauthorized(),
            404: notFound(),
            409: {
                description: `The bot is seated in a live game; finish or resign it first.`,
                content: { 'application/json': { schema: errorBodySchema(botDeleteConflictErrorCodes) } },
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
        description: `The previous token dies immediately; the response carries the only appearance of the new one.`,
        parameters: [
            {
                name: 'name',
                in: 'path',
                required: true,
                description: `Targeting by name is unambiguous: names are immutable and fold-unique.`,
                schema: { type: 'string' },
            },
        ],
        responses: {
            200: {
                description: 'The fresh token, shown once.',
                content: { 'application/json': { schema: botWithTokenSchema } },
            },
            401: unauthorized(),
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'get',
        path: botStreamPath,
        summary: `Open the bot's event stream.`,
        operationId: 'openStream',
        tags: ['Stream'],
        security: [{ bearerAuth: [] }],
        description: `One JSON object per line, with a bare newline as keepalive every 10 s. One stream per bot: opening closes the previous one. The connection is the bot's presence, so it is online while the stream is held, and open=1 takes games for as long as it lasts. On open, every active game is replayed as a gameStart line followed by a fresh moveRequest when it is the bot's turn; during play, move requests travel on the per-game engine session websocket that gameStart hands out.`,
        parameters: [
            {
                name: 'open',
                in: 'query',
                required: false,
                description: `Present as open=1, the bot accepts challenges while connected.`,
                schema: { type: 'string', enum: ['1'] },
            },
        ],
        responses: {
            200: {
                description: 'The NDJSON event stream.',
                content: {
                    'application/x-ndjson': { schema: streamEventSchema },
                },
            },
            400: badRequest(),
            401: botUnauthorized(),
            403: botForbidden(),
            503: paused(),
        },
    });

    registry.registerPath({
        method: 'get',
        path: botAccountPath,
        summary: `Read the bot's own account.`,
        operationId: 'getAccount',
        tags: ['Account'],
        security: [{ bearerAuth: [] }],
        description: `The bot's name, its Glicko-2 rating in whole points, provisional while the deviation is above 75, and the declaration as stored.`,
        responses: {
            200: {
                description: 'The account as it stands now.',
                content: { 'application/json': { schema: botAccountSchema } },
            },
            401: botUnauthorized(),
            403: botForbidden(),
        },
    });

    registry.registerPath({
        method: 'patch',
        path: botAccountPath,
        summary: `Declare the bot's about, version, repo, and what it accepts.`,
        operationId: 'updateAccount',
        tags: ['Account'],
        security: [{ bearerAuth: [] }],
        description: `Only the process holding the token may promise behaviour, which is why this is the bot's surface and not the owner's. Every field is optional; each present field replaces the stored one, an empty string clears a text field, and accepts replaces wholesale. The declaration narrows open=1: a challenge outside accepts is answered not-open.`,
        request: {
            body: {
                required: true,
                content: { 'application/json': { schema: accountDeclarationSchema } },
            },
        },
        responses: {
            200: {
                description: 'The account as it stands now, the stored declaration included.',
                content: { 'application/json': { schema: botAccountSchema } },
            },
            400: badRequest(),
            401: botUnauthorized(),
            403: botForbidden(),
        },
    });

    registry.registerComponent('securitySchemes', 'gameToken', {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'opaque',
        description: `A short-lived per-game engine-session token from the gameStart line, Authorization: Bearer hgs_...; every replay of gameStart rotates it.`,
    });

    registry.registerPath({
        method: 'post',
        path: gamesPath,
        summary: 'Start a game against a bot.',
        operationId: 'createGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `The bot must be online, open for games, under its concurrent-game cap, and declaring acceptance of the clock; every condition answers with a distinct code so a caller knows what to change. The caller is bounded too: at most three live games at once (human_busy) and sixty seconds between creations (game_cooldown). Colours are drawn at creation, the server places the origin stone and the opening stones itself, and the bot receives its engine-session handoff as a gameStart line on its stream.`,
        request: {
            body: { required: true, content: { 'application/json': { schema: createGameRequestSchema } } },
        },
        responses: {
            201: {
                description: 'The game exists; the response is its snapshot.',
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: `Validation failed, the caller is at the live-game cap (human_busy) or inside the creation cooldown (game_cooldown), or the bot is not taking games (not_open), declines this clock (clock_not_accepted), or is at its concurrent-game cap (bot_busy).`,
                content: {
                    'application/json': {
                        schema: errorBodySchema([...badRequestErrorCodes, ...gameCreateErrorCodes]),
                    },
                },
            },
            401: unauthorized(),
            403: {
                description: `The bot is delisted and takes no new games.`,
                content: { 'application/json': { schema: errorBodySchema(gameCreateForbiddenErrorCodes) } },
            },
            503: paused(),
        },
    });

    registry.registerPath({
        method: 'get',
        path: gamePath,
        summary: `Read a game the caller plays in.`,
        operationId: 'getGameSnapshot',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `Board, turn, and clock in one read; a finished game carries the result instead. Unknown and not-yours answer the same 404 on purpose.`,
        parameters: [gameIdParameter()],
        responses: {
            200: {
                description: 'The game snapshot.',
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            401: unauthorized(),
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: gameMovePath,
        summary: `Play the two placements of the caller's turn.`,
        operationId: 'playHumanMove',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `A move is exactly two placements and applies as one turn; a win can complete on the first placement, and the second is then not applied. An illegal move answers 400 and forfeits nothing: only a bot's illegal engine move forfeits.`,
        parameters: [gameIdParameter()],
        request: {
            body: { required: true, content: { 'application/json': { schema: humanMoveRequestSchema } } },
        },
        responses: {
            200: {
                description: 'The move applied; the response is the snapshot after it.',
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: `Validation failed, or it is not the caller's turn (not_your_turn), a cell is taken (cell_occupied) or out of range (out_of_range), or the game is over (game_over).`,
                content: {
                    'application/json': {
                        schema: errorBodySchema([...badRequestErrorCodes, `not_your_turn`, `cell_occupied`, `out_of_range`, `game_over`]),
                    },
                },
            },
            401: unauthorized(),
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: gameResignPath,
        summary: 'Resign a game the caller plays in.',
        operationId: 'resignHumanGame',
        tags: ['Games'],
        security: [{ sessionCookie: [] }],
        description: `The opponent wins with reason surrender; the response is the finished snapshot.`,
        parameters: [gameIdParameter()],
        responses: {
            200: {
                description: 'The resignation applied.',
                content: { 'application/json': { schema: gameSnapshotSchema } },
            },
            400: {
                description: 'The game is already finished (game_over).',
                content: { 'application/json': { schema: errorBodySchema([`game_over`]) } },
            },
            401: unauthorized(),
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'get',
        path: botGameSocketPath,
        summary: 'Open the per-game engine session.',
        operationId: 'openEngineSession',
        tags: ['Engine session'],
        security: [],
        description: `The htttx basic_websocket protocol with the server in the client role and the bot in the bot role. The token query parameter is the short-lived per-game token from gameStart; every gameStart replay rotates it, and one session per game is enforced, a fresh connection replacing a stale one. On open the server sends the setup packet (the origin stone) and a move_request whenever it is the bot's turn, with every stone placed since the origin carried in previous; heartbeats flow every 10 s. A move_response must echo the outstanding request_id; stale or mismatched answers are dropped, and an illegal move forfeits the game server-side.`,
        parameters: [
            gameIdParameter(),
            {
                name: 'token',
                in: 'query',
                required: true,
                description: `The per-game token carried beside socketUrl on the gameStart line.`,
                schema: { type: 'string' },
            },
        ],
        responses: {
            101: { description: 'Switching protocols; the engine session is open.' },
            404: {
                description: 'Unknown game, or a token that is expired or rotated.',
                content: { 'application/json': { schema: errorBodySchema([`not_found`]) } },
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
        description: `The same short-lived per-game token the websocket takes, presented as a bearer header; resignation needs no live socket, so the websocket stays strictly htttx packets.`,
        parameters: [gameIdParameter()],
        responses: {
            200: {
                description: 'The resignation applied.',
                content: { 'application/json': { schema: okSchema } },
            },
            400: {
                description: 'The game is already finished (game_over).',
                content: { 'application/json': { schema: errorBodySchema([`game_over`]) } },
            },
            401: {
                description: 'Missing, unknown, expired, or rotated game token.',
                content: { 'application/json': { schema: errorBodySchema(unauthorizedErrorCodes) } },
            },
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: botChallengePath,
        summary: 'Challenge another bot.',
        operationId: 'createChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Bot to bot. The target is named by its global name and must be online with open=1 and inside what it declared itself willing to play; a challenge outside accepts answers clock_not_accepted exactly like the human surface. firstPlayer names who takes the first player turn (the origin stone is automatic, so the first turn is the first thing a player does); random draws at accept. The challenger's owner may not own the target (own_bot), both sides must be under their concurrent-game caps, the target's pending inbox holds at most 10, and daily caps bound bot-vs-bot games: 20 per pair and 100 per bot, counted over UTC days from the game log. A challenge lives 60 s, then expires and reaches both sides as challengeCanceled. Creation is idempotent on requestId, scoped to the challenger: resending the same id answers 200 with the stored challenge and whatever status it reached, never a second inbox entry.`,
        parameters: [
            {
                name: 'name',
                in: 'path',
                required: true,
                description: `The challenged bot, by its globally unique name.`,
                schema: { type: 'string' },
            },
        ],
        request: {
            body: { required: true, content: { 'application/json': { schema: createChallengeRequestSchema } } },
        },
        responses: {
            201: {
                description: 'The challenge exists and waits in the target\'s inbox.',
                content: { 'application/json': { schema: challengeSchema } },
            },
            200: {
                description: 'The requestId is known; the stored challenge, with the status it reached.',
                content: { 'application/json': { schema: challengeSchema } },
            },
            400: {
                description: `Validation failed, or a gate refused: the target is not taking games (not_open), declines this clock (clock_not_accepted), a side is at its concurrent-game cap (bot_busy), the target's inbox is full (inbox_full), the pair hit its daily cap (daily_pair_cap), or a bot hit its daily bot-vs-bot cap (daily_bot_cap).`,
                content: {
                    'application/json': {
                        schema: errorBodySchema([...badRequestErrorCodes, ...challengeCreateErrorCodes]),
                    },
                },
            },
            401: botUnauthorized(),
            403: {
                description: `The challenger's owner also owns the target (own_bot), either bot is delisted (delisted), or the challenger's owner is banned (banned).`,
                content: {
                    'application/json': {
                        schema: errorBodySchema([...botForbiddenErrorCodes, ...challengeForbiddenErrorCodes]),
                    },
                },
            },
            404: notFound(),
            503: paused(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeAcceptPath,
        summary: 'Accept a challenge as the challenged bot.',
        operationId: 'acceptChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenged bot may accept. The one gate that can have moved since creation is re-checked: if the target is now at its concurrent-game cap the answer is bot_busy and the challenge stays pending. On acceptance a normal game starts with both sides driven through their engine sessions, colors per firstPlayer, and both bots receive a gameStart line; the game lands in the same log as human games.`,
        parameters: [challengeIdParameter()],
        responses: {
            200: {
                description: 'Accepted; the game arrives as gameStart on both streams.',
                content: { 'application/json': { schema: okSchema } },
            },
            400: {
                description: 'The target is at its concurrent-game cap (bot_busy); the challenge stays pending.',
                content: {
                    'application/json': {
                        schema: errorBodySchema([...badRequestErrorCodes, ...challengeAcceptErrorCodes]),
                    },
                },
            },
            401: botUnauthorized(),
            403: botForbidden(),
            404: notFound(),
            503: paused(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeDeclinePath,
        summary: 'Decline a challenge as the challenged bot.',
        operationId: 'declineChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenged bot may decline. The challenger learns of it as a challengeDeclined line on its stream.`,
        parameters: [challengeIdParameter()],
        responses: {
            200: {
                description: 'Declined.',
                content: { 'application/json': { schema: okSchema } },
            },
            401: botUnauthorized(),
            403: botForbidden(),
            404: notFound(),
        },
    });

    registry.registerPath({
        method: 'post',
        path: challengeCancelPath,
        summary: 'Cancel a challenge the caller issued.',
        operationId: 'cancelChallenge',
        tags: ['Challenge'],
        security: [{ bearerAuth: [] }],
        description: `Only the challenger may cancel. The target learns of it as a challengeCanceled line with reason canceled; expiry carries reason expired and reaches both sides.`,
        parameters: [challengeIdParameter()],
        responses: {
            200: {
                description: 'Canceled.',
                content: { 'application/json': { schema: okSchema } },
            },
            401: botUnauthorized(),
            403: botForbidden(),
            404: notFound(),
        },
    });

    const generator = new OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.3',
        info: { title: 'hexarena', version: apiVersion },
    });
}
