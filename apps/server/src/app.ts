import {
    botsPath,
    engineFrameLimitBytes,
    createBotRequestSchema,
    healthzPath,
    isReservedName,
    nameKeyOf,
    nameSyntaxSchema,
    requestBodyLimitBytes,
    tournamentDevLeadMs,
    tournamentLeadMs,
} from '@hexo-arena/contract';
import websocketPlugin from '@fastify/websocket';
import cookiePlugin from '@fastify/cookie';
import Fastify, { errorCodes, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createAdminHandler } from './admin-ops';
import { backupNow, type BackupPolicy } from './backup';
import type { AdminHandler } from './admin-socket';
import { createBot, rotateBotToken } from './bots';
import { registerBotApi } from './bot-api';
import { registerChallengeApi } from './challenge-api';
import { ChallengeRegistry, challengeTtlSeconds } from './challenge-registry';
import { expireStaleChallenges } from './challenge-store';
import { createQuery, type Query, type Sqlite } from './db';
import { registerDevAccountsApi } from './dev-accounts';
import { registerFinishedGamesApi } from './finished-games';
import { abortUnfinishedGames } from './game-store';
import { fillGameRatings, rankablePlayers } from './rating-store';
import { engineSocketRoute, registerGameApi } from './game-api';
import { GameRegistry, wirePresence } from './game-registry';
import { Ladder } from './ladder';
import { registerLeaderboardApi } from './leaderboard-api';
import type { DiscordOAuth } from './discord';
import { drain } from './drain';
import { deleteBotByPolicy, ownedBotId } from './moderation';
import type { PresenceRegistry } from './presence';
import { GuestSessions } from './guests';
import { registerOgShell } from './og-shell';
import { defaultLimits, RequestLimits, type LimitTable } from './request-limits';
import { logClientError, loggingOptions, type LogTarget } from './request-log';
import { registerSessionApi, registerSessionCookie } from './session-api';
import { sessionUser, sweepSessions } from './sessions';
import { registerSignInApi } from './sign-in-api';
import { sweepSignups } from './signups';
import { beginGeneration, StartGate } from './site-state';
import { createPlayerReads, registerPlayerApi } from './player-api';
import { registerTournamentApi } from './tournament-api';
import { TournamentScheduler } from './tournament-scheduler';
import type { GameWatchers } from './watchers';

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
    // Caddy's address on the internal network, whose forwarded client address counts;
    // null trusts no forwarded address.
    trustedProxy?: string | null;
    // The clock the limits count by, and their numbers; tests move and shrink them.
    now?: () => number;
    limits?: LimitTable;
    // How often the tournament scheduler looks for work; 0 leaves it to the caller's ticks.
    tournamentTickMs?: number;
    // Where backups go and how many stay; without it the admin socket writes none.
    backup?: Pick<BackupPolicy, `dir` | `keep`>;
}

export interface BuiltApp {
    app: FastifyInstance;
    limits: RequestLimits;
    admin: AdminHandler;
    tournaments: TournamentScheduler;
    drain: (graceMs: number) => Promise<number>;
}

// The scheduler looks for a game to start, a grace to end, or a round to
// begin this often.
const tournamentTickMs = 1_000;

// Expired sign-ups and sessions, with the Discord names they hold,
// leave at boot and on this beat,
// so none outlives its stated time by more than a minute.
const sweepMs = 60_000;

// An error's own status when it names a failure, else 500.
function errorStatusOf(error: unknown): number {
    const status = typeof error === `object` && error !== null && `statusCode` in error ? error.statusCode : undefined;
    return typeof status === `number` && status >= 400 ? status : 500;
}

const malformed = { error: `the request is malformed`, code: `bad_request` };

// The router refuses a path it cannot decode, or one past its parameter
// cap, before any route or hook runs; Fastify's own body would quote the path.
// No route sets an async constraint, the one other error that lands here.
function answerFrameworkError(error: FastifyError, _request: FastifyRequest, reply: FastifyReply): void {
    const tooLong = errorStatusOf(error) === 414;
    logClientError(error, reply.code(tooLong ? 414 : 400));
    void reply.send(tooLong ? { error: `the path is too long`, code: `bad_request` } : malformed);
}

function sweepExpired(query: Query): void {
    sweepSignups(query);
    sweepSessions(query);
}

