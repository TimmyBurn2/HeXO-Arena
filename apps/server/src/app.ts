import {
    botsPath,
    createBotRequestSchema,
    devLoginPath,
    discordCallbackPath,
    discordLoginPath,
    signInFailurePath,
    healthzPath,
    isReservedName,
    nameKeyOf,
    nameSyntaxSchema,
} from '@hexo-arena/contract';
import websocketPlugin from '@fastify/websocket';
import cookiePlugin from '@fastify/cookie';
import { z } from 'zod';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createAdminHandler } from './admin-ops';
import type { AdminHandler } from './admin-socket';
import { createBot, rotateBotToken } from './bots';
import { registerBotApi } from './bot-api';
import { registerChallengeApi } from './challenge-api';
import { ChallengeRegistry, challengeTtlSeconds } from './challenge-registry';
import { expireStaleChallenges } from './challenge-store';
import { createQuery, type Sqlite } from './db';
import { abortUnfinishedGames } from './game-store';
import { engineFrameLimitBytes, engineSocketRoute, registerGameApi } from './game-api';
import { GameRegistry, wirePresence } from './game-registry';
import { registerLeaderboardApi } from './leaderboard-api';
import type { DiscordOAuth } from './discord';
import { drain } from './drain';
import { deleteBotByPolicy, ownedBotId } from './moderation';
import { consumeOAuthState, createOAuthState } from './oauth-state';
import type { PresenceRegistry } from './presence';
import { GuestSessions } from './guests';
import { registerOgShell } from './og-shell';
import { loggingOptions, type LogTarget } from './request-log';
import { endGuestSession, registerSessionApi, setSessionCookie } from './session-api';
import { createSession, sessionUser } from './sessions';
import { beginGeneration, StartGate } from './site-state';
import type { GameWatchers } from './watchers';
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
    watchers: GameWatchers;
    // Stamped on every audit row; one operator today, a named moderator
    // once there is more than one.
    adminActor: string;
    // The site's public origin, which makes the shell's preview image an
    // absolute address.
    publicOrigin: string;
    // The deployed index.html; when set, the root, ladder, bot, and game
    // routes answer with the shell carrying live og meta. Dev leaves it to Vite.
    webIndexPath?: string;
    random?: () => number;
    logger?: LogTarget;
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
    const app = Fastify(loggingOptions(deps.logger));
    const query = createQuery(deps.sqlite);
    // A process serves only games it created: whatever an earlier process
    // left unfinished is closed here, before any route can reach it.
    const generation = beginGeneration(query);
    abortUnfinishedGames(query);
    expireStaleChallenges(query, challengeTtlSeconds);
    await app.register(cookiePlugin);
    await app.register(websocketPlugin, { options: { maxPayload: engineFrameLimitBytes } });
    // The plugin accepts an upgrade on any route, then logs the raw url as it
    // closes one no socket handler serves; refused here, the upgrade never
    // reaches that line.
    app.addHook(`onRequest`, (request, reply, done) => {
        if (request.ws && request.routeOptions.url !== engineSocketRoute) {
            void reply.code(404).send({ error: `no websocket on this route`, code: `not_found` });
            return;
        }
        done();
    });
    const { presence, watchers } = deps;
    const gate = new StartGate(query);
    const games = new GameRegistry(
        deps.random === undefined
            ? { query, presence, watchers, generation }
            : { query, presence, watchers, generation, random: deps.random },
    );
    const challenges = new ChallengeRegistry({ query, presence, games });
    wirePresence(presence, games);
    const guests = new GuestSessions({
        seated: (guestId) => games.activeHumanGameCount({ kind: `guest`, id: guestId }) > 0,
        ended: (guestId) => {
            games.endGuest(guestId);
        },
    });
    // Challenge lines lead the replay: they wait on a TTL that the games,
    // with their own clocks and sessions, do not.
    const gameReplay = presence.replay;
    presence.replay = (botId) => [...challenges.replayForBot(botId), ...gameReplay(botId)];
    // Open streams would hold the server's close, so they end before it.
    app.addHook(`preClose`, (done) => {
        presence.closeAll();
        watchers.closeAll();
        done();
    });
    app.addHook(`onClose`, () => {
        challenges.stop();
        games.stop();
    });
    registerBotApi(app, { query, presence, gate });
    registerChallengeApi(app, { query, presence, games, challenges, gate });
    registerGameApi(app, { query, presence, games, watchers, gate, guests });
    registerLeaderboardApi(app, { query });
    registerSessionApi(app, { query, guests, secureCookies: deps.secureCookies });
    if (deps.webIndexPath !== undefined) {
        registerOgShell(app, { query, presence, games, indexPath: deps.webIndexPath, publicOrigin: deps.publicOrigin });
    }
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
            endGuestSession(guests, request);
            const token = createSession(query, user.id);
            setSessionCookie(reply, token, deps.secureCookies, `account`);
            return reply.code(200).send({ name: user.name });
        });
    }

    app.get(healthzPath, async (_request, reply) => {
        // One bit: up and serving, or up and refusing new starts, which
        // uptime monitors read as the pause signal.
        // No version, no uptime, nothing else.
        reply.code(gate.closed() ? 503 : 200).send();
    });
    // A visitor reaches these routes by following links, so every failure
    // is a redirect home that names its reason, never a JSON body as a page.
    app.get(discordLoginPath, async (_request, reply) => {
        if (!deps.discord) return reply.redirect(signInFailurePath(`unconfigured`));
        return reply.redirect(deps.discord.authorizeUrl(createOAuthState(query)));
    });

    app.get(discordCallbackPath, async (request, reply) => {
        if (!deps.discord) return reply.redirect(signInFailurePath(`unconfigured`));
        // Discord answers a cancel with an error and no code.
        const parsed = callbackQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.redirect(signInFailurePath(`cancelled`));
        if (!consumeOAuthState(query, parsed.data.state)) return reply.redirect(signInFailurePath(`expired`));
        const identity = await deps.discord.exchange(parsed.data.code).catch(() => null);
        if (!identity) return reply.redirect(signInFailurePath(`rejected`));
        const user =
            findUserByDiscordId(query, identity.id) ??
            createUserWithDerivedName(query, identity.id, identity.username);
        if (user.banned) return reply.redirect(signInFailurePath(`banned`));
        endGuestSession(guests, request);
        const token = createSession(query, user.id);
        setSessionCookie(reply, token, deps.secureCookies, `account`);
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
