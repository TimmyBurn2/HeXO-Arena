import { botWithTokenSchema, discordCallbackPath, discordLoginPath, healthzPath, type StreamEvent } from '@hexo-arena/contract';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestApp, type TestApp } from './helpers';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), `../../web/index.html`);
const logRecordSchema = z.record(z.string(), z.unknown());

class LogSink extends Writable {
    readonly lines: string[] = [];

    override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
        this.lines.push(chunk.toString());
        callback();
    }

    text(): string {
        return this.lines.join(`\n`);
    }

    records(): Record<string, unknown>[] {
        return this.lines.map((line) => logRecordSchema.parse(JSON.parse(line)));
    }
}

interface HttpResult {
    status: number;
    text: string;
    setCookie: string[];
    location: string | undefined;
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
                    location: response.headers.location,
                });
            });
        });
        outgoing.on(`error`, reject);
        if (body !== undefined) outgoing.write(body);
        outgoing.end();
    });
}

async function until(predicate: () => boolean, spins = 5_000): Promise<void> {
    for (let spin = 0; spin < spins; spin += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
    throw new Error(`condition not reached in time`);
}

interface SeatedGame {
    start: { engine: { socketUrl: string; token: string } };
    stream: http.ClientRequest;
}

// A signed-in human starts a game against another owner's freshly declared
// bot, whose stream hands over the engine session.
async function seatBotInGame(port: number): Promise<SeatedGame> {
    const devLogin = async (name: string): Promise<string> => {
        const login = await request(port, `POST`, `/api/dev/login`, { 'content-type': `application/json` }, JSON.stringify({ name }));
        expect(login.status).toBe(200);
        return login.setCookie[0]?.split(`;`)[0] ?? ``;
    };
    const owner = await devLogin(`botowner`);
    const cookie = await devLogin(`humanplayer`);
    const created = await request(port, `POST`, `/api/bots`, { cookie: owner, 'content-type': `application/json` }, `{"name":"opponentbot"}`);
    expect(created.status).toBe(201);
    const token = botWithTokenSchema.parse(JSON.parse(created.text)).token;
    const declared = await request(
        port,
        `PATCH`,
        `/api/bot/account`,
        { authorization: `Bearer ${token}`, 'content-type': `application/json` },
        `{"accepts":{"turnMs":[5000,600000],"match":true,"unlimited":true}}`,
    );
    expect(declared.status).toBe(200);

    const events: StreamEvent[] = [];
    const stream = http.request(
        { host: `127.0.0.1`, port, path: `/api/bot/stream?open=1`, method: `GET`, headers: { authorization: `Bearer ${token}` } },
        (response) => {
            let buffer = ``;
            response.on(`data`, (chunk: Buffer) => {
                buffer += chunk.toString();
                let newline = buffer.indexOf(`\n`);
                while (newline >= 0) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    if (line.trim() !== ``) events.push(JSON.parse(line) as StreamEvent);
                    newline = buffer.indexOf(`\n`);
                }
            });
        },
    );
    stream.on(`error`, () => {
        // A destroyed stream surfaces as a late socket error.
    });
    stream.end();

    const game = await request(port, `POST`, `/api/games`, { cookie, 'content-type': `application/json` }, `{"bot":"opponentbot","timeControl":{"mode":"turn","turnTimeMs":30000}}`);
    expect(game.status).toBe(201);
    await until(() => events.some((event) => event.type === `gameStart`));
    const start = events.find((event) => event.type === `gameStart`);
    if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
    return { start, stream };
}

// The status a websocket upgrade is answered with: 101 when it opens.
function upgradeStatus(url: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.on(`unexpected-response`, (_request, response) => {
            resolve(response.statusCode ?? 0);
        });
        socket.on(`open`, () => {
            socket.close();
            resolve(101);
        });
        socket.on(`error`, reject);
    });
}

