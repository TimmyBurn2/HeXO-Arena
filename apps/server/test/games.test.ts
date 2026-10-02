import {
    botListingSchema,
    engineDialLimit,
    engineFrameLimitBytes,
    engineStrayFrameCap,
    principalRequestLimit,
    streamOpenLimit,
    botWithTokenSchema,
    type BotListing,
    gameSnapshotSchema,
    meSchema,
    pairDailyCap,
    type BwsMoveRequestPacket,
    type BwsSetupPacket,
    type GameSnapshot,
    type StreamEvent,
} from '@hexo-arena/contract';
import http from 'node:http';
import WebSocket, { type RawData } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuery, type Query } from '../src/db';
import { insertGame, recordFinish } from '../src/game-store';
import { recomputeRatings } from '../src/rating-store';
import { createTestApp, type TestApp } from './helpers';

// A random draw of 0.9 makes the human circles, so after the origin alone
// the human holds the first turn and the bot answers.
const humanCircles = () => 0.9;
const turnControl = { mode: `turn` as const, turnTimeMs: 30_000 };
const fastTurnControl = { mode: `turn` as const, turnTimeMs: 5_000 };
const unlimitedControl = { mode: `unlimited` as const };

// Fake timers stop the clocks and keepalives from sleeping, while leaving
// setImmediate real so loopback network I/O still completes.
const timerFakes = {
    toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`],
} satisfies Parameters<typeof vi.useFakeTimers>[0];

async function until(predicate: () => boolean, spins = 5_000): Promise<void> {
    for (let spin = 0; spin < spins; spin += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
    throw new Error(`condition not reached in time`);
}

interface HttpResult {
    status: number;
    text: string;
    setCookie: string[];
    retryAfter: string | undefined;
}

// ws delivers whole frames as buffers under the payload cap; the concat
// only covers a frame arriving as a buffer list.
function frameText(data: RawData): string {
    const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
    return frame.toString();
}

// The contract schemas parse what the tests read, so a drifted response
// fails its own schema before any expectation runs.
function json(result: HttpResult): unknown {
    return JSON.parse(result.text);
}

function snapshotOf(result: HttpResult): GameSnapshot {
    return gameSnapshotSchema.parse(json(result));
}

// Plain node:http instead of fetch: undici wedges under fake timers, and
// the scripted bot needs no http/2-era machinery anyway.
function request(
    port: number,
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: string,
): Promise<HttpResult> {
    return new Promise((resolve, reject) => {
        const outgoing = http.request({ host: `127.0.0.1`, port, path, method, headers }, (response) => {
            let text = ``;
            response.on(`data`, (chunk: Buffer) => {
                text += chunk.toString();
            });
            response.on(`end`, () => {
                resolve({
                    status: response.statusCode ?? 0,
                    text,
                    setCookie: response.headers[`set-cookie`] ?? [],
                    retryAfter: response.headers[`retry-after`],
                });
            });
        });
        outgoing.on(`error`, reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });
}

interface StreamHandle {
    events: StreamEvent[];
    keepalives: number;
    close(): void;
}

interface EngineHandle {
    socket: WebSocket;
    packets: unknown[];
    close(): void;
}

class Arena {
    readonly port: number;

    constructor(
        private readonly app: TestApp[`app`],
        private readonly world: TestApp,
    ) {
        const address = app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        this.port = address.port;
    }

    #call(method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<HttpResult> {
        return request(
            this.port,
            method,
            path,
            headers,
            body === undefined ? undefined : JSON.stringify(body),
        );
    }

    async login(name: string): Promise<string> {
        const result = await this.#call(`POST`, `/api/dev/login`, { 'content-type': `application/json` }, { name });
        expect(result.status).toBe(200);
        const cookie = result.setCookie[0];
        if (cookie === undefined) throw new Error(`no session cookie`);
        return cookie.split(`;`)[0] ?? ``;
    }

    async guest(): Promise<string> {
        const result = await this.#call(`POST`, `/api/auth/guest`);
        expect(result.status).toBe(201);
        const cookie = result.setCookie[0];
        if (cookie === undefined) throw new Error(`no guest cookie`);
        return cookie.split(`;`)[0] ?? ``;
    }

    logout(cookie: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/auth/logout`, { cookie });
    }

    async directoryEntry(name: string): Promise<BotListing | undefined> {
        const result = await this.#call(`GET`, `/api/bots`);
        return botListingSchema.array().parse(json(result)).find((bot) => bot.name === name);
    }

    count(table: `games` | `moves` | `ratings` | `game_ratings`): number {
        // count(*) always answers exactly one row with an integer n.
        const row = this.world.sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number };
        return row.n;
    }

    get query(): Query {
        return createQuery(this.world.sqlite);
    }

    // Games a human already played against a bot, finished without a
    // winner, made at an epoch second the game log then holds.
    seedPairGames(user: string, bot: string, games: number, createdAt: number): void {
        const query = this.query;
        const ids = this.world.sqlite.prepare(`select (select id from users where name = ?) as userId, (select id from bots where name = ?) as botId`).get(user, bot) as { userId: string; botId: string };
        for (let made = 0; made < games; made += 1) {
            const gameId = insertGame(query, { ...ids, userSide: `x`, timeControl: unlimitedControl, opening: [{ x: 0, y: 0, player: 0 }] });
            recordFinish(query, gameId, { winner: null, reason: `aborted` });
            this.world.sqlite.prepare(`update games set created_at = ? where id = ?`).run(createdAt, gameId);
        }
    }

    async createBot(cookie: string, name: string): Promise<string> {
        const result = await this.#call(
            `POST`,
            `/api/bots`,
            { cookie, 'content-type': `application/json` },
            { name },
        );
        expect(result.status).toBe(201);
        return botWithTokenSchema.parse(json(result)).token;
    }

    readAccount(token: string): Promise<HttpResult> {
        return this.#call(`GET`, `/api/bot/account`, { authorization: `Bearer ${token}` });
    }

    async declareWideAccepts(token: string): Promise<void> {
        const result = await this.#call(
            `PATCH`,
            `/api/bot/account`,
            { authorization: `Bearer ${token}`, 'content-type': `application/json` },
            { accepts: { turnMs: [5_000, 600_000], match: true, unlimited: true } },
        );
        expect(result.status).toBe(200);
    }

    openStream(token: string, open = true): StreamHandle {
        const handle: StreamHandle = { events: [], keepalives: 0, close: () => outgoing.destroy() };
        const outgoing = http.request(
            {
                host: `127.0.0.1`,
                port: this.port,
                path: `/api/bot/stream${open ? `?open=1` : ``}`,
                method: `GET`,
                headers: { authorization: `Bearer ${token}` },
            },
            (response) => {
                if (response.statusCode !== 200) throw new Error(`stream refused`);
                let buffer = ``;
                response.on(`data`, (chunk: Buffer) => {
                    buffer += chunk.toString();
                    let newline = buffer.indexOf(`\n`);
                    while (newline >= 0) {
                        const line = buffer.slice(0, newline);
                        buffer = buffer.slice(newline + 1);
                        if (line.trim() === ``) {
                            handle.keepalives += 1;
                        } else {
                            handle.events.push(JSON.parse(line) as StreamEvent);
                        }
                        newline = buffer.indexOf(`\n`);
                    }
                });
            },
        );
        // A destroyed stream surfaces as a late socket error; swallowing it
        // keeps teardown clean, the server sees the same close either way.
        outgoing.on(`error`, () => {
            // A destroyed stream surfaces as a late socket error.
        });
        outgoing.end();
        return handle;
    }

    // Opens a stream and reports the status it answers with, keeping it open on 200.
    openStreamStatus(token: string): Promise<{ status: number; retryAfter: string | undefined; close: () => void }> {
        return new Promise((resolve, reject) => {
            const outgoing = http.request(
                { host: `127.0.0.1`, port: this.port, path: `/api/bot/stream?open=1`, method: `GET`, headers: { authorization: `Bearer ${token}` } },
                (response) => {
                    const retryAfter = response.headers[`retry-after`];
                    resolve({ status: response.statusCode ?? 0, retryAfter: typeof retryAfter === `string` ? retryAfter : undefined, close: () => outgoing.destroy() });
                    response.resume();
                },
            );
            outgoing.on(`error`, (error) => {
                reject(error);
            });
            outgoing.end();
        });
    }

    async dialEngine(socketUrl: string, token: string): Promise<EngineHandle> {
        const socket = new WebSocket(`ws://127.0.0.1:${String(this.port)}${socketUrl}?token=${token}`);
        const packets: unknown[] = [];
        socket.on(`message`, (data) => {
            packets.push(JSON.parse(frameText(data)) as unknown);
        });
        await until(() => socket.readyState === WebSocket.OPEN);
        return {
            socket,
            packets,
            close: () => {
                socket.close();
            },
        };
    }

    // Dials expecting refusal and reports the http status the upgrade got.
    async dialEngineRefused(socketUrl: string, token: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${String(this.port)}${socketUrl}?token=${token}`);
            let settled = false;
            socket.on(`open`, () => {
                if (settled) return;
                settled = true;
                socket.close();
                reject(new Error(`connection unexpectedly opened`));
            });
            socket.on(`unexpected-response`, (_request, response) => {
                if (settled) return;
                settled = true;
                resolve(response.statusCode ?? 0);
            });
            socket.on(`error`, () => {
                if (settled) return;
                settled = true;
                reject(new Error(`socket error before a response`));
            });
        });
    }

    createGame(cookie: string, body: unknown): Promise<HttpResult> {
        return this.#call(`POST`, `/api/games`, { cookie, 'content-type': `application/json` }, body);
    }

    getGame(cookie: string, gameId: string): Promise<HttpResult> {
        return this.#call(`GET`, `/api/games/${gameId}`, { cookie });
    }

    async liveGamesOf(cookie: string): Promise<string[]> {
        const me = meSchema.parse(JSON.parse((await this.#call(`GET`, `/api/me`, { cookie })).text));
        return me?.liveGames.map((game) => game.gameId) ?? [];
    }

    async snapshot(cookie: string, gameId: string): Promise<GameSnapshot> {
        const result = await this.getGame(cookie, gameId);
        expect(result.status).toBe(200);
        return snapshotOf(result);
    }

    move(cookie: string, gameId: string, cells: { x: number; y: number }[]): Promise<HttpResult> {
        return this.#call(`POST`, `/api/games/${gameId}/move`, { cookie, 'content-type': `application/json` }, { cells });
    }

    humanResign(cookie: string, gameId: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/games/${gameId}/resign`, { cookie });
    }

    botResign(gameId: string, token: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/bot/game/${gameId}/resign`, { authorization: `Bearer ${token}` });
    }

    async close(): Promise<void> {
        // Killed connections can leave a hijacked stream or a pooled socket
        // holding server.close() open; teardown owes nothing to clients.
        this.app.server.closeAllConnections();
        await this.app.close();
        this.world.sqlite.close();
    }
}

interface Fixture {
    arena: Arena;
    cookie: string;
    token: string;
    stream: StreamHandle;
    dispose: () => void;
}

async function startArena(random: () => number = humanCircles): Promise<Arena> {
    const world = await createTestApp({ random });
    await world.app.listen({ host: `127.0.0.1`, port: 0 });
    return new Arena(world.app, world);
}

async function standardBot(arena: Arena): Promise<Fixture> {
    const cookie = await arena.login(`humanplayer`);
    const token = await arena.createBot(cookie, `opponentbot`);
    await arena.declareWideAccepts(token);
    const stream = arena.openStream(token);
    return {
        arena,
        cookie,
        token,
        stream,
        dispose: () => {
            stream.close();
        },
    };
}

async function startGame(
    arena: Arena,
    cookie: string,
    timeControl: unknown = turnControl,
    openingPlies = 1,
): Promise<{ gameId: string; snapshot: GameSnapshot }> {
    const response = await arena.createGame(cookie, {
        bot: `opponentbot`,
        timeControl,
        openingPlies,
    });
    expect(response.status).toBe(201);
    const snapshot = snapshotOf(response);
    return { gameId: snapshot.gameId, snapshot };
}

function isMoveRequest(packet: unknown): packet is BwsMoveRequestPacket {
    return (
        typeof packet === `object` &&
        packet !== null &&
        (packet as { type?: unknown }).type === `move_request`
    );
}

type Typed<T extends StreamEvent[`type`]> = Extract<StreamEvent, { type: T }>;

async function eventOn<T extends StreamEvent[`type`]>(
    stream: StreamHandle,
    type: T,
): Promise<Typed<T>> {
    await until(() => stream.events.some((event) => event.type === type));
    const found = stream.events.findLast((event) => event.type === type);
    if (found === undefined) throw new Error(`${type} vanished`);
    return found as Typed<T>;
}

function gameStartOn(stream: StreamHandle): Promise<Typed<`gameStart`>> {
    return eventOn(stream, `gameStart`);
}

function finishOn(stream: StreamHandle): Promise<Typed<`gameFinish`>> {
    return eventOn(stream, `gameFinish`);
}

function finished(snapshot: GameSnapshot): Extract<GameSnapshot, { status: `finished` }> {
    if (snapshot.status !== `finished`) throw new Error(`expected a finished game`);
    return snapshot;
}

function inProgress(snapshot: GameSnapshot): Extract<GameSnapshot, { status: `in-progress` }> {
    if (snapshot.status !== `in-progress`) throw new Error(`expected a live game`);
    return snapshot;
}

async function humanMove(
    arena: Arena,
    cookie: string,
    gameId: string,
    cells: { x: number; y: number }[],
): Promise<GameSnapshot> {
    const response = await arena.move(cookie, gameId, cells);
    expect(response.status).toBe(200);
    return snapshotOf(response);
}

// Each session is answered in order: call n waits for the nth move request
// on that socket and answers it, so arrival timing never matters.
const answered = new WeakMap<EngineHandle, number>();

async function botAnswer(
    engine: EngineHandle,
    cells: { q: number; r: number }[],
): Promise<BwsMoveRequestPacket> {
    const index = answered.get(engine) ?? 0;
    await until(() => engine.packets.filter(isMoveRequest).length > index);
    const request = engine.packets.filter(isMoveRequest)[index];
    if (request === undefined) throw new Error(`request vanished`);
    answered.set(engine, index + 1);
    engine.socket.send(
        JSON.stringify({
            type: `move_response`,
            move: { pieces: cells },
            request_id: request.request_id,
        }),
    );
    return request;
}

describe('a human plays a connected bot end to end', () => {
    let arena: Arena;
    let bot: Fixture;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        arena = await startArena();
        bot = await standardBot(arena);
    });

    afterEach(async () => {
        bot.dispose();
        await arena.close();
        vi.useRealTimers();
    });

    it('plays a complete game the human wins over http', async () => {
        const { gameId, snapshot } = await startGame(arena, bot.cookie);
        expect(snapshot.you).toBe(`o`);
        expect(snapshot.board.cells).toEqual([{ x: 0, y: 0, side: `x` }]);
        const start = await gameStartOn(bot.stream);
        // Only the player's rating moves in a game against a bot.
        expect(start.rated).toBe(false);
        expect(start.engine.socketUrl).toBe(`/api/bot/game/${gameId}/socket`);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        // The setup packet is origin-only; the request only comes once the
        // human has moved.
        await until(() => engine.packets.length > 0);
        expect(engine.packets[0]).toEqual({
            type: `setup`,
            board: { cells: [{ q: 0, r: 0, p: `x` }] },
        } satisfies BwsSetupPacket);

        const first = inProgress(
            await humanMove(arena, bot.cookie, gameId, [
                { x: 1, y: -1 },
                { x: 2, y: -2 },
            ]),
        );
        expect(first.toMove).toBe(`x`);
        const request = await botAnswer(engine, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        // The wire sees the engine's x,y through the axial conversion.
        expect(request.previous).toEqual([
            { side: `o`, pieces: [{ q: 0, r: 1 }, { q: 0, r: 2 }] },
        ]);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 3, y: -3 },
            { x: 4, y: -4 },
        ]);
        await botAnswer(engine, [
            { q: 3, r: 0 },
            { q: 4, r: 0 },
        ]);
        const winning = finished(
            await humanMove(arena, bot.cookie, gameId, [
                { x: 5, y: -5 },
                { x: 6, y: -6 },
            ]),
        );
        expect(winning.winner).toBe(`o`);
        expect(winning.reason).toBe(`six-in-a-row`);
        expect(winning.board.cells).toHaveLength(11);
        const finish = await finishOn(bot.stream);
        expect(finish.gameId).toBe(gameId);
        expect(finish).toMatchObject({ winner: `o`, reason: `six-in-a-row` });
        const after = await arena.snapshot(bot.cookie, gameId);
        expect(after.status).toBe(`finished`);
        await until(() => engine.socket.readyState === WebSocket.CLOSED);
    });

    it('plays a complete game the bot wins over the engine session', async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        // The bot owns the origin cross and builds the row on the x axis.
        await botAnswer(engine, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        await humanMove(arena, bot.cookie, gameId, [
            { x: -1, y: 1 },
            { x: -2, y: 2 },
        ]);
        await botAnswer(engine, [
            { q: 3, r: 0 },
            { q: 4, r: 0 },
        ]);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
        // The fifth cross completes six on the row; the second placement of
        // the turn is never applied and may even repeat a taken cell.
        await botAnswer(engine, [
            { q: 5, r: 0 },
            { q: 5, r: 0 },
        ]);
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `x`, reason: `six-in-a-row` });
        const after = finished(await arena.snapshot(bot.cookie, gameId));
        expect(after.winner).toBe(`x`);
        expect(after.board.cells).toHaveLength(12);
    });

    it('forfeits a silent bot when its turn clock runs out', async () => {
        const { gameId } = await startGame(arena, bot.cookie, fastTurnControl);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        await until(() => engine.packets.some(isMoveRequest));
        const request = engine.packets.find(isMoveRequest);
        if (request === undefined) throw new Error(`no request`);
        expect(request.move_time_limit).toBe(5);
        await vi.advanceTimersByTimeAsync(5_000);
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `o`, reason: `timeout` });
        await until(() => engine.socket.readyState === WebSocket.CLOSED);
    });

    it('forfeits an illegal engine move as a termination', async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        await botAnswer(engine, [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
        ]);
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `o`, reason: `terminated` });
        expect(finished(await arena.snapshot(bot.cookie, gameId)).reason).toBe(`terminated`);
        await until(() => engine.socket.readyState === WebSocket.CLOSED);
    });

    it('accepts resignation from the bot over its game token', async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        await until(() => engine.packets.some(isMoveRequest));
        const response = await arena.botResign(gameId, start.engine.token);
        expect(response.status).toBe(200);
        expect(json(response)).toEqual({ ok: true });
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `o`, reason: `surrender` });
        const rejected = await arena.botResign(gameId, start.engine.token);
        expect(rejected.status).toBe(401);
        await until(() => engine.socket.readyState === WebSocket.CLOSED);
    });

    it('accepts resignation from the human over the session cookie', async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const response = await arena.humanResign(bot.cookie, gameId);
        expect(response.status).toBe(200);
        expect(finished(snapshotOf(response))).toMatchObject({
            winner: `x`,
            reason: `surrender`,
        });
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `x`, reason: `surrender` });
        const again = await arena.humanResign(bot.cookie, gameId);
        expect(again.status).toBe(400);
        const moved = await arena.move(bot.cookie, gameId, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(moved.status).toBe(400);
        expect(json(moved)).toMatchObject({ code: `game_over` });
    });

    it('carries the opening length on live and stored snapshots, read back from the stored stones', async () => {
        const { gameId, snapshot } = await startGame(arena, bot.cookie, turnControl, 5);
        expect(snapshot.openingPlies).toBe(5);
        expect(snapshot.board.cells).toHaveLength(5);
        await arena.humanResign(bot.cookie, gameId);
        const stored = await arena.snapshot(bot.cookie, gameId);
        expect(finished(stored).clock).toBeUndefined();
        expect(stored.openingPlies).toBe(5);
        expect(stored.board.cells.slice(0, 5)).toEqual(snapshot.board.cells);
    });

    it('states the clock with its amounts on live and stored snapshots', async () => {
        const match = { mode: `match` as const, mainTimeMs: 300_000, incrementMs: 3_000 };
        const { gameId, snapshot } = await startGame(arena, bot.cookie, match);
        expect(snapshot.timeControl).toEqual(match);
        expect((await arena.snapshot(bot.cookie, gameId)).timeControl).toEqual(match);
        await arena.humanResign(bot.cookie, gameId);
        expect((await arena.snapshot(bot.cookie, gameId)).timeControl).toEqual(match);
    });

    it('defaults a game without an opening length to five plies', async () => {
        const response = await arena.createGame(bot.cookie, { bot: `opponentbot`, timeControl: turnControl });
        expect(response.status).toBe(201);
        expect(snapshotOf(response).openingPlies).toBe(5);
        expect(snapshotOf(response).board.cells).toHaveLength(5);
    });

    it('refuses an even opening length', async () => {
        const response = await arena.createGame(bot.cookie, { bot: `opponentbot`, timeControl: turnControl, openingPlies: 4 });
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({ code: `bad_request` });
    });

    it('replays gameStart and a fresh moveRequest on a mid-game stream reconnect', async () => {
        const { gameId } = await startGame(arena, bot.cookie, unlimitedControl);
        const first = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(first.engine.socketUrl, first.engine.token);
        await humanMove(arena, bot.cookie, gameId, [
            { x: 0, y: 1 },
            { x: 0, y: 2 },
        ]);
        await botAnswer(engine, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        await humanMove(arena, bot.cookie, gameId, [
            { x: -1, y: 1 },
            { x: -2, y: 2 },
        ]);
        // The stream drops mid-game; the reconnect replays the game with a
        // fresh handoff and the outstanding request.
        bot.stream.close();
        await vi.advanceTimersByTimeAsync(1_000);
        bot.stream = arena.openStream(bot.token);
        const replayed = await gameStartOn(bot.stream);
        expect(replayed.gameId).toBe(gameId);
        expect(replayed.engine.token).not.toBe(first.engine.token);
        const replayRequest = bot.stream.events.find((event) => event.type === `moveRequest`);
        if (replayRequest?.type !== `moveRequest`) throw new Error(`no replayed request`);
        expect(replayRequest.gameId).toBe(gameId);
        expect(replayRequest.request.request_id).toBeGreaterThan(0);
        // The old token is superseded; the fresh one carries the session on.
        const refused = await arena.dialEngineRefused(first.engine.socketUrl, first.engine.token);
        expect(refused).toBe(404);
        const fresh = await arena.dialEngine(replayed.engine.socketUrl, replayed.engine.token);
        await botAnswer(fresh, [
            { q: 3, r: 0 },
            { q: 4, r: 0 },
        ]);
        const middle = inProgress(
            await humanMove(arena, bot.cookie, gameId, [
                { x: 1, y: -1 },
                { x: 2, y: -2 },
            ]),
        );
        expect(middle.toMove).toBe(`x`);
        await botAnswer(fresh, [
            { q: 5, r: 0 },
            { q: 6, r: 0 },
        ]);
        const finish = await finishOn(bot.stream);
        expect(finish).toMatchObject({ winner: `x`, reason: `six-in-a-row` });
    });

    it('keeps the stream keepalive ticking while a game is active', async () => {
        await startGame(arena, bot.cookie, unlimitedControl);
        await vi.advanceTimersByTimeAsync(30_000);
        expect(bot.stream.keepalives).toBe(3);
        expect(bot.stream.events.some((event) => event.type === `gameFinish`)).toBe(false);
    });
});

describe('the stream and the engine session under their limits', () => {
    let arena: Arena;
    let bot: Fixture;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        arena = await startArena();
        bot = await standardBot(arena);
    });

    afterEach(async () => {
        bot.dispose();
        await arena.close();
        vi.useRealTimers();
    });

    it('refuse a sixth stream open within ten seconds with its wait, and leave the open stream running', async () => {
        const opened: { close: () => void }[] = [];
        for (let open = 1; open < streamOpenLimit.burst; open += 1) {
            const answer = await arena.openStreamStatus(bot.token);
            expect(answer.status).toBe(200);
            opened.push(answer);
        }
        const refused = await arena.openStreamStatus(bot.token);
        expect(refused.status).toBe(429);
        expect(refused.retryAfter).toBe(String(streamOpenLimit.refillMs / 1000));
        expect((await arena.directoryEntry(`opponentbot`))?.online).toBe(true);
        const other = await arena.openStreamStatus(await arena.createBot(bot.cookie, `otherbot`));
        expect(other.status).toBe(200);
        opened.push(other);
        vi.advanceTimersByTime(streamOpenLimit.refillMs);
        const later = await arena.openStreamStatus(bot.token);
        expect(later.status).toBe(200);
        opened.push(later);
        for (const stream of opened) stream.close();
    });

    it('refuse a sixth engine dial within ten seconds before the upgrade', async () => {
        await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        for (let dial = 0; dial < engineDialLimit.burst; dial += 1) {
            const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
            engine.close();
        }
        expect(await arena.dialEngineRefused(start.engine.socketUrl, start.engine.token)).toBe(429);
        vi.advanceTimersByTime(engineDialLimit.refillMs);
        const later = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        expect(later.socket.readyState).toBe(WebSocket.OPEN);
        later.close();
    });

    it(`hold a player's turns, and a seat's resignation beside its bot's calls, to ${String(principalRequestLimit.burst)} at once`, async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        // Starting the game spent one of the player's calls.
        const statuses: number[] = [];
        for (let turn = 1; turn <= principalRequestLimit.burst; turn += 1) {
            statuses.push((await arena.move(bot.cookie, gameId, [{ x: 40, y: 0 }, { x: 41, y: 0 }])).status);
        }
        expect(statuses.slice(0, -1)).not.toContain(429);
        expect(statuses.at(-1)).toBe(429);
        // The bot spent one call declaring what it accepts.
        for (let call = 1; call < principalRequestLimit.burst; call += 1) expect((await arena.readAccount(bot.token)).status).toBe(200);
        expect((await arena.botResign(gameId, start.engine.token)).status).toBe(429);
        vi.advanceTimersByTime(principalRequestLimit.refillMs);
        expect((await arena.botResign(gameId, start.engine.token)).status).toBe(200);
    });

    it(`close an engine session with 1009 on a frame over ${String(engineFrameLimitBytes / 1024)} KiB`, async () => {
        await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        let closed: number | null = null;
        engine.socket.on(`close`, (code) => {
            closed = code;
        });
        engine.socket.send(`x`.repeat(engineFrameLimitBytes + 1));
        await until(() => closed !== null);
        expect(closed).toBe(1009);
    });

    it(`count an answer that names another request as a stray on the bot's own turn`, async () => {
        // Three opening plies hand the first turn to the bot, which plays crosses.
        await startGame(arena, bot.cookie, turnControl, 3);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await until(() => engine.packets.some(isMoveRequest));
        let closed: number | null = null;
        engine.socket.on(`close`, (code) => {
            closed = code;
        });
        const stray = JSON.stringify({ type: `move_response`, move: { pieces: [{ q: 1, r: 0 }, { q: 2, r: 0 }] }, request_id: 999 });
        for (let frame = 0; frame <= engineStrayFrameCap; frame += 1) engine.socket.send(stray);
        await until(() => closed !== null);
        expect(closed).toBe(1008);
    });

    it('close an engine session with 1008 after ten frames that answer no request, forfeiting nothing', async () => {
        const { gameId } = await startGame(arena, bot.cookie);
        const start = await gameStartOn(bot.stream);
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        let closed: { code: number; reason: string } | null = null;
        engine.socket.on(`close`, (code, reason) => {
            closed = { code, reason: reason.toString() };
        });
        const stray = JSON.stringify({ type: `move_response`, move: { pieces: [{ q: 1, r: 0 }, { q: 2, r: 0 }] }, request_id: 999 });
        for (let frame = 0; frame < engineStrayFrameCap; frame += 1) engine.socket.send(stray);
        await until(() => engine.socket.bufferedAmount === 0);
        for (let spin = 0; spin < 50; spin += 1) await new Promise((resolve) => setImmediate(resolve));
        expect(closed).toBe(null);
        engine.socket.send(stray);
        await until(() => closed !== null);
        expect(closed).toEqual({ code: 1008, reason: `rate limit exceeded` });
        expect(inProgress(await arena.snapshot(bot.cookie, gameId)).status).toBe(`in-progress`);
    });
});

