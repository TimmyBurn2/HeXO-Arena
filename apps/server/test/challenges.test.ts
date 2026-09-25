import {
    botWithTokenSchema,
    challengeSchema,
    nameKeyOf,
    type BwsMoveRequestPacket,
    type StreamEvent,
} from '@hexarena/contract';
import http from 'node:http';
import WebSocket, { type RawData } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './helpers';
import { createQuery } from '../src/db';
import { findBot } from '../src/bots';
import { findChallenge } from '../src/challenge-store';
import { insertBotGame } from '../src/game-store';

const turnControl = { mode: `turn` as const, turnTimeMs: 30_000 };
const unlimitedControl = { mode: `unlimited` as const };

const wideAccepts = { turnMs: [5_000, 600_000], match: true, unlimited: true };

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
}

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
                });
            });
        });
        outgoing.on(`error`, reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });
}

function json(result: HttpResult): unknown {
    return JSON.parse(result.text);
}

interface StreamHandle {
    events: StreamEvent[];
    opened: Promise<void>;
    close(): void;
}

function frameText(data: RawData): string {
    const frame = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
    return frame.toString();
}

interface EngineHandle {
    socket: WebSocket;
    packets: unknown[];
    close(): void;
}

interface BotFixture {
    token: string;
    stream: StreamHandle;
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

    async createBot(cookie: string, name: string): Promise<string> {
        const result = await this.#call(`POST`, `/api/bots`, { cookie, 'content-type': `application/json` }, { name });
        expect(result.status).toBe(201);
        return botWithTokenSchema.parse(json(result)).token;
    }

