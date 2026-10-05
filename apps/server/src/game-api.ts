import {
    acceptsCovers,
    seatLevelOf,
    botConcurrentGameCap,
    createGameRequestSchema,
    humanBotGameCap,
    humanConcurrentGameCap,
    humanMoveRequestSchema,
    liveGameListCap,
    liveGameListMemoMs,
    liveGamesQuerySchema,
    nameKeyOf,
    nameSyntaxSchema,
    pairDailyCap,
    watcherRetryAfterSeconds,
    type GameEvent,
} from '@hexo-arena/contract';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { findBot } from './bots';
import { nowSeconds, type Query } from './db';
import {
    type EngineSocket,
    type GameRegistry,
    type MoveErrorCode,
    type Person,
} from './game-registry';
import { countHumanPairGamesSince } from './game-store';
import type { GuestSessions } from './guests';
import type { PresenceRegistry } from './presence';
import type { ClientLimits, CredentialLimits, GameStartLimits } from './request-limits';
import { sessionPerson } from './session-api';
import type { StartGate } from './site-state';
import { utcDay } from './utc-day';
import { frameOf, type GameWatchers } from './watchers';

/** The one route that takes a websocket upgrade. */
export const engineSocketRoute = `/api/bot/game/:gameId/socket`;

interface GameApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
    games: GameRegistry;
    watchers: GameWatchers;
    guests: GuestSessions;
    limits: CredentialLimits & ClientLimits & GameStartLimits;
    // A bot playing a tournament takes no other new game until it ends.
    reservations: { isReserved: (botId: string) => boolean };
}

interface GameParams {
    gameId: string;
}

// A socket's token rides in the query, checked before the upgrade.
interface TokenQuery {
    token?: unknown;
}

// Sends the failure itself and yields null, so handlers stay flat.
function requirePerson(
    deps: GameApiDeps,
    request: FastifyRequest,
    reply: FastifyReply,
): Person | null {
    const person = sessionPerson(deps.query, deps.guests, request);
    if (person === null) {
        reply.code(401).send({ error: `no session`, code: `unauthorized` });
        return null;
    }
    return person;
}

