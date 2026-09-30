import {
    acceptsCovers,
    botConcurrentGameCap,
    createGameRequestSchema,
    humanConcurrentGameCap,
    humanGameCooldownSeconds,
    humanMoveRequestSchema,
    liveGameListCap,
    liveGameListMemoMs,
    nameKeyOf,
    nameSyntaxSchema,
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
import { lastHumanGameCreatedAt } from './game-store';
import type { GuestSessions } from './guests';
import type { PresenceRegistry } from './presence';
import type { ClientLimits, CredentialLimits } from './request-limits';
import { sessionPerson } from './session-api';
import type { StartGate } from './site-state';
import { frameOf, type GameWatchers } from './watchers';

/** The one route that takes a websocket upgrade. */
export const engineSocketRoute = `/api/bot/game/:gameId/socket`;

export interface GameApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
    games: GameRegistry;
    watchers: GameWatchers;
    guests: GuestSessions;
    limits: CredentialLimits & ClientLimits;
}

interface GameParams {
    gameId: string;
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

// A user's cooldown reads the game log so a restart cannot reset it; a
// guest's lives in its session, which a restart ends anyway.
function lastGameCreatedAt(deps: GameApiDeps, person: Person): number | null {
    return person.kind === `user`
        ? lastHumanGameCreatedAt(deps.query, person.id)
        : (deps.guests.byId(person.id)?.lastGameCreatedAt ?? null);
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
        if (games.activeHumanGameCount(person) >= humanConcurrentGameCap) {
            return reply.code(400).send({
                error: `you already hold the active-game cap`,
                code: `human_busy`,
            });
        }
        const lastCreated = lastGameCreatedAt(deps, person);
        if (lastCreated !== null && nowSeconds() - lastCreated < humanGameCooldownSeconds) {
            // The wait left, so a page can count it down instead of trying again.
            reply.header(`retry-after`, String(Math.max(1, humanGameCooldownSeconds - (nowSeconds() - lastCreated))));
            return reply.code(429).send({
                error: `a moment must pass between game creations`,
                code: `game_cooldown`,
            });
        }
        if (!presence.isOnline(bot.id) || !presence.isOpenForChallenges(bot.id)) {
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
        if (games.activeGameCount(bot.id) >= botConcurrentGameCap) {
            return reply.code(400).send({
                error: `the bot is at its concurrent-game cap`,
                code: `bot_busy`,
            });
        }
        const created = games.createGame({
            person,
            bot: { id: bot.id, name: bot.name },
            timeControl: parsed.data.timeControl,
            openingPlies: parsed.data.openingPlies,
        });
        const guest = person.kind === `guest` ? deps.guests.byId(person.id) : null;
        if (guest !== null) guest.lastGameCreatedAt = nowSeconds();
        return reply.code(201).send(created.snapshot);
    });

    // Pages with live boards poll this list, so it is serialized once a window
    // and that body served to everyone; a clock that steps back starts a new window.
    let liveList: { at: number; body: string } | null = null;
    app.get(`/api/games`, { config: { limit: `public` } }, async (_request, reply) => {
        const now = Date.now();
        if (liveList === null || now < liveList.at || now - liveList.at >= liveGameListMemoMs) {
            liveList = { at: now, body: JSON.stringify(games.liveGames(liveGameListCap)) };
        }
        return reply.code(200).header(`content-type`, `application/json; charset=utf-8`).send(liveList.body);
    });

    // Every game is public; the session only decides whether the reader
    // sees its own seat as `you`.
    app.get(`/api/games/:gameId`, { config: { limit: `public` } }, async (request, reply) => {
        const { gameId } = request.params as GameParams;
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
    app.get(`/api/games/:gameId/events`, { config: { limit: `public` } }, async (request, reply) => {
        const { gameId } = request.params as GameParams;
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

    app.post(`/api/games/:gameId/move`, { config: { limit: `principal` } }, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        if (deps.limits.refuse(reply, `principal`, `${person.kind}:${person.id}`)) return reply;
        const { gameId } = request.params as GameParams;
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

    app.post(`/api/games/:gameId/resign`, { config: { limit: `principal` } }, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        if (deps.limits.refuse(reply, `principal`, `${person.kind}:${person.id}`)) return reply;
        const { gameId } = request.params as GameParams;
        const result = games.humanResign(gameId, person);
        if (result.kind === `unknown`) {
            return reply.code(404).send({ error: `no such game of yours`, code: `not_found` });
        }
        if (result.kind === `rejected`) {
            return reply.code(400).send({ error: `the game is already finished`, code: result.code });
        }
        return reply.code(200).send(result.snapshot);
    });

    app.get(
        engineSocketRoute,
        {
            websocket: true,
            config: { limit: `engine` },
            preHandler: async (request, reply) => {
            const { gameId } = request.params as GameParams;
            const token = (request.query as Record<string, unknown>).token;
            const holder = typeof token === `string` ? games.claimSession(gameId, token) : null;
            if (holder === null) {
                // Unknown game and dead token are indistinguishable, so a
                // leaked old gameStart line grants nothing.
                return reply.code(404).send({ error: `unknown game or token`, code: `not_found` });
            }
            // Refused before the upgrade, so the socket a bot holds stays.
            if (deps.limits.refuse(reply, `engineDial`, `seat:${gameId}:${holder.side}`)) return reply;
        } },
        (socket: WebSocket, request: FastifyRequest) => {
            const { gameId } = request.params as GameParams;
            const token = (request.query as { token: string }).token;
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
            const attached = games.attachSession(gameId, token, engineSocket);
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

    app.post(`/api/bot/game/:gameId/resign`, { config: { limit: `principal` } }, async (request, reply) => {
        const { gameId } = request.params as GameParams;
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
