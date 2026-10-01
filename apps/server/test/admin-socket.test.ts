import { adminRequestLimitBytes, adminResponseSchema, type AdminResponse } from '@hexo-arena/contract';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listenAdminSocket, type AdminHandler } from '../src/admin-socket';

// Writes the raw bytes and collects everything until the server closes,
// so a test sees exactly what went over the wire.
function exchange(path: string, text: string, options: { endSide: boolean }): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = connect(path);
        let received = ``;
        socket.on(`data`, (chunk: Buffer) => {
            received += chunk.toString();
        });
        socket.on(`close`, () => {
            resolve(received);
        });
        socket.on(`error`, reject);
        socket.write(text);
        if (options.endSide) socket.end();
    });
}

function parseLine(received: string): AdminResponse {
    expect(received.endsWith(`\n`)).toBe(true);
    expect(received.indexOf(`\n`)).toBe(received.length - 1);
    return adminResponseSchema.parse(JSON.parse(received));
}

const statusAnswer: AdminResponse = {
    kind: `status`,
    status: { uptimeSeconds: 1, paused: false, liveStreams: 0, activeGames: 0, clientKeys: 0, keylessRequests: 0, tournaments: [], recentActions: [] },
};

describe('the admin socket', () => {
    let directory: string;
    let path: string;
    let server: Server | null;
    let errors: object[];
    let handle: AdminHandler;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), `hexo-arena-admin-`));
        path = join(directory, `run`, `admin.sock`);
        server = null;
        errors = [];
        handle = () => statusAnswer;
    });

    afterEach(() => {
        server?.close();
        rmSync(directory, { recursive: true, force: true });
    });

    async function listen(): Promise<Server> {
        server = await listenAdminSocket(
            path,
            (request) => handle(request),
            {
                error: (details) => {
                    errors.push(details);
                },
            },
        );
        return server;
    }

    it('answers one newline-ended request with one line and closes', async () => {
        await listen();
        const received = await exchange(path, `{"op":"status"}\n`, { endSide: false });
        expect(parseLine(received)).toEqual(statusAnswer);
    });

    it('answers a request the client ended by closing its side', async () => {
        await listen();
        const received = await exchange(path, `{"op":"status"}`, { endSide: true });
        expect(parseLine(received)).toEqual(statusAnswer);
    });

    it('creates a private directory and a socket only its owner can open', async () => {
        await listen();
        expect(statSync(join(directory, `run`)).mode & 0o777).toBe(0o700);
        expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it('answers bad_request to input that is not json', async () => {
        await listen();
        const received = await exchange(path, `status please\n`, { endSide: false });
        expect(parseLine(received)).toMatchObject({ kind: `error`, code: `bad_request` });
    });

    it.each([
        [`an unknown op`, `{"op":"reset-rating"}`],
        [`an unknown key`, `{"op":"status","force":true}`],
        [`a bare value`, `42`],
    ])('answers bad_request to %s', async (_label, text) => {
        await listen();
        const received = await exchange(path, `${text}\n`, { endSide: false });
        expect(parseLine(received)).toMatchObject({ kind: `error`, code: `bad_request` });
    });

    it('refuses a request over the size cap without reading it whole', async () => {
        let handled = false;
        handle = () => {
            handled = true;
            return statusAnswer;
        };
        await listen();
        const received = await exchange(path, `"${`a`.repeat(adminRequestLimitBytes)}"\n`, { endSide: false });
        expect(parseLine(received)).toMatchObject({ kind: `error`, code: `bad_request` });
        expect(handled).toBe(false);
    });

    it('logs a handler exception, drops that connection, and keeps serving', async () => {
        handle = () => {
            throw new Error(`boom`);
        };
        await listen();
        expect(await exchange(path, `{"op":"status"}\n`, { endSide: false })).toBe(``);
        expect(errors).toHaveLength(1);
        handle = () => statusAnswer;
        expect(parseLine(await exchange(path, `{"op":"status"}\n`, { endSide: false }))).toEqual(statusAnswer);
    });

    it('refuses to start in a directory others can reach', async () => {
        const open = join(directory, `open`);
        mkdirSync(open);
        chmodSync(open, 0o755);
        path = join(open, `admin.sock`);
        await expect(listen()).rejects.toThrow(/mode 0700/);
    });

    it('a stale socket is recovered', async () => {
        mkdirSync(join(directory, `run`), { mode: 0o700 });
        // A server killed outright never unlinks its socket, which is the
        // unclean stop a bare dev run can suffer.
        const killed = spawnSync(process.execPath, [
            `-e`,
            `require('node:net').createServer().listen(process.argv[1], () => process.kill(process.pid, 'SIGKILL'))`,
            path,
        ]);
        expect(killed.signal).toBe(`SIGKILL`);
        expect(lstatSync(path).isSocket()).toBe(true);
        await listen();
        expect(parseLine(await exchange(path, `{"op":"status"}\n`, { endSide: false }))).toEqual(statusAnswer);
    });

    it('a live holder refuses the boot', async () => {
        const first = await listen();
        await expect(
            listenAdminSocket(path, handle, { error: () => undefined }),
        ).rejects.toThrow(`admin socket ${path} is held by a running server`);
        expect(parseLine(await exchange(path, `{"op":"status"}\n`, { endSide: false }))).toEqual(statusAnswer);
        expect(errors).toEqual([]);
        first.close();
    });

    it('a regular file refuses the boot and survives', async () => {
        mkdirSync(join(directory, `run`), { mode: 0o700 });
        writeFileSync(path, `keep me`);
        await expect(listen()).rejects.toThrow(`admin socket path ${path} holds a file that is not a socket`);
        expect(readFileSync(path, `utf8`)).toBe(`keep me`);
    });
});