export async function buildApp(deps: AppDeps): Promise<BuiltApp> {
    const app = Fastify({ ...loggingOptions(deps.logger), bodyLimit: requestBodyLimitBytes, frameworkErrors: answerFrameworkError });
    // Fastify's own refusals answer in the contract's shape; any other
    // client error keeps the default answer.
    app.setErrorHandler((error, request, reply) => {
        if (error instanceof errorCodes.FST_ERR_CTP_BODY_TOO_LARGE) {
            return reply.code(413).send({ error: `request body too large`, code: `payload_too_large` });
        }
        const status = errorStatusOf(error);
        if (status === 400 || status === 415) {
            logClientError(error, reply.code(status));
            return reply.send(status === 400 ? malformed : { error: `the body's content type is not supported`, code: `unsupported_media_type` });
        }
        if (status < 500) throw error;
        // A server error's message may quote SQL, a template, or a name;
        // the log keeps it with the stack, and the answer says nothing.
        reply.code(500);
        reply.log.error({ req: request, res: reply, err: error }, `request failed`);
        return reply.send({ error: `internal error`, code: `internal` });
    });
    // The answer names no path: a path carries player and bot names and a query.
    app.setNotFoundHandler((request, reply) => {
        request.log.info(`route not found`);
        return reply.code(404).send({ error: `not found`, code: `not_found` });
    });
    // Registered first, so every route after it must name its limit,
    // and every request spends its tokens before any other hook runs.
    const limits = new RequestLimits({ table: deps.limits ?? defaultLimits, now: deps.now ?? Date.now, trustedProxy: deps.trustedProxy ?? null });
    limits.register(app);
    const query = createQuery(deps.sqlite);
    // A process serves only games it created: whatever an earlier process
    // left unfinished is closed here, before any route can reach it.
    const generation = beginGeneration(query);
    abortUnfinishedGames(query);
    fillGameRatings(query);
    expireStaleChallenges(query, challengeTtlSeconds);
    sweepExpired(query);
    const sweep = setInterval(() => {
        sweepExpired(query);
        limits.sweep();
    }, sweepMs);
    sweep.unref();
    await app.register(cookiePlugin);
    registerSessionCookie(app, deps.secureCookies);
    // One move_response is a few hundred bytes; anything bigger is a broken or hostile client.
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
    // Tokens and account data ride API answers, so none may be cached,
    // whatever proxy stands in front of the app.
    app.addHook(`onSend`, (request, reply, payload, done) => {
        if (request.url.startsWith(`/api/`) && !reply.hasHeader(`cache-control`)) void reply.header(`cache-control`, `no-store`);
        done(null, payload);
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
    const leadMs = deps.devLogin ? tournamentDevLeadMs : tournamentLeadMs;
    const tournaments = new TournamentScheduler({
        query,
        presence,
        games,
        generation,
        draining: () => gate.draining,
        leadMs,
        actor: deps.adminActor,
        ...(deps.now === undefined ? {} : { now: deps.now }),
    });
    const ladder = new Ladder({ rank: (filter) => rankablePlayers(query, filter), now: deps.now ?? Date.now });
    games.onFinish((finished) => {
        tournaments.gameFinished(finished);
        // A finish moves ratings, which the ladder shows at once rather than in ten seconds.
        ladder.clear();
    });
    if ((deps.tournamentTickMs ?? tournamentTickMs) > 0) tournaments.start(deps.tournamentTickMs ?? tournamentTickMs);
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
        clearInterval(sweep);
        tournaments.stop();
        challenges.stop();
        games.stop();
    });
    registerBotApi(app, { query, presence, gate, games, limits, reservations: tournaments });
    registerChallengeApi(app, { query, presence, games, challenges, gate, limits, reservations: tournaments });
    registerGameApi(app, { query, presence, games, watchers, gate, guests, limits, reservations: tournaments });
    registerFinishedGamesApi(app, { query, now: deps.now ?? Date.now });
    registerLeaderboardApi(app, { ladder, presence, now: deps.now ?? Date.now });
    registerTournamentApi(app, { query, presence, games, limits, now: deps.now ?? Date.now });
    const playerReads = createPlayerReads({ query, ladder, now: deps.now ?? Date.now });
    registerPlayerApi(app, { reads: playerReads });
    registerSessionApi(app, { query, guests, games, secureCookies: deps.secureCookies, limits });
    registerSignInApi(app, { query, guests, discord: deps.discord, secureCookies: deps.secureCookies, devLogin: deps.devLogin, limits });
    if (deps.devLogin) registerDevAccountsApi(app, { query });
    if (deps.webIndexPath !== undefined) {
        registerOgShell(app, { query, presence, games, ladder, players: playerReads, indexPath: deps.webIndexPath, publicOrigin: deps.publicOrigin, now: deps.now ?? Date.now });
    }
    const backupPolicy = deps.backup;
    const admin = createAdminHandler({
        query,
        presence,
        games,
        challenges,
        tournaments,
        limits,
        ladder,
        actor: deps.adminActor,
        backup: backupPolicy === undefined ? null : () => backupNow(deps.sqlite, backupPolicy, new Date()),
        tournamentLeadMs: leadMs,
        ...(deps.now === undefined ? {} : { now: deps.now }),
    });

    app.get(healthzPath, { config: { limit: `public` } }, async (_request, reply) => {
        // One bit: up and serving, or up and refusing new starts, which
        // uptime monitors read as the pause signal.
        // No version, no uptime, nothing else.
        reply.code(gate.closed() ? 503 : 200).send();
    });
    app.post(botsPath, { config: { limit: `botManagement` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        if (limits.refuse(reply, `botManagement`, `user:${user.id}`)) return reply;
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

    app.delete(`/api/bots/:name`, { config: { limit: `botManagement` } }, async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        if (limits.refuse(reply, `botManagement`, `user:${user.id}`)) return reply;
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
        tournaments.withdraw(botId, `deleted`);
        query.transaction((tx) => deleteBotByPolicy(tx, botId));
        return reply.code(204).send();
    });

    app.post(`/api/bots/:name/token`, { config: { limit: `botManagement` } }, async (request: FastifyRequest<{ Params: { name: string } }>, reply) => {
        const user = sessionUser(query, request);
        if (!user) {
            return reply.code(401).send({ error: `no session`, code: `unauthorized` });
        }
        if (limits.refuse(reply, `botManagement`, `user:${user.id}`)) return reply;
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

    return { app, admin, limits, tournaments, drain: (graceMs) => drain({ query, gate, games, generation }, graceMs) };
}
