import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { errorBodySchema } from './api';
import {
    accountDeclarationSchema,
    apiVersion,
    badRequestErrorCodes,
    botAccountPath,
    botAccountSchema,
    botForbiddenErrorCodes,
    botListingSchema,
    botStreamPath,
    botTokenPath,
    botWithTokenSchema,
    botsPath,
    botPath,
    createBotRequestSchema,
    discordCallbackPath,
    discordLoginPath,
    healthzPath,
    notFoundErrorCodes,
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
    description: `The bot's owner is banned.`,
    content: { 'application/json': { schema: errorBodySchema(botForbiddenErrorCodes) } },
});

const badRequest = () => ({
    description: `The request fails validation.`,
    content: { 'application/json': { schema: errorBodySchema(badRequestErrorCodes) } },
});

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
        // No response content: the probe carries zero information.
        responses: {
            200: { description: 'The process is up.' },
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
        description: `The whole roster, ordered by name fold; hobby scale, no pagination yet. online and openForChallenges are live views of who holds a stream open; the declaration fields appear once the bot declares itself.`,
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
        description: `One JSON object per line, with a bare newline as keepalive every 10 s. One stream per bot: opening closes the previous one. The connection is the bot's presence, so it is online while the stream is held, and open=1 takes challenges for as long as it lasts. On open, every active game is replayed as a gameStart line followed by a fresh moveRequest when it is the bot's turn.`,
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
                description: 'The stored declaration, as the account stands now.',
                content: { 'application/json': { schema: botAccountSchema } },
            },
            400: badRequest(),
            401: botUnauthorized(),
            403: botForbidden(),
        },
    });

    const generator = new OpenApiGeneratorV3(registry.definitions);
    return generator.generateDocument({
        openapi: '3.0.3',
        info: { title: 'hexarena', version: apiVersion },
    });
}