describe('request logging', () => {
    let world: TestApp;
    let sink: LogSink;
    let port: number;

    beforeEach(async () => {
        sink = new LogSink();
        world = await createTestApp({ logger: { level: `trace`, stream: sink }, webIndexPath: indexPath });
        await world.app.listen({ host: `127.0.0.1`, port: 0 });
        const address = world.app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        port = address.port;
        // The listen line names the server's own address; only request lines are on trial.
        sink.lines.splice(0);
    });

    afterEach(async () => {
        world.app.server.closeAllConnections();
        await world.app.close();
        world.sqlite.close();
    });

    it('keeps the oauth code, the state, and the return path out of every line, whatever the callback answers', async () => {
        await request(port, `GET`, `${discordCallbackPath}?code=codemarker&state=statemarker`, {});
        const login = await request(port, `GET`, `${discordLoginPath}?next=${encodeURIComponent(`/bots/nextmarker`)}`, {});
        const issued = new URL(login.location ?? ``).searchParams.get(`state`) ?? ``;
        expect(issued).not.toBe(``);
        const binding = login.setCookie[0]?.split(`;`)[0] ?? ``;
        const signedIn = await request(port, `GET`, `${discordCallbackPath}?code=codemarker&state=${issued}`, { cookie: binding });
        expect(signedIn.status).toBe(302);
        expect(signedIn.location).toBe(`/welcome`);

        const logs = sink.text();
        expect(sink.records()).toContainEqual(expect.objectContaining({ req: { method: `GET`, route: discordCallbackPath } }));
        expect(logs).not.toContain(`codemarker`);
        expect(logs).not.toContain(`statemarker`);
        expect(logs).not.toContain(issued);
        expect(logs).not.toContain(binding.slice(binding.indexOf(`=`) + 1));
        expect(logs).not.toContain(`nextmarker`);
    });

    it('logs a bot request by its route pattern, never by the name', async () => {
        await request(port, `DELETE`, `/api/bots/namemarker`, {});

        expect(sink.records()).toContainEqual(expect.objectContaining({ req: { method: `DELETE`, route: `/api/bots/:name` } }));
        expect(sink.text()).not.toContain(`namemarker`);
    });

    it('logs a bot page by its route pattern, never by the name', async () => {
        await request(port, `GET`, `/bots/shellmarker`, {});

        expect(sink.records()).toContainEqual(expect.objectContaining({ req: { method: `GET`, route: `/bots/:name` } }));
        expect(sink.text()).not.toContain(`shellmarker`);
    });

    it('logs an unmatched path as a 404 with no route, no path, and no query', async () => {
        const missing = await request(port, `GET`, `/nowhere/pathmarker?q=querymarker`, {});

        expect(missing.status).toBe(404);
        expect(missing.text).toBe(`{"error":"not found","code":"not_found"}`);
        const records = sink.records();
        expect(records).toContainEqual(expect.objectContaining({ req: { method: `GET`, route: null } }));
        expect(records).toContainEqual(expect.objectContaining({ res: { statusCode: 404 } }));
        expect(sink.text()).not.toContain(`pathmarker`);
        expect(sink.text()).not.toContain(`querymarker`);
    });

    it('logs a path the router cannot decode, or one past the parameter cap, without the path', async () => {
        const undecodable = await request(port, `GET`, `/api/players/pathmarker%c0`, {});
        const long = await request(port, `GET`, `/api/players/${`pathmarker`.repeat(12)}`, {});

        expect([undecodable.status, long.status]).toEqual([400, 414]);
        expect(sink.records()).toContainEqual(expect.objectContaining({ res: { statusCode: 400 }, err: { code: `FST_ERR_BAD_URL`, statusCode: 400 } }));
        expect(sink.records()).toContainEqual(expect.objectContaining({ res: { statusCode: 414 }, err: { code: `FST_ERR_MAX_PARAM_LENGTH`, statusCode: 414 } }));
        expect(sink.text()).not.toContain(`pathmarker`);
    });

    it('logs a malformed json body as a 400 with its error code, never its message or the body', async () => {
        const refused = await request(port, `POST`, `/api/bots`, { 'content-type': `application/json` }, `{"name": bodymarker`);
        expect(refused.status).toBe(400);

        expect(sink.records()).toContainEqual(
            expect.objectContaining({ res: { statusCode: 400 }, err: { code: `FST_ERR_CTP_INVALID_JSON_BODY`, statusCode: 400 } }),
        );
        expect(sink.text()).not.toContain(`bodymarker`);
        expect(sink.text()).not.toContain(`not valid JSON`);
    });

    it('writes no url, host, or client address on any line', async () => {
        await request(port, `GET`, `${discordCallbackPath}?code=codemarker&state=statemarker`, {});
        await request(port, `DELETE`, `/api/bots/namemarker`, {});
        await request(port, `GET`, `/bots/shellmarker`, {});
        await request(port, `GET`, `/nowhere/pathmarker?q=querymarker`, {});
        await request(port, `POST`, `/api/bots`, { 'content-type': `application/json` }, `{"name": bodymarker`);

        const logs = sink.text();
        expect(sink.lines.length).toBeGreaterThan(0);
        expect(logs).not.toContain(`remoteAddress`);
        expect(logs).not.toContain(`remotePort`);
        expect(logs).not.toContain(`127.0.0.1`);
        expect(logs).not.toContain(`"url":`);
        expect(logs).not.toContain(`"host":`);
    });

    it('still writes method, route, and status on ordinary lines', async () => {
        const health = await request(port, `GET`, healthzPath, {});
        expect(health.status).toBe(200);

        const records = sink.records();
        expect(records).toContainEqual(expect.objectContaining({ req: { method: `GET`, route: healthzPath } }));
        const completed = records.find((record) => record.msg === `request completed`);
        expect(completed?.res).toEqual({ statusCode: 200 });
        expect(typeof completed?.responseTime).toBe(`number`);
        expect(records.every((record) => typeof record.reqId === `string`)).toBe(true);
    });

    it('keeps the engine session token out of the logs while logging the rest', async () => {
        const { start, stream } = await seatBotInGame(port);

        const engine = new WebSocket(`ws://127.0.0.1:${String(port)}${start.engine.socketUrl}?token=${start.engine.token}`);
        await until(() => engine.readyState === WebSocket.OPEN);
        const refused = new WebSocket(`ws://127.0.0.1:${String(port)}${start.engine.socketUrl}?token=hgs_wrong`);
        await new Promise<void>((resolve) => {
            refused.on(`unexpected-response`, (_request, response) => {
                expect(response.statusCode).toBe(404);
                resolve();
            });
            refused.on(`open`, () => {
                throw new Error(`connection unexpectedly opened`);
            });
        });
        engine.close();
        stream.destroy();
        await until(() => sink.lines.length > 0);

        const logs = sink.text();
        // The socket route logs like any other, so the token's absence is the serializer's doing.
        expect(logs).toContain(`/api/games`);
        expect(logs).toContain(`/api/bot/game/:gameId/socket`);
        expect(logs).not.toContain(`token=`);
        expect(logs).not.toContain(`hgs_`);
        expect(logs).not.toContain(`hxo_`);
    });

    it('keeps a stream\'s User-Agent out of the logs while logging its route', async () => {
        const login = await request(port, `POST`, `/api/dev/login`, { 'content-type': `application/json` }, JSON.stringify({ name: `botowner` }));
        const owner = login.setCookie[0]?.split(`;`)[0] ?? ``;
        const created = await request(port, `POST`, `/api/bots`, { cookie: owner, 'content-type': `application/json` }, `{"name":"agentbot"}`);
        const token = botWithTokenSchema.parse(JSON.parse(created.text)).token;
        const opened = await new Promise<http.ClientRequest>((resolve, reject) => {
            const stream = http.get(
                { host: `127.0.0.1`, port, path: `/api/bot/stream`, headers: { authorization: `Bearer ${token}`, 'user-agent': `hexo-bridge/0.3.0 agentmarker` } },
                (response) => {
                    expect(response.statusCode).toBe(200);
                    resolve(stream);
                },
            );
            stream.on(`error`, reject);
        });
        opened.destroy();

        expect(sink.records()).toContainEqual(expect.objectContaining({ req: { method: `GET`, route: `/api/bot/stream` } }));
        expect(sink.text()).not.toContain(`agentmarker`);
        expect(sink.text()).not.toContain(`hexo-bridge`);
    });

    it('refuses an upgrade to an ordinary route without logging its path, while the engine socket opens', async () => {
        const shell = await upgradeStatus(`ws://127.0.0.1:${String(port)}/bots/upgrademarker`);
        const api = await upgradeStatus(`ws://127.0.0.1:${String(port)}/api/leaderboard?kind=upgradequerymarker`);
        const { start, stream } = await seatBotInGame(port);
        const engine = await upgradeStatus(`ws://127.0.0.1:${String(port)}${start.engine.socketUrl}?token=${start.engine.token}`);
        stream.destroy();
        await until(() => sink.lines.length > 0);

        expect(sink.text()).not.toContain(`upgrademarker`);
        expect(sink.text()).not.toContain(`upgradequerymarker`);
        expect([shell, api, engine]).toEqual([404, 404, 101]);
    });
});

