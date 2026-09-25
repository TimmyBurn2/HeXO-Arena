import { botWithTokenSchema, type StreamEvent } from '@hexarena/contract';
import http from 'node:http';
import { Writable } from 'node:stream';
import WebSocket from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

class LogSink extends Writable {
    readonly lines: string[] = [];

    override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
        this.lines.push(chunk.toString());
        callback();
    }

    text(): string {
        return this.lines.join(`\n`);
    }
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

async function until(predicate: () => boolean, spins = 5_000): Promise<void> {
    for (let spin = 0; spin < spins; spin += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
    throw new Error(`condition not reached in time`);
}

describe('request logging', () => {
    let world: TestApp;
    let sink: LogSink;
    let port: number;

    beforeEach(async () => {
        sink = new LogSink();
        world = await createTestApp({ logger: { level: `trace`, stream: sink } });
        await world.app.listen({ host: `127.0.0.1`, port: 0 });
        const address = world.app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        port = address.port;
    });

    afterEach(async () => {
        world.app.server.closeAllConnections();
        await world.app.close();
        world.sqlite.close();
    });

    it('keeps the engine session token out of the logs while logging the rest', async () => {
        const login = await request(port, `POST`, `/api/dev/login`, { 'content-type': `application/json` }, `{"name":"humanplayer"}`);
        expect(login.status).toBe(200);
        const cookie = login.setCookie[0]?.split(`;`)[0] ?? ``;
        const created = await request(port, `POST`, `/api/bots`, { cookie, 'content-type': `application/json` }, `{"name":"opponentbot"}`);
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
        // Ordinary routes leave ordinary lines, so the silence below is the
        // route's doing, not a broken logger.
        expect(logs).toContain(`/api/games`);
        expect(logs).not.toContain(`token=`);
        expect(logs).not.toContain(`hgs_`);
        expect(logs).not.toContain(`hxo_`);
    });
});
