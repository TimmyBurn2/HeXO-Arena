import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatAdminResponse, parseAdminArgs, sendAdminRequest } from '../src/admin-client';
import { listenAdminSocket } from '../src/admin-socket';
import { createTestApp, type TestApp } from './helpers';

const sundayRule = {
    id: 2,
    weekday: `sun`,
    time: `18:00`,
    namePattern: `Sunday cup {date}`,
    timeControl: { mode: `match`, mainTimeMs: 180_000, incrementMs: 2_000 },
    openingPlies: 5,
    maxEntrants: 12,
    daysAhead: 7,
    nextStartsAt: Date.UTC(2026, 9, 4, 18) / 1000,
} as const;

describe('parseAdminArgs', () => {
    it.each([
        [[`status`], { op: `status` }],
        [[`backup`], { op: `backup` }],
        [[`pause`, `--reason`, `incident`], { op: `pause`, reason: `incident` }],
        [[`ban-user`, `ann`, `--reason`, `cheating`], { op: `ban-user`, name: `ann`, reason: `cheating` }],
        [[`abort-game`, `--bot`, `alpha`, `--reason`, `rogue`], { op: `abort-game`, bot: `alpha`, reason: `rogue` }],
        [
            [`recompute-ratings`, `--exclude`, `alpha`, `--exclude`, `beta`, `--reason`, `farming`],
            { op: `recompute-ratings`, exclude: [`alpha`, `beta`], reason: `farming` },
        ],
        [[`recompute-ratings`, `--reason`, `routine`], { op: `recompute-ratings`, exclude: [], reason: `routine` }],
        [
            [`tournament-create`, `--name`, `Autumn round robin`, `--start`, `2026-10-05T18:00:00Z`, `--clock`, `turn:10`, `--reason`, `weekly`],
            {
                op: `tournament-create`,
                name: `Autumn round robin`,
                startsAt: `2026-10-05T18:00:00Z`,
                timeControl: { mode: `turn`, turnTimeMs: 10_000 },
                openingPlies: 5,
                maxEntrants: 12,
                reason: `weekly`,
            },
        ],
        [
            [`tournament-create`, `--name`, `Blitz`, `--start`, `2026-10-05T18:00:00+02:00`, `--clock`, `match:3+2`, `--opening`, `3`, `--max`, `6`, `--reason`, `r`],
            {
                op: `tournament-create`,
                name: `Blitz`,
                startsAt: `2026-10-05T18:00:00+02:00`,
                timeControl: { mode: `match`, mainTimeMs: 180_000, incrementMs: 2_000 },
                openingPlies: 3,
                maxEntrants: 6,
                reason: `r`,
            },
        ],
        [[`tournament-cancel`, `t_abcdefghijk2`, `--reason`, `rain`], { op: `tournament-cancel`, id: `t_abcdefghijk2`, reason: `rain` }],
        [
            [`tournament-schedule`, `add`, `--weekday`, `sun`, `--time`, `18:00`, `--name`, `Sunday cup {date}`, `--clock`, `turn:10`, `--reason`, `weekly`],
            {
                op: `tournament-schedule-add`,
                weekday: `sun`,
                time: `18:00`,
                namePattern: `Sunday cup {date}`,
                timeControl: { mode: `turn`, turnTimeMs: 10_000 },
                openingPlies: 5,
                maxEntrants: 12,
                daysAhead: 7,
                reason: `weekly`,
            },
        ],
        [
            [
                `tournament-schedule`,
                `add`,
                `--weekday`,
                `wed`,
                `--time`,
                `06:30`,
                `--name`,
                `Blitz`,
                `--clock`,
                `match:3+2`,
                `--opening`,
                `3`,
                `--max`,
                `6`,
                `--ahead`,
                `2`,
                `--reason`,
                `r`,
            ],
            {
                op: `tournament-schedule-add`,
                weekday: `wed`,
                time: `06:30`,
                namePattern: `Blitz`,
                timeControl: { mode: `match`, mainTimeMs: 180_000, incrementMs: 2_000 },
                openingPlies: 3,
                maxEntrants: 6,
                daysAhead: 2,
                reason: `r`,
            },
        ],
        [[`tournament-schedule`, `list`], { op: `tournament-schedule-list` }],
        [[`tournament-schedule`, `remove`, `3`, `--reason`, `done`], { op: `tournament-schedule-remove`, id: 3, reason: `done` }],
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
        [`an unlimited tournament clock`, [`tournament-create`, `--name`, `Slow`, `--start`, `2026-10-05T18:00:00Z`, `--clock`, `unlimited`, `--reason`, `r`]],
        [`a turn clock past a minute`, [`tournament-create`, `--name`, `Slow`, `--start`, `2026-10-05T18:00:00Z`, `--clock`, `turn:90`, `--reason`, `r`]],
        [`an even opening`, [`tournament-create`, `--name`, `Odd`, `--start`, `2026-10-05T18:00:00Z`, `--clock`, `turn:10`, `--opening`, `4`, `--reason`, `r`]],
        [`a start that is no time`, [`tournament-create`, `--name`, `Soon`, `--start`, `tomorrow`, `--clock`, `turn:10`, `--reason`, `r`]],
        [`a name with a tab`, [`tournament-create`, `--name`, `Tab\tcup`, `--start`, `2026-10-05T18:00:00Z`, `--clock`, `turn:10`, `--reason`, `r`]],
        [`a schedule op without its action`, [`tournament-schedule`]],
        [`an unknown schedule action`, [`tournament-schedule`, `pause`, `--reason`, `r`]],
        [`a weekday that is no weekday`, [`tournament-schedule`, `add`, `--weekday`, `someday`, `--time`, `18:00`, `--name`, `Cup`, `--clock`, `turn:10`, `--reason`, `r`]],
        [`a time past midnight`, [`tournament-schedule`, `add`, `--weekday`, `sun`, `--time`, `24:30`, `--name`, `Cup`, `--clock`, `turn:10`, `--reason`, `r`]],
        [`entries opening past the horizon`, [`tournament-schedule`, `add`, `--weekday`, `sun`, `--time`, `18:00`, `--name`, `Cup`, `--clock`, `turn:10`, `--ahead`, `15`, `--reason`, `r`]],
        [`a removal without an id`, [`tournament-schedule`, `remove`, `--reason`, `r`]],
        [`a removal by an id that is no number`, [`tournament-schedule`, `remove`, `third`, `--reason`, `r`]],
        [`a stray argument after the rule id`, [`tournament-schedule`, `remove`, `3`, `4`, `--reason`, `r`]],
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
                clientKeys: 12,
                keylessRequests: 5,
                tournaments: [{ id: `t_abcdefghijk2`, name: `Autumn round robin`, status: `scheduled`, startsAt: 0, entrants: 4 }],
                tournamentRules: [sundayRule],
                recentActions: [{ actor: `operator`, action: `pause`, target: null, reason: `incident`, at: 0 }],
            },
        });
        expect(screen).toBe(
            [
                `uptime        42 s`,
                `paused        yes`,
                `live streams  3`,
                `active games  1`,
                `client keys   12`,
                `keyless       5`,
                `tournaments:`,
                `  t_abcdefghijk2  scheduled  1970-01-01T00:00:00.000Z  4 entered  Autumn round robin`,
                `weekly rules:`,
                `  2  sun 18:00  next 2026-10-04T18:00:00.000Z  match:3+2  opening 5  max 12  ahead 7  Sunday cup {date}`,
                `recent admin actions:`,
                `  1970-01-01T00:00:00.000Z  operator  pause  -  incident`,
            ].join(`\n`),
        );
        expect(formatAdminResponse({ kind: `error`, code: `not_found`, error: `no such user` })).toBe(`not_found: no such user`);
    });

    it('renders the weekly rules with their next starts, or says there are none', () => {
        expect(formatAdminResponse({ kind: `tournament-rules`, rules: [sundayRule, { ...sundayRule, id: 3, weekday: `mon`, time: `06:05`, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, namePattern: `Monday` }] })).toBe(
            [
                `weekly rules:`,
                `  2  sun 18:00  next 2026-10-04T18:00:00.000Z  match:3+2  opening 5  max 12  ahead 7  Sunday cup {date}`,
                `  3  mon 06:05  next 2026-10-04T18:00:00.000Z  turn:10  opening 5  max 12  ahead 7  Monday`,
            ].join(`\n`),
        );
        expect(formatAdminResponse({ kind: `tournament-rules`, rules: [] })).toBe([`weekly rules:`, `  none`].join(`\n`));
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
        directory = mkdtempSync(join(tmpdir(), `hexo-arena-cli-`));
        const path = join(directory, `admin.sock`);
        world = await createTestApp({ logger: false });
        server = await listenAdminSocket(path, world.admin, { error: () => undefined });
        expect(await sendAdminRequest(path, { op: `pause`, reason: `incident` })).toEqual({ kind: `done`, summary: `paused` });
        expect(await sendAdminRequest(path, { op: `status` })).toMatchObject({ status: { paused: true } });
    });

    it('rejects when the server drops the connection unanswered', async () => {
        directory = mkdtempSync(join(tmpdir(), `hexo-arena-cli-`));
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
