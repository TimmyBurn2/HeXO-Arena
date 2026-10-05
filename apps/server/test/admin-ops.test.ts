import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphanForfeitMs, type AdminRequest } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, fakeDiscord, FakeStreamSocket, loginAs, mintBot, startDiscordSignIn, type TestApp } from './helpers';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { foldRatings } from '../src/rating';
import { finishedGameLog, storedRatings } from '../src/rating-store';

function auditRows(world: TestApp): unknown[] {
    return world.sqlite.prepare(`select actor, action, target, reason from admin_actions order by id`).all();
}

// Declares every clock and holds an open stream, so the bot takes games
// and challenges; the returned socket records its lines.
async function goOnline(world: TestApp, token: string, name: string): Promise<FakeStreamSocket> {
    await world.app.inject({
        method: `PATCH`,
        url: `/api/bot/account`,
        headers: { authorization: `Bearer ${token}` },
        payload: { accepts: { turnMs: [5_000, 600_000], match: true, unlimited: true } },
    });
    const stream = new FakeStreamSocket();
    world.presence.attach(botId(world, name), stream, true);
    return stream;
}

// Opens a bot's stream over the network, answering its status once the headers arrive.
async function openStream(world: TestApp, token: string): Promise<{ status: number; close: () => void }> {
    const address = await world.app.listen({ host: `127.0.0.1`, port: 0 });
    return new Promise((resolve, reject) => {
        const request = http.get(`${address}/api/bot/stream?open=1`, { headers: { authorization: `Bearer ${token}` } }, (response) => {
            resolve({ status: response.statusCode ?? 0, close: () => request.destroy() });
        });
        request.on(`error`, reject);
    });
}

function lines(stream: FakeStreamSocket): { type: string }[] {
    return stream.writes.filter((line) => line.trim() !== ``).map((line) => JSON.parse(line) as { type: string });
}

