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
import websocketPlugin from '@fastify/websocket';
import cookiePlugin from '@fastify/cookie';
import { z } from 'zod';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import { createAdminHandler } from './admin-ops';
import type { AdminHandler } from './admin-socket';
import { createBot, rotateBotToken } from './bots';
import { registerBotApi } from './bot-api';
import { registerChallengeApi } from './challenge-api';
import { ChallengeRegistry, challengeTtlSeconds } from './challenge-registry';
import { expireStaleChallenges } from './challenge-store';
import { createQuery, type Sqlite } from './db';
import { abortUnfinishedGames } from './game-store';
import { engineFrameLimitBytes, registerGameApi } from './game-api';
import { GameRegistry, wirePresence } from './game-registry';
import { registerLeaderboardApi } from './leaderboard-api';
import type { DiscordOAuth } from './discord';
import { drain } from './drain';
import { deleteBotByPolicy, ownedBotId } from './moderation';
import { consumeOAuthState, createOAuthState } from './oauth-state';
import type { PresenceRegistry } from './presence';
import { createSession, sessionCookieMaxAge, sessionUser } from './sessions';
import { beginGeneration, StartGate } from './site-state';
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
    presence: PresenceRegistry;
    // Stamped on every audit row; one operator today, a named moderator
    // once there is more than one.
    adminActor: string;
    random?: () => number;
    logger?: FastifyServerOptions[`logger`];
}

export interface BuiltApp {
    app: FastifyInstance;
    admin: AdminHandler;
    drain: (graceMs: number) => Promise<number>;
}

const callbackQuerySchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
});

const devLoginRequestSchema = z.object({ name: nameSyntaxSchema });

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
    const app = Fastify({ logger: deps.logger ?? true });
    const query = createQuery(deps.sqlite);
    // A process serves only games it created: whatever an earlier process
    // left unfinished is closed here, before any route can reach it.
    const generation = beginGeneration(query);
    abortUnfinishedGames(query);
    expireStaleChallenges(query, challengeTtlSeconds);
    await app.register(cookiePlugin);
    await app.register(websocketPlugin, { options: { maxPayload: engineFrameLimitBytes } });
    const presence = deps.presence;
    const gate = new StartGate(query);
    const games = new GameRegistry(
        deps.random === undefined ? { query, presence, generation } : { query, presence, generation, random: deps.random },
    );
    const challenges = new ChallengeRegistry({ query, presence, games });
    wirePresence(presence, games);
    // Challenge lines lead the replay: they wait on a TTL that the games,
    // with their own clocks and sessions, do not.
    const gameReplay = presence.replay;
    presence.replay = (botId) => [...challenges.replayForBot(botId), ...gameReplay(botId)];
    app.addHook(`onClose`, () => {
        challenges.stop();
        games.stop();
    });
    registerBotApi(app, { query, presence, gate });
    registerChallengeApi(app, { query, presence, games, challenges, gate });
    registerGameApi(app, { query, presence, games, gate });
    registerLeaderboardApi(app, { query });
    const admin = createAdminHandler({ query, presence, games, challenges, actor: deps.adminActor });

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
            if (user.banned) return sendBanned(reply);
            const token = createSession(query, user.id);
            setSessionCookie(reply, token, deps.secureCookies);
            return reply.code(200).send({ name: user.name });
        });
    }

    app.get(healthzPath, async (_request, reply) => {
        // One bit: up and serving, or up and refusing new starts, which
        // uptime monitors read as the pause signal.
        // No version, no uptime, nothing else.
        reply.code(gate.closed() ? 503 : 200).send();
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
        if (user.banned) return sendBanned(reply);
        const token = createSession(query, user.id);
        setSessionCookie(reply, token, deps.secureCookies);
        return reply.redirect(`/`);
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
        const botId = ownedBotId(query, user.id, nameKeyOf(name));
        if (botId === undefined) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        if (games.activeGameCount(botId) > 0) {
            return reply.code(409).send({ error: `the bot is in a live game`, code: `in_game` });
        }
        presence.close(botId);
        challenges.withdrawFor(botId);
        query.transaction((tx) => deleteBotByPolicy(tx, botId));
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

    return { app, admin, drain: (graceMs) => drain({ query, gate, games, generation }, graceMs) };
}

// A banned identity gets the defined refusal instead of a session.
function sendBanned(reply: FastifyReply): FastifyReply {
    return reply.code(403).send({ error: `the account is banned`, code: `banned` });
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