    async declare(token: string, accepts: unknown): Promise<void> {
        const result = await this.#call(
            `PATCH`,
            `/api/bot/account`,
            { authorization: `Bearer ${token}`, 'content-type': `application/json` },
            { accepts },
        );
        expect(result.status).toBe(200);
    }

    openStream(token: string, open = true): StreamHandle {
        let signalOpen: () => void = () => {};
        const handle: StreamHandle = {
            events: [],
            // Events sent before the server processed the attach would be
            // missed, so callers wait on the headers before acting.
            opened: new Promise<void>((resolve) => {
                signalOpen = resolve;
            }),
            close: () => outgoing.destroy(),
        };
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
                signalOpen();
                let buffer = ``;
                response.on(`data`, (chunk: Buffer) => {
                    buffer += chunk.toString();
                    let newline = buffer.indexOf(`\n`);
                    while (newline >= 0) {
                        const line = buffer.slice(0, newline);
                        buffer = buffer.slice(newline + 1);
                        if (line.trim() !== ``) handle.events.push(JSON.parse(line) as StreamEvent);
                        newline = buffer.indexOf(`\n`);
                    }
                });
            },
        );
        outgoing.on(`error`, () => {
            // A destroyed stream surfaces as a late socket error.
        });
        outgoing.end();
        return handle;
    }

    async bot(token: string, open = true): Promise<BotFixture> {
        await this.declare(token, wideAccepts);
        const stream = this.openStream(token, open);
        await stream.opened;
        return { token, stream };
    }

    async humanGame(cookie: string, botName: string): Promise<number> {
        return (
            await this.#call(
                `POST`,
                `/api/games`,
                { cookie, 'content-type': `application/json` },
                { bot: botName, timeControl: turnControl },
            )
        ).status;
    }

    challenge(token: string, target: string, body: unknown): Promise<HttpResult> {
        return this.#call(
            `POST`,
            `/api/bot/challenge/${target}`,
            { authorization: `Bearer ${token}`, 'content-type': `application/json` },
            body,
        );
    }

    accept(token: string, challengeId: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/bot/challenge/${challengeId}/accept`, { authorization: `Bearer ${token}` });
    }

    decline(token: string, challengeId: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/bot/challenge/${challengeId}/decline`, { authorization: `Bearer ${token}` });
    }

    cancel(token: string, challengeId: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/bot/challenge/${challengeId}/cancel`, { authorization: `Bearer ${token}` });
    }

    botResign(gameId: string, token: string): Promise<HttpResult> {
        return this.#call(`POST`, `/api/bot/game/${gameId}/resign`, { authorization: `Bearer ${token}` });
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

    seedBotGame(challenger: string, dest: string): void {
        insertBotGame(createQuery(this.world.sqlite), {
            challengerBotId: findBot(createQuery(this.world.sqlite), nameKeyOf(challenger))?.id ?? ``,
            destBotId: findBot(createQuery(this.world.sqlite), nameKeyOf(dest))?.id ?? ``,
            challengerSide: `x`,
            timeControl: unlimitedControl,
            opening: [{ x: 0, y: 0, player: 0 }],
        });
    }

    challengeRow(challengeId: string) {
        return findChallenge(createQuery(this.world.sqlite), challengeId);
    }

    async close(): Promise<void> {
        this.app.server.closeAllConnections();
        await this.app.close();
        this.world.sqlite.close();
    }
}

type Typed<T extends StreamEvent[`type`]> = Extract<StreamEvent, { type: T }>;

async function eventOn<T extends StreamEvent[`type`]>(stream: StreamHandle, type: T): Promise<Typed<T>> {
    await until(() => stream.events.some((event) => event.type === type));
    const found = stream.events.findLast((event) => event.type === type);
    if (found === undefined) throw new Error(`${type} vanished`);
    return found as Typed<T>;
}

const answered = new WeakMap<EngineHandle, number>();

async function botAnswer(engine: EngineHandle, cells: { q: number; r: number }[]): Promise<BwsMoveRequestPacket> {
    const index = answered.get(engine) ?? 0;
    const moveRequests = () =>
        engine.packets.filter(
            (packet): packet is BwsMoveRequestPacket => (packet as { type?: unknown }).type === `move_request`,
        );
    await until(() => moveRequests().length > index);
    const request = moveRequests()[index];
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

async function createChallenge(arena: Arena, challenger: BotFixture, requestId: string): Promise<string> {
    const result = await arena.challenge(challenger.token, `secondbot`, {
        timeControl: turnControl,
        openingStones: 0,
        firstPlayer: `challenger`,
        requestId,
    });
    expect(result.status).toBe(201);
    return challengeSchema.parse(json(result)).challengeId;
}

describe('the bot-vs-bot challenge inbox', () => {
    let arena: Arena;
    let first: BotFixture;
    let second: BotFixture;

    beforeEach(async () => {
        vi.useFakeTimers(timerFakes);
        const world = await createTestApp({ random: () => 0.9 });
        await world.app.listen({ host: `127.0.0.1`, port: 0 });
        arena = new Arena(world.app, world);
        const firstCookie = await arena.login(`firstowner`);
        const firstToken = await arena.createBot(firstCookie, `firstbot`);
        const secondCookie = await arena.login(`secondowner`);
        const secondToken = await arena.createBot(secondCookie, `secondbot`);
        first = await arena.bot(firstToken);
        second = await arena.bot(secondToken);
    });

    afterEach(async () => {
        first.stream.close();
        second.stream.close();
        await arena.close();
        vi.useRealTimers();
    });

    it('runs a normal game from challenge to finish over two engine sessions', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        const offered = await eventOn(second.stream, `challenge`);
        expect(offered.challenge).toMatchObject({
            challengeId,
            challenger: { name: `firstbot`, rating: 1500, provisional: true },
            destUser: { name: `secondbot`, rating: 1500, provisional: true },
            timeControl: turnControl,
            openingStones: 0,
            firstPlayer: `challenger`,
            status: `created`,
        });
        const accepted = await arena.accept(second.token, challengeId);
        expect(accepted.status).toBe(200);
        expect(json(accepted)).toEqual({ ok: true });

        const challengerStart = await eventOn(first.stream, `gameStart`);
        const destStart = await eventOn(second.stream, `gameStart`);
        // The challenger was named first player and no opening stones were
        // asked for, so the challenger takes o and the first turn.
        expect(challengerStart.side).toBe(`o`);
        expect(challengerStart.opponent).toEqual({ name: `secondbot`, rating: 1500, provisional: true });
        expect(destStart.side).toBe(`x`);
        expect(challengerStart.engine.token).not.toBe(destStart.engine.token);

        const challengerEngine = await arena.dialEngine(challengerStart.engine.socketUrl, challengerStart.engine.token);
        const destEngine = await arena.dialEngine(destStart.engine.socketUrl, destStart.engine.token);
        const firstMove = await botAnswer(challengerEngine, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        expect(firstMove.side).toBe(`o`);
        const secondMove = await botAnswer(destEngine, [
            { q: 0, r: 1 },
            { q: 0, r: 2 },
        ]);
        expect(secondMove.side).toBe(`x`);
        expect(secondMove.previous).toHaveLength(1);

        const resigned = await arena.botResign(destStart.gameId, destStart.engine.token);
        expect(resigned.status).toBe(200);
        expect(await eventOn(first.stream, `gameFinish`)).toMatchObject({
            gameId: destStart.gameId,
            winner: `o`,
            reason: `surrender`,
        });
        expect(await eventOn(second.stream, `gameFinish`)).toMatchObject({
            winner: `o`,
            reason: `surrender`,
        });
        expect(arena.challengeRow(challengeId)).toMatchObject({ status: `accepted`, gameId: destStart.gameId });
        await until(() => challengerEngine.socket.readyState === WebSocket.CLOSED);
        await until(() => destEngine.socket.readyState === WebSocket.CLOSED);
    });

    it('declines reach the challenger and close the challenge', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        const declined = await arena.decline(second.token, challengeId);
        expect(declined.status).toBe(200);
        expect(await eventOn(first.stream, `challengeDeclined`)).toMatchObject({
            challenge: { challengeId, status: `declined` },
        });
        const wrongActor = await arena.decline(first.token, challengeId);
        expect(wrongActor.status).toBe(404);
        const accepted = await arena.accept(second.token, challengeId);
        expect(accepted.status).toBe(404);
        expect(arena.challengeRow(challengeId)).toMatchObject({ status: `declined` });
    });

    it('cancellations reach the target and only the challenger may cancel', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        const byDest = await arena.cancel(second.token, challengeId);
        expect(byDest.status).toBe(404);
        const canceled = await arena.cancel(first.token, challengeId);
        expect(canceled.status).toBe(200);
        expect(await eventOn(second.stream, `challengeCanceled`)).toMatchObject({
            reason: `canceled`,
            challenge: { challengeId, status: `canceled` },
        });
        const again = await arena.cancel(first.token, challengeId);
        expect(again.status).toBe(404);
        expect(arena.challengeRow(challengeId)).toMatchObject({ status: `canceled` });
    });

    it('expires after the TTL and tells both sides', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(await eventOn(first.stream, `challengeCanceled`)).toMatchObject({
            reason: `expired`,
            challenge: { challengeId, status: `expired` },
        });
        expect(await eventOn(second.stream, `challengeCanceled`)).toMatchObject({ reason: `expired` });
        const accepted = await arena.accept(second.token, challengeId);
        expect(accepted.status).toBe(404);
        expect(arena.challengeRow(challengeId)).toMatchObject({ status: `expired` });
    });

    it('is idempotent on the client request id across outcomes', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        const replay = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(replay.status).toBe(200);
        expect(challengeSchema.parse(json(replay)).challengeId).toBe(challengeId);
        const other = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-2`,
        });
        expect(other.status).toBe(201);
        expect(challengeSchema.parse(json(other)).challengeId).not.toBe(challengeId);
        await vi.advanceTimersByTimeAsync(60_000);
        const afterExpiry = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(afterExpiry.status).toBe(200);
        expect(challengeSchema.parse(json(afterExpiry))).toMatchObject({
            challengeId,
            status: `expired`,
        });
        // One inbox line per challenge: the replay created nothing.
        const offers = second.stream.events.filter((event) => event.type === `challenge`);
        expect(offers).toHaveLength(2);
    });

    it('refuses a target the challenger owner also owns', async () => {
        const firstCookie = await arena.login(`firstowner`);
        // The login resumes the owner, so the new bot shares it.
        const sibling = await arena.createBot(firstCookie, `siblingbot`);
        const own = await arena.challenge(first.token, `siblingbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(own.status).toBe(403);
        expect(json(own)).toMatchObject({ code: `own_bot` });
        const self = await arena.challenge(sibling, `siblingbot`, {
            timeControl: turnControl,
            requestId: `req-2`,
        });
        expect(self.status).toBe(403);
        expect(json(self)).toMatchObject({ code: `own_bot` });
    });

    it('refuses a target that is not online and open and one outside its accepts', async () => {
        second.stream.close();
        second.stream = arena.openStream(second.token, false);
        const closed = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(closed.status).toBe(400);
        expect(json(closed)).toMatchObject({ code: `not_open` });
        second.stream.close();
        await arena.declare(second.token, { turnMs: null, match: true, unlimited: false });
        second.stream = arena.openStream(second.token);
        await second.stream.opened;
        const clock = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-2`,
        });
        expect(clock.status).toBe(400);
        expect(json(clock)).toMatchObject({ code: `clock_not_accepted` });
    });

    it('refuses a challenge when either side is at its concurrent-game cap', async () => {
        for (const name of [`humanone`, `humantwo`, `humanthree`, `humanfour`]) {
            const cookie = await arena.login(name);
            expect(await arena.humanGame(cookie, `secondbot`)).toBe(201);
        }
        const busy = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(busy.status).toBe(400);
        expect(json(busy)).toMatchObject({ code: `bot_busy` });
    });

    it('re-checks the concurrent cap at accept and keeps the challenge pending', async () => {
        for (const name of [`humanone`, `humanthree`, `humanfour`]) {
            const cookie = await arena.login(name);
            expect(await arena.humanGame(cookie, `secondbot`)).toBe(201);
        }
        const challengeId = await createChallenge(arena, first, `req-1`);
        const cookie = await arena.login(`humantwo`);
        expect(await arena.humanGame(cookie, `secondbot`)).toBe(201);
        const busy = await arena.accept(second.token, challengeId);
        expect(busy.status).toBe(400);
        expect(json(busy)).toMatchObject({ code: `bot_busy` });
        expect(arena.challengeRow(challengeId)).toMatchObject({ status: `created` });
        const declined = await arena.decline(second.token, challengeId);
        expect(declined.status).toBe(200);
    });

    it('bounds the target inbox at ten pending challenges', async () => {
        const firstCookie = await arena.login(`firstowner`);
        const secondSibling = await arena.createBot(firstCookie, `siblingbot`);
        const thirdSibling = await arena.createBot(firstCookie, `thirdbot`);
        for (let i = 1; i <= 4; i += 1) {
            expect(await createChallengeStatus(arena, first.token, `r-first-${String(i)}`)).toBe(201);
        }
        for (let i = 1; i <= 3; i += 1) {
            expect(await createChallengeStatus(arena, secondSibling, `r-second-${String(i)}`)).toBe(201);
        }
        for (let i = 1; i <= 3; i += 1) {
            expect(await createChallengeStatus(arena, thirdSibling, `r-third-${String(i)}`)).toBe(201);
        }
        const full = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `r-first-5`,
        });
        expect(full.status).toBe(400);
        expect(json(full)).toMatchObject({ code: `inbox_full` });
    });

    it('caps a pair at twenty bot-vs-bot games a day', async () => {
        for (let i = 0; i < 20; i += 1) {
            arena.seedBotGame(`firstbot`, `secondbot`);
        }
        const capped = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(capped.status).toBe(400);
        expect(json(capped)).toMatchObject({ code: `daily_pair_cap` });
    });

    it('caps a bot at a hundred bot-vs-bot games a day', async () => {
        const secondCookie = await arena.login(`secondowner`);
        const otherDest = await arena.createBot(secondCookie, `otherdest`);
        await arena.declare(otherDest, wideAccepts);
        const otherStream = arena.openStream(otherDest);
        await otherStream.opened;
        for (let i = 0; i < 100; i += 1) {
            arena.seedBotGame(`firstbot`, `otherdest`);
        }
        const capped = await arena.challenge(first.token, `secondbot`, {
            timeControl: turnControl,
            requestId: `req-1`,
        });
        expect(capped.status).toBe(400);
        expect(json(capped)).toMatchObject({ code: `daily_bot_cap` });
        otherStream.close();
    });

    it('replays a pending challenge when the target reconnects inside the TTL', async () => {
        const challengeId = await createChallenge(arena, first, `req-1`);
        second.stream.close();
        await vi.advanceTimersByTimeAsync(1_000);
        second.stream = arena.openStream(second.token);
        await second.stream.opened;
        const replayed = await eventOn(second.stream, `challenge`);
        expect(replayed.challenge.challengeId).toBe(challengeId);
        const accepted = await arena.accept(second.token, challengeId);
        expect(accepted.status).toBe(200);
    });
});

async function createChallengeStatus(arena: Arena, token: string, requestId: string): Promise<number> {
    return (
        await arena.challenge(token, `secondbot`, {
            timeControl: turnControl,
            requestId,
        })
    ).status;
}