function challenge(world: TestApp, token: string, target: string, requestId: string) {
    return world.app.inject({
        method: `POST`,
        url: `/api/bot/challenge/${target}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { timeControl: { mode: `unlimited` }, requestId },
    });
}

function botId(world: TestApp, name: string): string {
    const bot = findBot(createQuery(world.sqlite), name.toLowerCase());
    if (bot === undefined) throw new Error(`no bot ${name}`);
    return bot.id;
}

describe('admin status', () => {
    let world: TestApp;

    beforeEach(async () => {
        world = await createTestApp();
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('reports the paused flag, live streams, active games, and the ten latest actions newest first', () => {
        world.presence.attach(`some-bot`, new FakeStreamSocket(), false);
        const insert = world.sqlite.prepare(
            `insert into admin_actions (actor, action, target, reason, at) values ('operator', 'pause', null, ?, ?)`,
        );
        for (let n = 1; n <= 12; n += 1) insert.run(`reason ${String(n)}`, n);
        const answer = world.admin({ op: `status` });
        if (answer.kind !== `status`) throw new Error(`no status`);
        expect(answer.status.paused).toBe(false);
        expect(answer.status.liveStreams).toBe(1);
        expect(answer.status.activeGames).toBe(0);
        expect(answer.status.recentActions.map((action) => action.reason)).toEqual(
            Array.from({ length: 10 }, (_, index) => `reason ${String(12 - index)}`),
        );
        world.presence.close(`some-bot`);
    });

    it('counts the client keys held and the requests that carried no public address, so a deploy can check the forwarded address arrives', async () => {
        await world.app.inject({ method: `GET`, url: `/api/me` });
        await world.app.inject({ method: `GET`, url: `/api/me`, remoteAddress: `203.0.113.5` });
        await world.app.inject({ method: `GET`, url: `/api/me`, remoteAddress: `198.51.100.5` });
        const answer = world.admin({ op: `status` });
        if (answer.kind !== `status`) throw new Error(`no status`);
        expect(answer.status.clientKeys).toBe(2);
        expect(answer.status.keylessRequests).toBe(1);
    });
});

describe('backup on demand', () => {
    it('writes the night\'s snapshot at once and names it, auditing nothing, and says when no backup folder is set', async () => {
        const dir = mkdtempSync(join(tmpdir(), `hexo-arena-admin-backup-`));
        const world = await createTestApp({ backup: { dir, keep: 14 } });
        const answer = world.admin({ op: `backup` });
        const path = join(dir, `hexo-arena-${new Date().toISOString().slice(0, 10)}.sqlite`);
        expect(answer).toEqual({ kind: `done`, summary: `backup written to ${path}` });
        expect(existsSync(path)).toBe(true);
        expect(auditRows(world)).toEqual([]);
        const labelled = world.admin({ op: `backup`, label: `pre-update` });
        expect(labelled).toMatchObject({ kind: `done`, summary: expect.stringMatching(/^backup written to .*\/hexo-arena-pre-update-\d{8}T\d{6}\.sqlite$/u) as unknown });
        expect(existsSync(path)).toBe(true);
        await world.app.close();
        rmSync(dir, { recursive: true, force: true });
        const bare = await createTestApp();
        expect(bare.admin({ op: `backup` })).toMatchObject({ kind: `error`, code: `bad_request` });
        await bare.app.close();
    });
});

describe('pause and resume', () => {
    let world: TestApp;

    beforeEach(async () => {
        world = await createTestApp({ random: () => 0.1 });
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('audits a pause once and answers unchanged to a repeat', () => {
        expect(world.admin({ op: `pause`, reason: `incident` })).toEqual({ kind: `done`, summary: `paused` });
        expect(world.admin({ op: `pause`, reason: `again` })).toMatchObject({ kind: `error`, code: `unchanged` });
        expect(world.admin({ op: `status` })).toMatchObject({ status: { paused: true } });
        expect(world.admin({ op: `resume`, reason: `fixed` })).toEqual({ kind: `done`, summary: `resumed` });
        expect(world.admin({ op: `resume`, reason: `again` })).toMatchObject({ kind: `error`, code: `unchanged` });
        expect(auditRows(world)).toEqual([
            { actor: `operator`, action: `pause`, target: null, reason: `incident` },
            { actor: `operator`, action: `resume`, target: null, reason: `fixed` },
        ]);
    });

    it('keeps the site paused across a restart on the same database', async () => {
        world.admin({ op: `pause`, reason: `incident` });
        await world.app.close();
        world = await createTestApp({ sqlite: world.sqlite });
        expect((await world.app.inject({ method: `GET`, url: `/healthz` })).statusCode).toBe(503);
        expect(world.admin({ op: `status` })).toMatchObject({ status: { paused: true } });
    });

    it('refuses stream opens, game and challenge creation, and acceptance with 503 and Retry-After', async () => {
        const owner = await loginAs(world.app, `owner`);
        const token = await mintBot(world.app, owner, `pausebot`);
        const player = await loginAs(world.app, `player`);
        world.admin({ op: `pause`, reason: `incident` });
        const bearer = { authorization: `Bearer ${token}` };
        const refused = [
            await world.app.inject({ method: `GET`, url: `/api/bot/stream`, headers: bearer }),
            await world.app.inject({
                method: `POST`,
                url: `/api/games`,
                cookies: { hexo_arena_session: player },
                payload: { bot: `pausebot`, timeControl: { mode: `unlimited` } },
            }),
            await world.app.inject({
                method: `POST`,
                url: `/api/bot/challenge/otherbot`,
                headers: bearer,
                payload: { timeControl: { mode: `unlimited` }, requestId: `r1` },
            }),
            await world.app.inject({ method: `POST`, url: `/api/bot/challenge/c_1/accept`, headers: bearer }),
            await world.app.inject({ method: `GET`, url: `/healthz` }),
        ];
        for (const response of refused.slice(0, 4)) {
            expect(response.statusCode).toBe(503);
            expect(response.headers[`retry-after`]).toBe(`60`);
            expect(response.json()).toEqual({ error: `the site is paused`, code: `paused` });
        }
        expect(refused[4]?.statusCode).toBe(503);
    });

    it('leaves open streams and live games running to their end', async () => {
        const owner = await loginAs(world.app, `owner`);
        const token = await mintBot(world.app, owner, `livebot`);
        await world.app.inject({
            method: `PATCH`,
            url: `/api/bot/account`,
            headers: { authorization: `Bearer ${token}` },
            payload: { accepts: { turnMs: null, match: false, unlimited: true } },
        });
        const stream = new FakeStreamSocket();
        world.presence.attach(botId(world, `livebot`), stream, true);
        const player = await loginAs(world.app, `player`);
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: player },
            payload: { bot: `livebot`, timeControl: { mode: `unlimited` } },
        });
        expect(created.statusCode).toBe(201);
        const { gameId } = created.json<{ gameId: string }>();
        world.admin({ op: `pause`, reason: `incident` });
        expect(stream.ended).toBe(false);
        expect(world.presence.isOnline(botId(world, `livebot`))).toBe(true);
        const resigned = await world.app.inject({
            method: `POST`,
            url: `/api/games/${gameId}/resign`,
            cookies: { hexo_arena_session: player },
        });
        expect(resigned.statusCode).toBe(200);
        expect(resigned.json()).toMatchObject({ status: `finished`, reason: `surrender` });
        world.presence.close(botId(world, `livebot`));
    });

    it('admits the stream of a bot holding a live game, so a cut stream comes back to its game', async () => {
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `livebot`);
        const stream = await goOnline(world, token, `livebot`);
        const player = await loginAs(world.app, `player`);
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: player },
            payload: { bot: `livebot`, timeControl: { mode: `unlimited` } },
        });
        const { gameId } = created.json<{ gameId: string }>();
        world.admin({ op: `pause`, reason: `incident` });
        stream.emitClose();
        expect(world.presence.isOnline(botId(world, `livebot`))).toBe(false);
        const reopened = await openStream(world, token);
        expect(reopened.status).toBe(200);
        expect(world.presence.isOnline(botId(world, `livebot`))).toBe(true);
        expect((await world.app.inject({ method: `GET`, url: `/api/games/${gameId}` })).json()).toMatchObject({ status: `in-progress` });
        reopened.close();
    });

    it('opens the doors again on resume', async () => {
        world.admin({ op: `pause`, reason: `incident` });
        world.admin({ op: `resume`, reason: `fixed` });
        expect((await world.app.inject({ method: `GET`, url: `/healthz` })).statusCode).toBe(200);
    });
});

describe('delist and relist', () => {
    let world: TestApp;
    let alphaToken: string;
    let betaToken: string;

    beforeEach(async () => {
        world = await createTestApp();
        alphaToken = await mintBot(world.app, await loginAs(world.app, `ann`), `alpha`);
        betaToken = await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
    });

    afterEach(async () => {
        await world.app.close();
    });

    async function directoryNames(): Promise<string[]> {
        const response = await world.app.inject({ method: `GET`, url: `/api/bots` });
        return response.json<{ name: string }[]>().map((bot) => bot.name);
    }

    it('hides a delisted bot from the directory and the leaderboard until relisted', async () => {
        // The board lists a settled player with a rated game, so beta wins one and then settles.
        const query = createQuery(world.sqlite);
        const game = insertBotGame(query, { challengerBotId: botId(world, `alpha`), destBotId: botId(world, `beta`), challengerSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
        recordFinish(query, game, { winner: `o`, reason: `six-in-a-row` });
        world.sqlite.prepare(`update ratings set deviation = 60 where bot_id = ?`).run(botId(world, `beta`));
        const board = async () =>
            (await world.app.inject({ method: `GET`, url: `/api/leaderboard` })).json<{ name: string }[]>().map((row) => row.name);
        expect(await board()).toEqual([`beta`]);
        expect(world.admin({ op: `delist-bot`, name: `Beta`, reason: `rude bio` })).toEqual({
            kind: `done`,
            summary: `delisted Beta`,
        });
        expect(await directoryNames()).toEqual([`alpha`]);
        expect(await board()).toEqual([]);
        expect(world.admin({ op: `relist-bot`, name: `beta`, reason: `bio fixed` })).toMatchObject({ kind: `done` });
        expect(await directoryNames()).toEqual([`alpha`, `beta`]);
        expect(await board()).toEqual([`beta`]);
        expect(auditRows(world)).toEqual([
            { actor: `operator`, action: `delist-bot`, target: `Beta`, reason: `rude bio` },
            { actor: `operator`, action: `relist-bot`, target: `beta`, reason: `bio fixed` },
        ]);
    });

    it('answers unchanged and not_found without writing an audit row', () => {
        world.admin({ op: `delist-bot`, name: `beta`, reason: `first` });
        expect(world.admin({ op: `delist-bot`, name: `beta`, reason: `again` })).toMatchObject({ code: `unchanged` });
        expect(world.admin({ op: `relist-bot`, name: `alpha`, reason: `never delisted` })).toMatchObject({ code: `unchanged` });
        expect(world.admin({ op: `delist-bot`, name: `nobody`, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(auditRows(world)).toHaveLength(1);
    });

    it('refuses challenges to and from a delisted bot, and human games against it, with 403 delisted', async () => {
        world.admin({ op: `delist-bot`, name: `beta`, reason: `abuse` });
        const inbound = await challenge(world, alphaToken, `beta`, `r1`);
        const outbound = await challenge(world, betaToken, `alpha`, `r2`);
        const human = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: await loginAs(world.app, `cat`) },
            payload: { bot: `beta`, timeControl: { mode: `unlimited` } },
        });
        for (const response of [inbound, outbound, human]) {
            expect(response.statusCode).toBe(403);
            expect(response.json()).toMatchObject({ code: `delisted` });
        }
    });

    it('withdraws pending challenges both ways and leaves the stream open', async () => {
        const alpha = await goOnline(world, alphaToken, `alpha`);
        const beta = await goOnline(world, betaToken, `beta`);
        expect((await challenge(world, alphaToken, `beta`, `r1`)).statusCode).toBe(201);
        expect((await challenge(world, betaToken, `alpha`, `r2`)).statusCode).toBe(201);
        alpha.writes.length = 0;
        beta.writes.length = 0;
        world.admin({ op: `delist-bot`, name: `beta`, reason: `abuse` });
        expect(lines(alpha).map((line) => line.type)).toEqual([`challengeCanceled`, `challengeCanceled`]);
        expect(lines(beta).map((line) => line.type)).toEqual([`challengeCanceled`, `challengeCanceled`]);
        expect(beta.ended).toBe(false);
        expect(world.presence.isOnline(botId(world, `beta`))).toBe(true);
        const statuses = world.sqlite.prepare(`select status from challenges`).all();
        expect(statuses).toEqual([{ status: `canceled` }, { status: `canceled` }]);
        world.presence.close(botId(world, `alpha`));
        world.presence.close(botId(world, `beta`));
    });
});

describe('ban and unban', () => {
    let world: TestApp;
    let annSession: string;
    let alphaToken: string;
    let betaToken: string;

    beforeEach(async () => {
        world = await createTestApp({
            random: () => 0.9,
            discord: fakeDiscord({ id: `dev:ann`, username: `ann` }).oauth,
        });
        annSession = await loginAs(world.app, `ann`);
        alphaToken = await mintBot(world.app, annSession, `alpha`);
        betaToken = await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
    });

    afterEach(async () => {
        vi.useRealTimers();
        await world.app.close();
    });

    function account(token: string) {
        return world.app.inject({ method: `GET`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` } });
    }

    async function directoryNames(): Promise<string[]> {
        const response = await world.app.inject({ method: `GET`, url: `/api/bots` });
        return response.json<{ name: string }[]>().map((bot) => bot.name);
    }

    it('ends sessions, closes and hides the bots, and answers their token with 403 banned', async () => {
        const alpha = await goOnline(world, alphaToken, `alpha`);
        await goOnline(world, betaToken, `beta`);
        expect((await challenge(world, betaToken, `alpha`, `r1`)).statusCode).toBe(201);
        expect(world.admin({ op: `ban-user`, name: `ann`, reason: `cheating` })).toEqual({
            kind: `done`,
            summary: `banned ann`,
        });
        expect(alpha.ended).toBe(true);
        expect(world.presence.isOnline(botId(world, `alpha`))).toBe(false);
        expect(world.sqlite.prepare(`select status from challenges`).all()).toEqual([{ status: `canceled` }]);
        const session = await world.app.inject({
            method: `POST`,
            url: `/api/bots`,
            cookies: { hexo_arena_session: annSession },
            payload: { name: `gamma` },
        });
        expect(session.statusCode).toBe(401);
        const refused = await account(alphaToken);
        expect(refused.statusCode).toBe(403);
        expect(refused.json()).toEqual({ error: `the bot's owner is banned`, code: `banned` });
        expect(await directoryNames()).toEqual([`beta`]);
        expect(auditRows(world)).toEqual([{ actor: `operator`, action: `ban-user`, target: `ann`, reason: `cheating` }]);
        world.presence.close(botId(world, `beta`));
    });

    it('refuses the banned identity a new session: 403 banned at dev login, home as banned from discord', async () => {
        world.admin({ op: `ban-user`, name: `ann`, reason: `cheating` });
        const devLogin = await world.app.inject({ method: `POST`, url: `/api/dev/login`, payload: { name: `ann` } });
        expect(devLogin.statusCode).toBe(403);
        expect(devLogin.json()).toEqual({ error: `the account is banned`, code: `banned` });
        const { state, cookies } = await startDiscordSignIn(world.app);
        const callback = await world.app.inject({
            method: `GET`,
            url: `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(state)}`,
            cookies,
        });
        expect(callback.statusCode).toBe(302);
        expect(callback.headers.location).toBe(`/?signin=banned`);
        expect(callback.cookies.filter((entry) => entry.value !== ``)).toEqual([]);
    });

    it('lets a banned bot forfeit its live game on the clock, rated', async () => {
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`] });
        const alpha = await goOnline(world, alphaToken, `alpha`);
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: await loginAs(world.app, `cat`) },
            payload: { bot: `alpha`, timeControl: { mode: `unlimited` } },
        });
        const { gameId, you } = created.json<{ gameId: string; you: string }>();
        world.admin({ op: `ban-user`, name: `ann`, reason: `cheating` });
        expect(alpha.ended).toBe(true);
        vi.advanceTimersByTime(orphanForfeitMs);
        const game = world.sqlite.prepare(`select winner, finish_reason as reason from games where id = ?`).get(gameId);
        expect(game).toEqual({ winner: you, reason: `disconnect` });
        const rated = world.sqlite.prepare(`select count(*) as n from ratings`).get();
        expect(rated).toEqual({ n: 2 });
    });

    it('lifts the ban, relists the bots, and kills the tokens that outlived it', async () => {
        world.admin({ op: `ban-user`, name: `ann`, reason: `cheating` });
        expect(world.admin({ op: `unban-user`, name: `ann`, reason: `appeal` })).toMatchObject({ kind: `done` });
        expect(await directoryNames()).toEqual([`alpha`, `beta`]);
        expect((await account(alphaToken)).statusCode).toBe(401);
        expect((await account(betaToken)).statusCode).toBe(200);
        expect((await world.app.inject({ method: `POST`, url: `/api/dev/login`, payload: { name: `ann` } })).statusCode).toBe(200);
    });

    it('answers unchanged and not_found without writing an audit row', () => {
        expect(world.admin({ op: `unban-user`, name: `ann`, reason: `not banned` })).toMatchObject({ code: `unchanged` });
        world.admin({ op: `ban-user`, name: `ann`, reason: `cheating` });
        expect(world.admin({ op: `ban-user`, name: `ann`, reason: `again` })).toMatchObject({ code: `unchanged` });
        expect(world.admin({ op: `ban-user`, name: `alpha`, reason: `a bot, not a user` })).toMatchObject({
            code: `not_found`,
        });
        expect(auditRows(world)).toHaveLength(1);
    });
});

describe('revoke-bot', () => {
    it('kills the token and closes the stream, and the owner mints a fresh token', async () => {
        const world = await createTestApp();
        const owner = await loginAs(world.app, `ann`);
        const token = await mintBot(world.app, owner, `alpha`);
        const stream = await goOnline(world, token, `alpha`);
        expect(world.admin({ op: `revoke-bot`, name: `alpha`, reason: `token leaked` })).toMatchObject({ kind: `done` });
        expect(stream.ended).toBe(true);
        const read = (bearer: string) =>
            world.app.inject({ method: `GET`, url: `/api/bot/account`, headers: { authorization: `Bearer ${bearer}` } });
        expect((await read(token)).statusCode).toBe(401);
        const rotated = await world.app.inject({
            method: `POST`,
            url: `/api/bots/alpha/token`,
            cookies: { hexo_arena_session: owner },
        });
        expect((await read(rotated.json<{ token: string }>().token)).statusCode).toBe(200);
        expect(world.admin({ op: `revoke-bot`, name: `nobody`, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(auditRows(world)).toEqual([
            { actor: `operator`, action: `revoke-bot`, target: `alpha`, reason: `token leaked` },
        ]);
        await world.app.close();
    });
});

describe('abort-game', () => {
    let world: TestApp;
    let stream: FakeStreamSocket;

    beforeEach(async () => {
        world = await createTestApp();
        const token = await mintBot(world.app, await loginAs(world.app, `ann`), `alpha`);
        stream = await goOnline(world, token, `alpha`);
    });

    afterEach(async () => {
        world.presence.close(botId(world, `alpha`));
        await world.app.close();
    });

    async function startGame(human: string): Promise<string> {
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: await loginAs(world.app, human) },
            payload: { bot: `alpha`, timeControl: { mode: `unlimited` } },
        });
        expect(created.statusCode).toBe(201);
        return created.json<{ gameId: string }>().gameId;
    }

    it('aborts one game unrated and tells the bot with gameFinish', async () => {
        const gameId = await startGame(`bob`);
        stream.writes.length = 0;
        expect(world.admin({ op: `abort-game`, gameId, reason: `server bug` })).toEqual({
            kind: `done`,
            summary: `aborted ${gameId}`,
        });
        expect(lines(stream)).toEqual([{ type: `gameFinish`, gameId, winner: null, reason: `aborted` }]);
        expect(world.sqlite.prepare(`select finish_reason as reason from games`).get()).toEqual({ reason: `aborted` });
        expect(world.sqlite.prepare(`select count(*) as n from ratings`).get()).toEqual({ n: 0 });
        expect(world.admin({ op: `abort-game`, gameId, reason: `again` })).toMatchObject({ code: `unchanged` });
        expect(auditRows(world)).toEqual([{ actor: `operator`, action: `abort-game`, target: gameId, reason: `server bug` }]);
    });

    it('aborts every live game of a bot at once', async () => {
        await startGame(`bob`);
        await startGame(`cat`);
        expect(world.admin({ op: `abort-game`, bot: `alpha`, reason: `rogue bot` })).toEqual({
            kind: `done`,
            summary: `aborted 2 live games of alpha`,
        });
        expect(world.admin({ op: `status` })).toMatchObject({ status: { activeGames: 0 } });
        expect(world.admin({ op: `abort-game`, bot: `alpha`, reason: `again` })).toMatchObject({ code: `unchanged` });
    });

    it('answers not_found for an unknown game or bot', () => {
        const gameId = `g_00000000-0000-0000-0000-000000000000`;
        expect(world.admin({ op: `abort-game`, gameId, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(world.admin({ op: `abort-game`, bot: `nobody`, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(auditRows(world)).toEqual([]);
    });
});

describe('recompute-ratings', () => {
    let world: TestApp;
    let ids: Record<string, string>;

    beforeEach(async () => {
        world = await createTestApp();
        ids = {};
        for (const [owner, bot] of [[`ann`, `alpha`], [`bob`, `beta`], [`cat`, `gamma`]] as const) {
            await mintBot(world.app, await loginAs(world.app, owner), bot);
            ids[bot] = botId(world, bot);
        }
    });

    afterEach(async () => {
        await world.app.close();
    });

    function play(challenger: string, dest: string, winner: `x` | `o`): string {
        const query = createQuery(world.sqlite);
        const gameId = insertBotGame(query, {
            challengerBotId: ids[challenger] ?? ``,
            destBotId: ids[dest] ?? ``,
            challengerSide: `x`,
            timeControl: { mode: `unlimited` },
            opening: [{ x: 0, y: 0, player: 0 }],
        });
        recordFinish(query, gameId, { winner, reason: `six-in-a-row` });
        return gameId;
    }

    it('rebuilds a tampered table from the log', () => {
        play(`alpha`, `beta`, `x`);
        play(`beta`, `gamma`, `o`);
        const live = storedRatings(createQuery(world.sqlite));
        world.sqlite.prepare(`update ratings set rating = 2000`).run();
        expect(world.admin({ op: `recompute-ratings`, exclude: [], reason: `dispute` })).toEqual({
            kind: `done`,
            summary: `re-folded 2 rated games; voided 0 more`,
        });
        expect(storedRatings(createQuery(world.sqlite))).toEqual(live);
        expect(auditRows(world)).toEqual([{ actor: `operator`, action: `recompute-ratings`, target: null, reason: `dispute` }]);
    });

    it('voids excluded games for good, so a later plain recompute keeps them out', () => {
        const farmed = play(`alpha`, `beta`, `x`);
        play(`beta`, `gamma`, `o`);
        expect(world.admin({ op: `recompute-ratings`, exclude: [farmed], reason: `farming` })).toMatchObject({
            summary: `re-folded 1 rated games; voided 1 more`,
        });
        const query = createQuery(world.sqlite);
        expect(storedRatings(query).has(`bot:${ids.alpha ?? ``}`)).toBe(false);
        world.admin({ op: `recompute-ratings`, exclude: [], reason: `routine` });
        expect(storedRatings(query)).toEqual(foldRatings(finishedGameLog(query)));
        expect(storedRatings(query).has(`bot:${ids.alpha ?? ``}`)).toBe(false);
    });

    it('excludes every game of a named player', () => {
        play(`alpha`, `beta`, `x`);
        play(`gamma`, `alpha`, `o`);
        play(`beta`, `gamma`, `x`);
        expect(world.admin({ op: `recompute-ratings`, exclude: [`Alpha`], reason: `sybil` })).toMatchObject({
            summary: `re-folded 1 rated games; voided 2 more`,
        });
    });

    it('lets a game voided while live finish without touching a rating', () => {
        const query = createQuery(world.sqlite);
        const gameId = insertBotGame(query, {
            challengerBotId: ids.alpha ?? ``,
            destBotId: ids.beta ?? ``,
            challengerSide: `x`,
            timeControl: { mode: `unlimited` },
            opening: [{ x: 0, y: 0, player: 0 }],
        });
        world.admin({ op: `recompute-ratings`, exclude: [gameId], reason: `known bug` });
        recordFinish(query, gameId, { winner: `x`, reason: `six-in-a-row` });
        expect(storedRatings(query).size).toBe(0);
    });

    it('voids nothing and writes no row when any match is unknown', () => {
        const gameId = play(`alpha`, `beta`, `x`);
        expect(world.admin({ op: `recompute-ratings`, exclude: [gameId, `nobody`], reason: `typo` })).toMatchObject({
            code: `not_found`,
        });
        expect(world.sqlite.prepare(`select count(*) as n from games where voided_at is not null`).get()).toEqual({ n: 0 });
        expect(auditRows(world)).toEqual([]);
    });
});

describe('delete-user', () => {
    let world: TestApp;

    beforeEach(async () => {
        world = await createTestApp();
    });

    afterEach(async () => {
        await world.app.close();
    });

    function userId(name: string): string {
        const row = world.sqlite.prepare(`select id from users where name = ?`).get(name) as { id: string } | undefined;
        if (row === undefined) throw new Error(`no user ${name}`);
        return row.id;
    }

    function count(sql: string): unknown {
        return world.sqlite.prepare(sql).get();
    }

    it('keeps rated history under placeholders, frees the user name, and audits the deletion under the placeholder', async () => {
        const ann = await loginAs(world.app, `ann`);
        await mintBot(world.app, ann, `alpha`);
        await mintBot(world.app, ann, `spare`);
        await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
        const query = createQuery(world.sqlite);
        const opening = [{ x: 0, y: 0, player: 0 as const }];
        const human = insertGame(query, {
            userId: userId(`ann`),
            botId: botId(world, `beta`),
            userSide: `x`,
            timeControl: { mode: `unlimited` },
            opening,
        });
        recordFinish(query, human, { winner: `x`, reason: `six-in-a-row` });
        const botGame = insertBotGame(query, {
            challengerBotId: botId(world, `alpha`),
            destBotId: botId(world, `beta`),
            challengerSide: `x`,
            timeControl: { mode: `unlimited` },
            opening,
        });
        recordFinish(query, botGame, { winner: `o`, reason: `six-in-a-row` });
        world.sqlite.prepare(`update ratings set deviation = 60`).run();
        const ratingsBefore = storedRatings(query);

        expect(world.admin({ op: `delete-user`, name: `ann`, reason: `asked to be forgotten` })).toEqual({
            kind: `done`,
            summary: `forgot ann as deleted-1: user kept; 1 bots kept anonymized, 1 deleted; 0 live games aborted`,
        });
        expect(count(`select name, discord_id as discordId from users where name like 'deleted-%'`)).toEqual({
            name: `deleted-1`,
            discordId: `deleted:deleted-1`,
        });
        expect(count(`select count(*) as n from games`)).toEqual({ n: 2 });
        expect(count(`select count(*) as n from sessions where user_id not in (select id from users where name = 'bob')`)).toEqual({ n: 0 });
        expect(storedRatings(query)).toEqual(ratingsBefore);
        const board = await world.app.inject({ method: `GET`, url: `/api/leaderboard` });
        expect(board.json<{ name: string }[]>().map((row) => row.name)).toEqual([`beta`]);
        const roster = await world.app.inject({ method: `GET`, url: `/api/bots` });
        expect(roster.json<{ name: string }[]>().map((row) => row.name)).toEqual([`beta`]);
        const bob = await loginAs(world.app, `bob`);
        const reuseBot = await world.app.inject({ method: `POST`, url: `/api/bots`, payload: { name: `alpha` }, cookies: { hexo_arena_session: bob } });
        expect(reuseBot.statusCode).toBe(409);
        const freed = await world.app.inject({ method: `POST`, url: `/api/bots`, payload: { name: `spare` }, cookies: { hexo_arena_session: bob } });
        expect(freed.statusCode).toBe(201);
        const fresh = await world.app.inject({ method: `POST`, url: `/api/dev/login`, payload: { name: `ann` } });
        expect(fresh.statusCode).toBe(200);
        expect(count(`select count(*) as n from users where name = 'ann' and deleted_at is null`)).toEqual({ n: 1 });
        expect(auditRows(world)).toEqual([
            { actor: `operator`, action: `delete-user`, target: `deleted-1`, reason: `asked to be forgotten` },
        ]);
        expect(world.admin({ op: `recompute-ratings`, exclude: [`deleted-1`], reason: `sybil` })).toMatchObject({
            summary: `re-folded 1 rated games; voided 1 more`,
        });
    });

    it('deletes a user without games outright, the audit keeping only the placeholder it claimed', async () => {
        await mintBot(world.app, await loginAs(world.app, `ann`), `alpha`);
        expect(world.admin({ op: `delete-user`, name: `ann`, reason: `spam account` })).toMatchObject({
            summary: `forgot ann as deleted-1: user deleted; 0 bots kept anonymized, 1 deleted; 0 live games aborted`,
        });
        expect(count(`select count(*) as n from users`)).toEqual({ n: 0 });
        expect(world.sqlite.prepare(`select name_key as nameKey from name_reservations`).all()).toEqual([{ nameKey: `deleted-1` }]);
        expect(auditRows(world)).toEqual([{ actor: `operator`, action: `delete-user`, target: `deleted-1`, reason: `spam account` }]);
    });

    it('rewrites every earlier audit row naming the user or a bot of theirs to a placeholder, and no other', async () => {
        const ann = await loginAs(world.app, `ann`);
        await mintBot(world.app, ann, `alpha`);
        await mintBot(world.app, ann, `spare`);
        await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
        const query = createQuery(world.sqlite);
        const game = insertBotGame(query, {
            challengerBotId: botId(world, `alpha`),
            destBotId: botId(world, `beta`),
            challengerSide: `x`,
            timeControl: { mode: `unlimited` },
            opening: [{ x: 0, y: 0, player: 0 }],
        });
        recordFinish(query, game, { winner: `x`, reason: `six-in-a-row` });
        const requests: AdminRequest[] = [
            { op: `ban-user`, name: `Ann`, reason: `spam` },
            { op: `unban-user`, name: `ann`, reason: `appeal` },
            { op: `delist-bot`, name: `alpha`, reason: `name` },
            { op: `relist-bot`, name: `alpha`, reason: `renamed` },
            { op: `revoke-bot`, name: `spare`, reason: `leaked` },
            { op: `recompute-ratings`, exclude: [`beta`, `ann`, game], reason: `check` },
            { op: `tournament-create`, name: `ann alpha cup`, startsAt: new Date(Date.now() + 7_200_000).toISOString(), timeControl: { mode: `turn`, turnTimeMs: 10_000 }, openingPlies: 5, maxEntrants: 12, reason: `weekly` },
        ];
        for (const request of requests) expect(world.admin(request)).toMatchObject({ kind: `done` });
        world.admin({ op: `delete-user`, name: `ann`, reason: `asked to be forgotten` });
        expect(auditRows(world)).toEqual([
            { actor: `operator`, action: `ban-user`, target: `deleted-1`, reason: `spam` },
            { actor: `operator`, action: `unban-user`, target: `deleted-1`, reason: `appeal` },
            { actor: `operator`, action: `delist-bot`, target: `deleted-2`, reason: `name` },
            { actor: `operator`, action: `relist-bot`, target: `deleted-2`, reason: `renamed` },
            { actor: `operator`, action: `revoke-bot`, target: `deleted-1`, reason: `leaked` },
            { actor: `operator`, action: `recompute-ratings`, target: `beta deleted-1 ${game}`, reason: `check` },
            { actor: `operator`, action: `tournament-create`, target: `ann alpha cup`, reason: `weekly` },
            { actor: `operator`, action: `delete-user`, target: `deleted-1`, reason: `asked to be forgotten` },
        ]);
    });

    it('aborts the live games of the user and their bots first', async () => {
        const ann = await loginAs(world.app, `ann`);
        const token = await mintBot(world.app, ann, `alpha`);
        const stream = await goOnline(world, token, `alpha`);
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: await loginAs(world.app, `bob`) },
            payload: { bot: `alpha`, timeControl: { mode: `unlimited` } },
        });
        expect(created.statusCode).toBe(201);
        expect(world.admin({ op: `delete-user`, name: `ann`, reason: `abuse` })).toMatchObject({
            summary: `forgot ann as deleted-1: user deleted; 0 bots kept anonymized, 1 deleted; 1 live games aborted`,
        });
        expect(stream.ended).toBe(true);
        expect(world.admin({ op: `status` })).toMatchObject({ status: { activeGames: 0 } });
    });

    it('answers not_found for an unknown user or a bot name', async () => {
        const ann = await loginAs(world.app, `ann`);
        await mintBot(world.app, ann, `alpha`);
        expect(world.admin({ op: `delete-user`, name: `nobody`, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(world.admin({ op: `delete-user`, name: `alpha`, reason: `typo` })).toMatchObject({ code: `not_found` });
        expect(auditRows(world)).toEqual([]);
    });
});