describe('a guest plays a connected bot', () => {
    let arena: Arena;
    let bot: Fixture;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        arena = await startArena();
        bot = await standardBot(arena);
    });

    afterEach(async () => {
        bot.dispose();
        await arena.close();
        vi.useRealTimers();
    });

    it('wins a decided game that leaves no row, no move, and no rating delta behind', async () => {
        const guest = await arena.guest();
        const before = await arena.directoryEntry(`opponentbot`);
        expect(before?.liveGames).toBe(0);
        const { gameId } = await startGame(arena, guest);
        expect((await arena.directoryEntry(`opponentbot`))?.liveGames).toBe(1);
        const start = await gameStartOn(bot.stream);
        expect(start.rated).toBe(false);
        expect(start.opponent.name).toMatch(/^Guest [a-z0-9]{4}$/);
        expect(start.opponent).toMatchObject({ rating: null, provisional: false });
        const engine = await arena.dialEngine(start.engine.socketUrl, start.engine.token);
        await humanMove(arena, guest, gameId, [
            { x: 1, y: -1 },
            { x: 2, y: -2 },
        ]);
        await botAnswer(engine, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        await humanMove(arena, guest, gameId, [
            { x: 3, y: -3 },
            { x: 4, y: -4 },
        ]);
        await botAnswer(engine, [
            { q: 3, r: 0 },
            { q: 4, r: 0 },
        ]);
        const winning = finished(
            await humanMove(arena, guest, gameId, [
                { x: 5, y: -5 },
                { x: 6, y: -6 },
            ]),
        );
        expect(winning).toMatchObject({ winner: `o`, reason: `six-in-a-row`, openingPlies: 1 });
        expect(await finishOn(bot.stream)).toMatchObject({ winner: `o`, reason: `six-in-a-row` });

        expect(arena.count(`games`)).toBe(0);
        expect(arena.count(`moves`)).toBe(0);
        expect(arena.count(`ratings`)).toBe(0);
        expect(arena.count(`game_ratings`)).toBe(0);
        expect(recomputeRatings(arena.query)).toBe(0);
        expect(arena.count(`ratings`)).toBe(0);
        expect(arena.count(`game_ratings`)).toBe(0);
        const after = await arena.directoryEntry(`opponentbot`);
        expect(after?.liveGames).toBe(0);
        expect(after?.rating).toBe(before?.rating);
        expect(after?.provisional).toBe(before?.provisional);

        const own = finished(await arena.snapshot(guest, gameId));
        expect(own).toMatchObject({ winner: `o`, you: `o` });
        expect(own.players.o).toMatchObject({ rating: null, provisional: false, kind: `guest` });
        for (const reader of [bot.cookie, await arena.guest(), ``]) {
            const watched = finished(await arena.snapshot(reader, gameId));
            expect(watched.winner).toBe(`o`);
            expect(watched.you).toBeUndefined();
            expect(watched.players).toEqual(own.players);
        }
    });

    it('holds each guest session to its own creation cooldown', async () => {
        const guest = await arena.guest();
        await startGame(arena, guest);
        const immediate = await arena.createGame(guest, { bot: `opponentbot`, timeControl: turnControl });
        expect(immediate.status).toBe(429);
        expect(json(immediate)).toMatchObject({ code: `game_cooldown` });
        expect(immediate.retryAfter).toBe(`60`);
        await startGame(arena, await arena.guest());
    });

    it('states the clock on a guest game once it finishes', async () => {
        const guest = await arena.guest();
        const { gameId } = await startGame(arena, guest, turnControl);
        await arena.humanResign(guest, gameId);
        expect((await arena.snapshot(guest, gameId)).timeControl).toEqual(turnControl);
    });

    it('aborts the live game when the guest signs out and forgets it after', async () => {
        const guest = await arena.guest();
        const { gameId } = await startGame(arena, guest);
        expect((await arena.logout(guest)).status).toBe(204);
        expect(await finishOn(bot.stream)).toMatchObject({ gameId, winner: null, reason: `aborted` });
        expect((await arena.getGame(guest, gameId)).status).toBe(404);
        expect((await arena.getGame(``, gameId)).status).toBe(404);
        expect(arena.count(`games`)).toBe(0);
    });
});