export function registerGameApi(app: FastifyInstance, deps: GameApiDeps): void {
    const { query, presence, games, watchers, gate } = deps;

    app.post(`/api/games`, { config: { limit: `principal` } }, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        if (deps.limits.refuse(reply, `principal`, `${person.kind}:${person.id}`)) return reply;
        const parsed = createGameRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        }
        if (gate.refuse(reply)) return reply;
        const name = parsed.data.bot;
        if (!nameSyntaxSchema.safeParse(name).success) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        const bot = findBot(query, nameKeyOf(name));
        if (bot === undefined) {
            return reply.code(404).send({ error: `no such bot`, code: `not_found` });
        }
        if (bot.delisted) {
            return reply.code(403).send({ error: `the bot is delisted`, code: `delisted` });
        }
        // An owner may test their own bot without opening it to others; the
        // game is a test, unrated, since a win over one's own bot proves nothing.
        const own = person.kind === `user` && bot.ownerId === person.id;
        if (games.activeHumanGameCount(person) >= humanConcurrentGameCap) {
            return reply.code(400).send({
                error: `you already hold the active-game cap`,
                code: `human_busy`,
            });
        }
        if (games.activeHumanGameCount(person, bot.id) >= humanBotGameCap) {
            return reply.code(400).send({
                error: `you already play this bot`,
                code: `pair_busy`,
            });
        }
        const starter = `${person.kind}:${person.id}`;
        if (deps.limits.refuseGameStart(reply, starter)) return reply;
        if (!presence.isOnline(bot.id) || (!own && !presence.isOpenForChallenges(bot.id))) {
            return reply.code(400).send({
                error: `the bot is not online and taking games`,
                code: `not_open`,
            });
        }
        if (!acceptsCovers(bot.accepts, parsed.data.timeControl)) {
            return reply.code(400).send({
                error: `the bot does not accept this clock`,
                code: `clock_not_accepted`,
            });
        }
        // The default named by its id is the default: a game without a level.
        const requested = parsed.data.level;
        const declared = requested === undefined ? undefined : bot.levels?.list.find((level) => level.id === requested);
        if (requested !== undefined && declared === undefined) {
            return reply.code(400).send({ error: `the bot declares no such level`, code: `unknown_level` });
        }
        const level = declared === undefined || declared.id === bot.levels?.default ? null : seatLevelOf(declared);
        // Which games carry the mark: the contract's unratedByChoiceSchema.
        const unratedByChoice = person.kind === `user` && level === null && (own || parsed.data.rated === false);
        if (games.activeGameCount(bot.id) >= botConcurrentGameCap || deps.reservations.isReserved(bot.id)) {
            return reply.code(400).send({
                error: `the bot is at its concurrent-game cap or playing a tournament`,
                code: `bot_busy`,
            });
        }
        // A signed-in human and a bot share the pair cap two bots have, counted
        // from the log like theirs; a game that rates nobody counts toward no cap.
        if (person.kind === `user` && level === null && !unratedByChoice) {
            const day = utcDay(nowSeconds());
            if (countHumanPairGamesSince(query, { userId: person.id, botId: bot.id }, day.start) >= pairDailyCap) {
                return reply.code(429).header(`retry-after`, String(day.secondsLeft)).send({
                    error: `this pair reached its daily game cap`,
                    code: `daily_pair_cap`,
                });
            }
        }
        const created = games.createGame({
            person,
            bot: { id: bot.id, name: bot.name },
            ...(level === null ? {} : { level }),
            unratedByChoice,
            test: own,
            timeControl: parsed.data.timeControl,
            openingPlies: parsed.data.openingPlies,
        });
        // Only a game that started spends a start, so a refusal above costs none.
        deps.limits.takeGameStart(starter);
        return reply.code(201).send(created.snapshot);
    });

    // Pages with live boards poll this list, so it is serialized once a window
    // and that body served to everyone; a clock that steps back starts a new window.
    const liveLists = new Map<boolean, { at: number; body: string }>();
    app.get(`/api/games`, { config: { limit: `public` } }, async (request, reply) => {
        const parsed = liveGamesQuerySchema.safeParse(request.query);
        if (!parsed.success) return reply.code(400).send({ error: `the query fails validation`, code: `bad_request` });
        const tests = parsed.data.tests !== undefined;
        const now = Date.now();
        let held = liveLists.get(tests);
        if (held === undefined || now < held.at || now - held.at >= liveGameListMemoMs) {
            held = { at: now, body: JSON.stringify(games.liveGames(liveGameListCap, tests)) };
            liveLists.set(tests, held);
        }
        return reply.code(200).header(`content-type`, `application/json; charset=utf-8`).send(held.body);
    });

    // Every game is public; the session only decides whether the reader
    // sees its own seat as `you`.
    app.get<{ Params: GameParams }>(`/api/games/:gameId`, { config: { limit: `public` } }, async (request, reply) => {
        const { gameId } = request.params;
        // A finished game's board is replayed from its moves, which costs what a live read does not.
        if (!games.isLive(gameId) && deps.limits.refuseArchive(reply, request)) return reply;
        const found = games.snapshotFor(gameId, sessionPerson(deps.query, deps.guests, request));
        if (found === null) {
            return reply.code(404).send({ error: `no such game`, code: `not_found` });
        }
        return reply.code(200).send(found);
    });

    // Written like the bot stream: on reply.raw behind hijack, so nothing
    // serializes, compresses, or buffers an event.
    // The snapshot read and the attach run in one synchronous stretch, so
    // no turn can land between them.
    app.get<{ Params: GameParams }>(`/api/games/:gameId/events`, { config: { limit: `public` } }, async (request, reply) => {
        const { gameId } = request.params;
        if (!games.isLive(gameId) && deps.limits.refuseArchive(reply, request)) return reply;
        const snapshot = games.snapshotFor(gameId, sessionPerson(deps.query, deps.guests, request));
        if (snapshot === null) {
            return reply.code(404).send({ error: `no such game`, code: `not_found` });
        }
        const seated = snapshot.you !== undefined;
        const live = snapshot.status === `in-progress`;
        // A seat's streams count against the seat, anyone else's against their client.
        const owner = seated ? `seat:${gameId}:${String(snapshot.you)}` : request.clientKey === null ? null : `client:${request.clientKey}`;
        if (live && !watchers.admits(gameId, owner, seated)) {
            reply.header(`retry-after`, String(watcherRetryAfterSeconds));
            return reply.code(429).send({ error: `the watcher cap is full`, code: `watcher_limit` });
        }
        reply.hijack();
        reply.raw.writeHead(200, { 'content-type': `text/event-stream`, 'cache-control': `no-store` });
        reply.raw.flushHeaders();
        const first: GameEvent = { event: `snapshot`, data: snapshot };
        if (live) {
            watchers.attach(gameId, reply.raw, seated, first, owner);
        } else {
            reply.raw.end(frameOf(first));
        }
    });

    app.post<{ Params: GameParams }>(`/api/games/:gameId/move`, { config: { limit: `principal` } }, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        if (deps.limits.refuse(reply, `principal`, `${person.kind}:${person.id}`)) return reply;
        const { gameId } = request.params;
        const parsed = humanMoveRequestSchema.safeParse(request.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        }
        // The length-2 array schema parse already proved both cells exist.
        const [first, second] = parsed.data.cells as [{ x: number; y: number }, { x: number; y: number }];
        const result = games.humanMove(gameId, person, [first, second]);
        if (result.kind === `unknown`) {
            return reply.code(404).send({ error: `no such game of yours`, code: `not_found` });
        }
        if (result.kind === `rejected`) {
            return reply.code(400).send({ error: moveErrorText(result.code), code: result.code });
        }
        return reply.code(200).send(result.snapshot);
    });

    app.post<{ Params: GameParams }>(`/api/games/:gameId/resign`, { config: { limit: `principal` } }, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        if (deps.limits.refuse(reply, `principal`, `${person.kind}:${person.id}`)) return reply;
        const { gameId } = request.params;
        const result = games.humanResign(gameId, person);
        if (result.kind === `unknown`) {
            return reply.code(404).send({ error: `no such game of yours`, code: `not_found` });
        }
        if (result.kind === `rejected`) {
            return reply.code(400).send({ error: `the game is already finished`, code: result.code });
        }
        return reply.code(200).send(result.snapshot);
    });

    app.get<{ Params: GameParams; Querystring: TokenQuery }>(
        engineSocketRoute,
        {
            websocket: true,
            config: { limit: `engine` },
            preHandler: async (request, reply) => {
            const { gameId } = request.params;
            const token = request.query.token;
            const holder = typeof token === `string` ? games.claimSession(gameId, token) : null;
            if (holder === null) {
                // Unknown game and dead token are indistinguishable, so a
                // leaked old gameStart line grants nothing.
                return reply.code(404).send({ error: `unknown game or token`, code: `not_found` });
            }
            // Refused before the upgrade, so the socket a bot holds stays.
            if (deps.limits.refuse(reply, `engineDial`, `seat:${gameId}:${holder.side}`)) return reply;
        } },
        (socket: WebSocket, request) => {
            const { gameId } = request.params;
            const token = request.query.token;
            const engineSocket: EngineSocket = {
                get bufferedAmount() {
                    return socket.bufferedAmount;
                },
                send: (text) => {
                    socket.send(text);
                },
                close: (code, reason) => {
                    socket.close(code, reason);
                },
                onceClose: (listener) => {
                    socket.once(`close`, listener);
                },
            };
            // The token passed the preHandler, which admits a string alone.
            const attached = typeof token === `string` ? games.attachSession(gameId, token, engineSocket) : null;
            if (attached === null) {
                socket.close(1008, `session revoked`);
                return;
            }
            socket.on(`message`, (data) => {
                // Under the payload cap every frame arrives whole; the concat
                // only covers ws delivering a frame as a buffer list.
                const frame = Array.isArray(data)
                    ? Buffer.concat(data)
                    : Buffer.isBuffer(data)
                      ? data
                      : Buffer.from(data);
                games.sessionMessage(attached.side, attached.game, frame.toString());
            });
        },
    );

    app.post<{ Params: GameParams }>(`/api/bot/game/:gameId/resign`, { config: { limit: `principal` } }, async (request, reply) => {
        const { gameId } = request.params;
        const [scheme, token] = (request.headers.authorization ?? ``).split(` `);
        if (scheme?.toLowerCase() !== `bearer` || token === undefined) {
            return reply.code(401).send({ error: `missing game token`, code: `unauthorized` });
        }
        // A seat's resignation counts against its bot, as the bot's own calls do.
        const holder = games.claimSession(gameId, token);
        if (holder !== null && deps.limits.refuse(reply, `principal`, `bot:${holder.seat.botId}`)) return reply;
        const result = games.botResign(gameId, token);
        if (result.kind === `unknown`) {
            return reply.code(404).send({ error: `no such game`, code: `not_found` });
        }
        if (result.kind === `unauthorized`) {
            return reply.code(401).send({ error: `unknown, expired, or rotated game token`, code: `unauthorized` });
        }
        if (result.kind === `rejected`) {
            return reply.code(400).send({ error: `the game is already finished`, code: result.code });
        }
        return reply.code(200).send({ ok: true });
    });
}

function moveErrorText(code: MoveErrorCode): string {
    switch (code) {
        case `not_your_turn`:
            return `it is not your turn`;
        case `cell_occupied`:
            return `a cell is already taken`;
        case `out_of_range`:
            return `a cell is out of placement range`;
        case `game_over`:
            return `the game is already finished`;
    }
}
