import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatAdminResponse, parseAdminArgs, sendAdminRequest } from '../src/admin-client';
import { listenAdminSocket } from '../src/admin-socket';
import { createTestApp, type TestApp } from './helpers';

describe('parseAdminArgs', () => {
    it.each([
        [[`status`], { op: `status` }],
        [[`pause`, `--reason`, `incident`], { op: `pause`, reason: `incident` }],
        [[`ban-user`, `ann`, `--reason`, `cheating`], { op: `ban-user`, name: `ann`, reason: `cheating` }],
        [[`abort-game`, `--bot`, `alpha`, `--reason`, `rogue`], { op: `abort-game`, bot: `alpha`, reason: `rogue` }],
        [
            [`recompute-ratings`, `--exclude`, `alpha`, `--exclude`, `beta`, `--reason`, `farming`],
            { op: `recompute-ratings`, exclude: [`alpha`, `beta`], reason: `farming` },
        ],
        [[`recompute-ratings`, `--reason`, `routine`], { op: `recompute-ratings`, exclude: [], reason: `routine` }],
    ])('turns %j into the socket request', (argv, request) => {
        expect(parseAdminArgs(argv)).toEqual({ kind: `request`, request });
    });

    it.each([
        [`no op`, []],
        [`a mutation without a reason`, [`ban-user`, `ann`]],
        [`a named op without a name`, [`delist-bot`, `--reason`, `r`]],
        [`an unknown op`, [`reset-rating`, `ann`, `--reason`, `r`]],
        [`an unknown flag`, [`pause`, `--force`, `--reason`, `r`]],
        [`a stray argument`, [`ban-user`, `ann`, `bob`, `--reason`, `r`]],
        [`both abort targets`, [`abort-game`, `g_0b7a3c1e-2f4d-4a5b-8c6d-7e8f9a0b1c2d`, `--bot`, `alpha`, `--reason`, `r`]],
    ])('refuses %s with usage', (_label, argv) => {
        expect(parseAdminArgs(argv).kind).toBe(`usage`);
    });
});

describe('formatAdminResponse', () => {
    it('renders status as one screen and errors with their code', () => {
        const screen = formatAdminResponse({
            kind: `status`,
            status: {
                uptimeSeconds: 42,
                paused: true,
                liveStreams: 3,
                activeGames: 1,
                recentActions: [{ actor: `operator`, action: `pause`, target: null, reason: `incident`, at: 0 }],
            },
        });
        expect(screen).toBe(
            [
                `uptime        42 s`,
                `paused        yes`,
                `live streams  3`,
                `active games  1`,
                `recent admin actions:`,
                `  1970-01-01T00:00:00.000Z  operator  pause  -  incident`,
            ].join(`\n`),
        );
        expect(formatAdminResponse({ kind: `error`, code: `not_found`, error: `no such user` })).toBe(`not_found: no such user`);
    });
});

describe('sendAdminRequest', () => {
    let directory: string;
    let server: Server;
    let world: TestApp;

    afterEach(async () => {
        server.close();
        await world.app.close();
        rmSync(directory, { recursive: true, force: true });
    });

    it('carries a request to the running app and its answer back', async () => {
        directory = mkdtempSync(join(tmpdir(), `hexarena-cli-`));
        const path = join(directory, `admin.sock`);
        world = await createTestApp({ logger: false });
        server = await listenAdminSocket(path, world.admin, { error: () => undefined });
        expect(await sendAdminRequest(path, { op: `pause`, reason: `incident` })).toEqual({ kind: `done`, summary: `paused` });
        expect(await sendAdminRequest(path, { op: `status` })).toMatchObject({ status: { paused: true } });
    });

    it('rejects when the server drops the connection unanswered', async () => {
        directory = mkdtempSync(join(tmpdir(), `hexarena-cli-`));
        const path = join(directory, `admin.sock`);
        world = await createTestApp({ logger: false });
        server = await listenAdminSocket(
            path,
            () => {
                throw new Error(`boom`);
            },
            { error: () => undefined },
        );
        await expect(sendAdminRequest(path, { op: `status` })).rejects.toThrow(/without an answer/);
    });
});
