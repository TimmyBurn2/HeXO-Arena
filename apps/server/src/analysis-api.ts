import {
    analysisCheckPath,
    analysisListSchema,
    analysisPositionsPath,
    analysisRequestSchema,
    analysisStoneCap,
    communityAnalysisSchema,
    playerOf,
    positionCheckRequestSchema,
    positionReadingRequestSchema,
    positionReadingSchema,
} from '@hexo-arena/contract';
import { setupProblem, type Setup } from '@hexo-arena/rules';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import type { AnalysisService } from './analysis-service';
import type { AnalyzerSessions } from './analyzers';
import type { Query } from './db';
import type { EngineSocket, GameRegistry } from './game-registry';
import type { GuestSessions } from './guests';
import type { LiveGuard } from './live-guard';
import { refuseRate, type ClientLimits, type CredentialLimits } from './request-limits';
import { sessionPerson } from './session-api';
import { sessionUser } from './sessions';
import type { StartGate } from './site-state';

/** The analysis session's route, the one websocket besides a game's engine session. */
export const analysisSocketRoute = `/api/bot/analysis/socket`;

export interface AnalysisApiDeps {
    query: Query;
    analysis: AnalysisService;
    analyzers: AnalyzerSessions;
    guard: Pick<LiveGuard, `holds`>;
    games: Pick<GameRegistry, `liveGamesOf`>;
    guests: GuestSessions;
    gate: StartGate;
    limits: CredentialLimits & ClientLimits;
}

interface GameParams {
    gameId: string;
}

// The analysis answers what waiting may lift with 429 and its wait, and a
// state that stands in the way with 409.
function refuse(reply: FastifyReply, code: string, retryAfter?: number): FastifyReply {
    if (retryAfter !== undefined) return refuseRate(reply, retryAfter, code);
    const status = code === `not_found` ? 404 : 409;
    return reply.code(status).send({ error: `the analysis request is refused`, code });
}

export function registerAnalysisApi(app: FastifyInstance, deps: AnalysisApiDeps): void {
    const { query, analysis, analyzers, limits, gate } = deps;

    app.post(analysisPositionsPath, { config: { limit: `principal` } }, async (request, reply) => {
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `sign in to ask analyzers`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = positionReadingRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const setup: Setup = { stones: parsed.data.cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })), toMove: playerOf(parsed.data.toMove) };
        if (setupProblem(setup, analysisStoneCap) !== null) return reply.code(400).send({ error: `the position cannot be played from`, code: `bad_request` });
        if (gate.refuse(reply)) return reply;
        if (deps.games.liveGamesOf({ kind: `user`, id: user.id }).length > 0) {
            return reply.code(409).send({ error: `no position is read while you sit in a live game`, code: `seated` });
        }
        if (deps.guard.holds(setup.stones)) return reply.code(409).send({ error: `a live game holds this position`, code: `live_position` });
        if (limits.refuse(reply, `positionRequest`, `user:${user.id}`)) return reply;
        // A hung-up asker frees its request, or calls off the reading in flight.
        const hungUp = new AbortController();
        reply.raw.once(`close`, () => {
            if (!reply.raw.writableFinished) hungUp.abort();
        });
        const answer = await analysis.requestPosition(user.id, { setup, analyzer: parsed.data.analyzer, lines: parsed.data.lines, seconds: parsed.data.seconds }, hungUp.signal);
        if (answer.kind === `refused`) return refuse(reply, answer.code, answer.retryAfter);
        return reply.code(200).send(positionReadingSchema.parse(answer.reading));
    });

    // An engine the browser runs is cleared the way a position request is,
    // seat lock then live guard, for anyone: signed out, a guest, or a user.
    app.post(analysisCheckPath, { config: { limit: `public` } }, async (request, reply) => {
        const wait = limits.wait(`positionCheck`, request);
        if (wait !== null) return refuseRate(reply, wait);
        const parsed = positionCheckRequestSchema.safeParse(request.body);
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        const setup: Setup = { stones: parsed.data.cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })), toMove: playerOf(parsed.data.toMove) };
        if (setupProblem(setup, analysisStoneCap) !== null) return reply.code(400).send({ error: `the position cannot be played from`, code: `bad_request` });
        const person = sessionPerson(query, deps.guests, request);
        if (person !== null && deps.games.liveGamesOf(person).length > 0) {
            return reply.code(409).send({ error: `no position is cleared while you sit in a live game`, code: `seated` });
        }
        if (deps.guard.holds(setup.stones)) return reply.code(409).send({ error: `a live game holds this position`, code: `live_position` });
        return reply.code(204).send();
    });

    app.post(`/api/games/:gameId/analyses`, { config: { limit: `principal` } }, async (request, reply) => {
        const { gameId } = request.params as GameParams;
        const user = sessionUser(query, request);
        if (user === null) return reply.code(401).send({ error: `sign in to ask for analysis`, code: `unauthorized` });
        if (limits.refuse(reply, `principal`, `user:${user.id}`)) return reply;
        const parsed = analysisRequestSchema.safeParse(request.body ?? {});
        if (!parsed.success) return reply.code(400).send({ error: `the request fails validation`, code: `bad_request` });
        if (gate.refuse(reply)) return reply;
        const answer = analysis.requestGame(user.id, gameId, parsed.data.analyzer ?? null);
        if (answer.kind === `refused`) return refuse(reply, answer.code, answer.retryAfter);
        return reply.code(202).send(communityAnalysisSchema.parse(answer.analysis));
    });

    app.get(`/api/games/:gameId/analyses`, { config: { limit: `public` } }, async (request, reply) => {
        const { gameId } = request.params as GameParams;
        const answer = analysis.list(gameId);
        if (answer.kind === `refused`) return refuse(reply, answer.code);
        return reply.code(200).send(analysisListSchema.parse(answer.list));
    });

    app.get(
        analysisSocketRoute,
        {
            websocket: true,
            config: { limit: `engine` },
            preHandler: async (request, reply) => {
                const token = (request.query as Record<string, unknown>).token;
                const botId = typeof token === `string` ? analyzers.claim(token) : null;
                if (botId === null) return reply.code(401).send({ error: `missing, unknown, expired, or replaced analysis token`, code: `unauthorized` });
                if (!analyzers.mayAnalyze(botId)) return reply.code(404).send({ error: `the bot declares no analyzer`, code: `not_found` });
                // Refused before the upgrade, so the session a bot holds stays.
                if (limits.refuse(reply, `engineDial`, `analysis:${botId}`)) return reply;
            },
        },
        (socket: WebSocket, request: FastifyRequest) => {
            const token = (request.query as { token: string }).token;
            const botId = analyzers.claim(token);
            if (botId === null) {
                socket.close(1008, `session revoked`);
                return;
            }
            const session: EngineSocket = {
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
            analyzers.attach(botId, session);
            socket.on(`message`, (data) => {
                // Under the payload cap every frame arrives whole; the concat
                // only covers ws delivering a frame as a buffer list.
                const frame = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
                analyzers.message(botId, session, frame.toString());
            });
        },
    );
}