describe('a server error', () => {
    let world: TestApp;
    let sink: LogSink;

    beforeEach(async () => {
        sink = new LogSink();
        world = await createTestApp({ logger: { level: `info`, stream: sink } });
        world.app.get(`/api/fails`, { config: { limit: `public` } }, () => {
            throw new Error(`secretmarker`);
        });
        world.app.get(`/api/unavailable`, { config: { limit: `public` } }, () => {
            throw Object.assign(new Error(`secretmarker`), { statusCode: 503 });
        });
    });

    afterEach(async () => {
        await world.app.close();
        world.sqlite.close();
    });

    it('answers internal error without its message, and logs the message and stack', async () => {
        const failed = await world.app.inject({ method: `GET`, url: `/api/fails` });
        expect(failed.statusCode).toBe(500);
        expect(failed.json()).toEqual({ error: `internal error`, code: `internal` });
        expect(failed.body).not.toContain(`secretmarker`);
        const logged = sink.records().find((record) => record.msg === `request failed`);
        expect(logged).toMatchObject({ level: 50, req: { method: `GET`, route: `/api/fails` }, res: { statusCode: 500 }, err: { message: `secretmarker` } });
        expect(JSON.stringify(logged)).toContain(`request-logging.test.ts`);
    });

    it('answers an error carrying a server status the same way', async () => {
        const failed = await world.app.inject({ method: `GET`, url: `/api/unavailable` });
        expect(failed.statusCode).toBe(500);
        expect(failed.json()).toEqual({ error: `internal error`, code: `internal` });
    });
});