describe('game creation gates', () => {
    let arena: Arena;
    let bot: Fixture;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        arena = await startArena();
        bot = await standardBot(arena);
    });

    afterEach(async () => {
        bot.dispose();
        await arena.close();
        vi.useRealTimers();
    });

    it('refuses a bot that is not online and open', async () => {
        bot.stream.close();
        bot.stream = arena.openStream(bot.token, false);
        const response = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: turnControl,
        });
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({ code: `not_open` });
    });

    it('refuses a clock outside the declared window', async () => {
        const response = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: { mode: `turn`, turnTimeMs: 700_000 },
        });
        expect(response.status).toBe(400);
        expect(json(response)).toMatchObject({ code: `clock_not_accepted` });
    });

    it('refuses a bot at its concurrent-game cap', async () => {
        // Four distinct humans each hold one game, so the bot's cap is the
        // only bound any of the creations can hit.
        const others = [await arena.login(`secondplayer`), await arena.login(`thirdplayer`), await arena.login(`fourthplayer`)];
        for (const cookie of [bot.cookie, ...others]) {
            const response = await arena.createGame(cookie, {
                bot: `opponentbot`,
                timeControl: unlimitedControl,
            });
            expect(response.status).toBe(201);
        }
        const latecomer = await arena.login(`lateplayer`);
        const fifth = await arena.createGame(latecomer, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(fifth.status).toBe(400);
        expect(json(fifth)).toMatchObject({ code: `bot_busy` });
    });

    it('caps a human at three concurrent games', async () => {
        for (let created = 0; created < 3; created += 1) {
            const response = await arena.createGame(bot.cookie, {
                bot: `opponentbot`,
                timeControl: unlimitedControl,
            });
            expect(response.status).toBe(201);
            await vi.advanceTimersByTimeAsync(60_000);
        }
        const fourth = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(fourth.status).toBe(400);
        expect(json(fourth)).toMatchObject({ code: `human_busy` });
    });

    it('lists a person\'s own live games in me, newest first, until each ends', async () => {
        expect(await arena.liveGamesOf(bot.cookie)).toEqual([]);
        const started: string[] = [];
        for (let created = 0; created < 3; created += 1) {
            started.push((await startGame(arena, bot.cookie, unlimitedControl)).gameId);
            await vi.advanceTimersByTimeAsync(60_000);
        }
        const guest = await arena.guest();
        const guestGame = (await startGame(arena, guest, unlimitedControl)).gameId;
        expect(await arena.liveGamesOf(bot.cookie)).toEqual([...started].reverse());
        expect(await arena.liveGamesOf(guest)).toEqual([guestGame]);
        const [first = ``] = started;
        expect((await arena.humanResign(bot.cookie, first)).status).toBe(200);
        expect(await arena.liveGamesOf(bot.cookie)).toEqual(started.slice(1).reverse());
    });

    it('cools a human down for sixty seconds between game creations', async () => {
        const first = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(first.status).toBe(201);
        const immediate = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(immediate.status).toBe(429);
        expect(json(immediate)).toMatchObject({ code: `game_cooldown` });
        expect(immediate.retryAfter).toBe(`60`);
        await vi.advanceTimersByTimeAsync(30_000);
        const cooling = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(cooling.status).toBe(429);
        expect(json(cooling)).toMatchObject({ code: `game_cooldown` });
        expect(cooling.retryAfter).toBe(`30`);
        await vi.advanceTimersByTimeAsync(30_000);
        const after = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: unlimitedControl,
        });
        expect(after.status).toBe(201);
    });

    it('caps one human against one bot at the daily pair cap from the UTC day\'s start, waiting until 00:00 UTC', async () => {
        const now = Math.floor(Date.now() / 1000);
        const dayStart = now - (now % 86_400);
        arena.seedPairGames(`humanplayer`, `opponentbot`, pairDailyCap - 1, dayStart);
        arena.seedPairGames(`humanplayer`, `opponentbot`, 3, dayStart - 1);
        expect((await arena.createGame(bot.cookie, { bot: `opponentbot`, timeControl: unlimitedControl })).status).toBe(201);
        await vi.advanceTimersByTimeAsync(60_000);
        const refused = await arena.createGame(bot.cookie, { bot: `opponentbot`, timeControl: unlimitedControl });
        expect(refused.status).toBe(429);
        expect(json(refused)).toMatchObject({ code: `daily_pair_cap` });
        const later = Math.floor(Date.now() / 1000);
        expect(refused.retryAfter).toBe(String(dayStart + 86_400 - later));
    });

    it('answers 404 for an unknown bot and rejects malformed bodies', async () => {
        const unknown = await arena.createGame(bot.cookie, {
            bot: `ghostbot`,
            timeControl: turnControl,
        });
        expect(unknown.status).toBe(404);
        const malformed = await arena.createGame(bot.cookie, {
            bot: `opponentbot`,
            timeControl: { mode: `turn`, turnTimeMs: 1_000 },
        });
        expect(malformed.status).toBe(400);
        expect(json(malformed)).toMatchObject({ code: `bad_request` });
    });
});

