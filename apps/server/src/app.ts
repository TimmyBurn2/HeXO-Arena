import {
    botsPath,
    createBotRequestSchema,
    devLoginPath,
    discordCallbackPath,
    discordLoginPath,
    healthzPath,
    isReservedName,
    nameKeyOf,
    nameSyntaxSchema,
    sessionCookieName,
} from '@hexarena/contract';
import cookiePlugin from '@fastify/cookie';
import { z } from 'zod';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createBot, deleteBot, listBots, rotateBotToken } from './bots';
import { createQuery, type Query, type Sqlite } from './db';
import type { DiscordOAuth } from './discord';
import { consumeOAuthState, createOAuthState } from './oauth-state';
import { createSession, findSessionUser, sessionCookieMaxAge } from './sessions';
import {
    createUserWithDerivedName,
    createUserWithExactName,
    findUserByDiscordId,
} from './users';

export interface AppDeps {
    sqlite: Sqlite;
    discord: DiscordOAuth | null;
    secureCookies: boolean;
    devLogin: boolean;
}

const callbackQuerySchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
});

const devLoginRequestSchema = z.object({ name: nameSyntaxSchema });

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
    const app = Fastify({ logger: true });
    const query = createQuery(deps.sqlite);
    await app.register(cookiePlugin);

    if (deps.devLogin) {
        app.post(devLoginPath, async (request, reply) => {
            const parsed = devLoginRequestSchema.safeParse(request.body);
            if (!parsed.success) {
                return reply
                    .code(400)
                    .send({ error: `the name fails the syntax rules`, code: `invalid_name` });
            }
            if (isReservedName(parsed.data.name)) {
                return reply
                    .code(400)
                    .send({ error: `the name is reserved`, code: `name_reserved` });
            }
            // The synthetic discord id keys on the fold, so logging in
            // twice with the same name resumes the same identity.
            const discordId = `dev:${nameKeyOf(parsed.data.name)}`;
            const user =
                findUserByDiscordId(query, discordId) ??
                createUserWithExactName(query, discordId, parsed.data.name);
            if (user === `name_taken`) {
                return reply
                    .code(409)
                    .send({ error: `the name fold is already taken`, code: `name_taken` });
            }
            const token = createSession(query, user.id);
            setSessionCookie(reply, token, deps.secureCookies);
            return reply.code(200).send({ name: user.name });
        });
    }

    app.get(healthzPath, async (_request, reply) => {
        // Liveness only: no db probe, no version, no uptime (ADMIN.md
        // section 3), so the endpoint leaks nothing.
        reply.code(200).send();
    });

    app.get(discordLoginPath, async (_request, reply) => {
        if (!deps.discord) {
            return reply.code(503).send({ error: `discord oauth is not configured`, code: `oauth_unconfigured` });
        }
        return reply.redirect(deps.discord.authorizeUrl(createOAuthState(query)));
    });

    app.get(discordCallbackPath, async (request, reply) => {
        if (!deps.discord) {
            return reply.code(503).send({ error: `discord oauth is not configured`, code: `oauth_unconfigured` });
        }
        const parsed = callbackQuerySchema.safeParse(request.query);
        if (!parsed.success) {
            return reply.code(400).send({ error: `missing or malformed oauth parameters`, code: `bad_state` });
        }
        if (!consumeOAuthState(query, parsed.data.state)) {
            return reply.code(400).send({ error: `unknown, expired, or used state`, code: `bad_state` });
        }
        const identity = await deps.discord.exchange(parsed.data.code).catch(() => null);
        if (!identity) {
            return reply.code(502).send({ error: `discord rejected the exchange`, code: `discord_error` });
        }
        const user =
            findUserByDiscordId(query, identity.id) ??
            createUserWithDerivedName(query, identity.id, identity.username);
        const token = createSession(query, user.id);
        setSessionCookie(reply, token, deps.secureCookies);
        return reply.redirect(`/`);
    });

    app.get(botsPath, async (_request, reply) => {
        return reply.code(200).send(listBots(query));
    });

    app.post(botsPath, async (request, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        const parsed = createBotRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply
                .code(400)
                .send({ error: `the name fails the syntax rules`, code: `invalid_name` });
        }
        if (isReservedName(parsed.data.name)) {
            return reply.code(400).send({ error: `the name is reserved`, code: `name_reserved` });
        }
        const result = createBot(query, user.id, parsed.data.name);
        if (result.kind === `name_taken`) {
            return reply
                .code(409)
                .send({ error: `the name fold is already taken`, code: `name_taken` });
        }
        if (result.kind === `bot_limit`) {
            return reply.code(403).send({
                error: `the owner already holds the bot cap`,
                code: `bot_limit`,
            });
        }
        return reply.code(201).send({ name: result.name, token: result.token });
    });

    app.delete(`/api/bots/:name`, async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        const name = request.params.name;
        if (!nameSyntaxSchema.safeParse(name).success) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        if (!deleteBot(query, user.id, nameKeyOf(name))) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        return reply.code(204).send();
    });

    app.post(`/api/bots/:name/token`, async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        const name = request.params.name;
        if (!nameSyntaxSchema.safeParse(name).success) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        const rotated = rotateBotToken(query, user.id, nameKeyOf(name));
        if (!rotated) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        return reply.code(200).send(rotated);
    });

    return app;
}

function sessionUser(query: Query, request: FastifyRequest): { id: string; name: string } | null {
    const token = request.cookies[sessionCookieName];
    return token ? findSessionUser(query, token) : null;
}

function setSessionCookie(reply: FastifyReply, token: string, secure: boolean): void {
    reply.setCookie(sessionCookieName, token, {
        path: `/`,
        httpOnly: true,
        sameSite: `lax`,
        secure,
        maxAge: sessionCookieMaxAge,
    });
}
