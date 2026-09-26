import {
    acceptsCovers,
    botConcurrentGameCap,
    createGameRequestSchema,
    humanConcurrentGameCap,
    humanGameCooldownSeconds,
    humanMoveRequestSchema,
    nameKeyOf,
    nameSyntaxSchema,
} from '@hexarena/contract';
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
import { sessionPerson } from './session-api';
import type { StartGate } from './site-state';

// One move_response is a few hundred bytes; anything bigger is a broken or
// hostile client, and the limit is structural, not advisory.
export const engineFrameLimitBytes = 16 * 1024;

export interface GameApiDeps {
    query: Query;
    presence: PresenceRegistry;
    gate: StartGate;
    games: GameRegistry;
    guests: GuestSessions;
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
    const { query, presence, games, gate } = deps;

    app.post(`/api/games`, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
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
            return reply.code(400).send({
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

    app.get(`/api/games/:gameId`, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
        const { gameId } = request.params as GameParams;
        const found = games.snapshotFor(gameId, person);
        if (found === null) {
            return reply.code(404).send({ error: `no such game of yours`, code: `not_found` });
        }
        return reply.code(200).send(found);
    });

    app.post(`/api/games/:gameId/move`, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
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

    app.post(`/api/games/:gameId/resign`, async (request, reply) => {
        const person = requirePerson(deps, request, reply);
        if (person === null) return reply;
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
        `/api/bot/game/:gameId/socket`,
        {
            websocket: true,
            // The token rides the URL as a query parameter, so any request
            // log line for this route would persist a live credential.
            logLevel: `silent`,
            preHandler: async (request, reply) => {
            const { gameId } = request.params as GameParams;
            const token = (request.query as Record<string, unknown>).token;
            if (typeof token !== `string` || games.claimSession(gameId, token) === null) {
                // Unknown game and dead token are indistinguishable, so a
                // leaked old gameStart line grants nothing.
                return reply.code(404).send({ error: `unknown game or token`, code: `not_found` });
            }
        } },
        (socket: WebSocket, request: FastifyRequest) => {
            const { gameId } = request.params as GameParams;
            const token = (request.query as { token: string }).token;
            const engineSocket: EngineSocket = {
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

    app.post(`/api/bot/game/:gameId/resign`, async (request, reply) => {
        const { gameId } = request.params as GameParams;
        const [scheme, token] = (request.headers.authorization ?? ``).split(` `);
        if (scheme?.toLowerCase() !== `bearer` || token === undefined) {
            return reply.code(401).send({ error: `missing game token`, code: `unauthorized` });
        }
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