describe('human move gates', () => {
    let arena: Arena;
    let bot: Fixture;
    let gameId: string;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        arena = await startArena();
        bot = await standardBot(arena);
        const created = await startGame(arena, bot.cookie);
        gameId = created.gameId;
    });

    afterEach(async () => {
        bot.dispose();
        await arena.close();
        vi.useRealTimers();
    });

    it('rejects an occupied cell, an out-of-range cell, and a wrong turn without forfeiting', async () => {
        const occupied = await arena.move(bot.cookie, gameId, [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
        ]);
        expect(occupied.status).toBe(400);
        expect(json(occupied)).toMatchObject({ code: `cell_occupied` });
        const outOfRange = await arena.move(bot.cookie, gameId, [
            { x: 50, y: 50 },
            { x: 1, y: 0 },
        ]);
        expect(outOfRange.status).toBe(400);
        expect(json(outOfRange)).toMatchObject({ code: `out_of_range` });
        const moved = inProgress(
            await humanMove(arena, bot.cookie, gameId, [
                { x: 1, y: -1 },
                { x: 2, y: -2 },
            ]),
        );
        expect(moved.status).toBe(`in-progress`);
        const early = await arena.move(bot.cookie, gameId, [
            { x: 3, y: -3 },
            { x: 4, y: -4 },
        ]);
        expect(early.status).toBe(400);
        expect(json(early)).toMatchObject({ code: `not_your_turn` });
        expect(inProgress(await arena.snapshot(bot.cookie, gameId)).status).toBe(`in-progress`);
    });

    it('shows a game to another player and to strangers without a seat, and refuses their moves', async () => {
        const other = await arena.login(`otherplayer`);
        for (const reader of [other, ``]) {
            const watched = inProgress(await arena.snapshot(reader, gameId));
            expect(watched.you).toBeUndefined();
            expect(watched.players.x).toMatchObject({ name: `opponentbot`, kind: `bot` });
            expect(watched.players.o).toMatchObject({ name: `humanplayer`, kind: `user` });
        }
        expect((await arena.getGame(``, `g_unknown`)).status).toBe(404);
        const movedAsOther = await arena.move(other, gameId, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(movedAsOther.status).toBe(404);
    });
});
