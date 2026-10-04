import {
    accountExportLimit,
    archiveReadGlobalLimit,
    gameExportGlobalLimit,
    gameExportLimit,
    archiveReadLimit,
    botManagementLimit,
    clientRequestLimit,
    discordExchangeLimit,
    engineDialLimit,
    guestMintLimit,
    guestMintPrefixLimit,
    guestPath,
    principalRequestLimit,
    publicRequestLimit,
    reportGlobalLimit,
    reportLimit,
    reportPrefixLimit,
    requestBodyLimitBytes,
    sessionCookieName,
    signInStartLimit,
    signInStartPrefixLimit,
    streamOpenLimit,
    positionCheckLimit,
    positionCheckPrefixLimit,
    positionRequestLimit,
} from '@hexo-arena/contract';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultLimits, RequestLimits } from '../src/request-limits';
import { createTestApp, loginAs, mintBot, type TestApp } from './helpers';

const proxy = `172.29.64.10`;
let world: TestApp | null = null;

afterEach(async () => {
    await world?.app.close();
    world = null;
});

async function start(options: Parameters<typeof createTestApp>[0] = {}): Promise<{ app: TestApp[`app`]; tick: (ms: number) => void }> {
    let now = 1_000_000;
    world = await createTestApp({ logger: false, trustedProxy: proxy, now: () => now, ...options });
    return {
        app: world.app,
        tick: (ms) => {
            now += ms;
        },
    };
}

// A request as it reaches the app through the proxy, from a visitor at `address`.
const via = (address: string) => ({ remoteAddress: proxy, headers: { 'x-forwarded-for': address } });

describe('request limits', () => {
    it('refuse a client past its burst with 429 rate_limited and the wait, and serve it again once a token returns', async () => {
        const { app, tick } = await start();
        for (let request = 0; request < clientRequestLimit.burst; request += 1) {
            expect((await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.7`) })).statusCode).toBe(200);
        }
        const refused = await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.7`) });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(`1`);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect((await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.8`) })).statusCode).toBe(200);
        tick(clientRequestLimit.refillMs);
        expect((await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.7`) })).statusCode).toBe(200);
    });

    it('count every caller without a credential together, whatever their address, and leave credentialed routes to their own limits', async () => {
        const { app } = await start();
        for (let request = 0; request < publicRequestLimit.burst; request += 1) {
            expect((await app.inject({ method: `GET`, url: `/api/bots` })).statusCode).toBe(200);
        }
        const refused = await app.inject({ method: `GET`, url: `/api/games` });
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect((await app.inject({ method: `GET`, url: `/api/bot/account` })).statusCode).toBe(401);
    });

    it('answer a page past its limit with a plain line of text and the wait', async () => {
        const dir = mkdtempSync(join(tmpdir(), `limits-`));
        const indexPath = join(dir, `index.html`);
        writeFileSync(indexPath, `<!doctype html><title>x</title><meta name="description" content="x" /><meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:image" content="/icon-512.png" />`);
        const { app } = await start({ webIndexPath: indexPath });
        for (let request = 0; request < clientRequestLimit.burst; request += 1) await app.inject({ method: `GET`, url: `/bots`, ...via(`203.0.113.20`) });
        const refused = await app.inject({ method: `GET`, url: `/bots`, ...via(`203.0.113.20`) });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`content-type`]).toMatch(/^text\/plain/u);
        expect(refused.headers[`retry-after`]).toBe(`1`);
    });

    it('refuse a limited caller with 429 while paused, and a fresh one with 503', async () => {
        const { app } = await start();
        const guestOf = async (address: string) => {
            const minted = await app.inject({ method: `POST`, url: guestPath, ...via(address) });
            return minted.cookies.find((cookie) => cookie.name === sessionCookieName)?.value ?? ``;
        };
        const spent = await guestOf(`203.0.113.30`);
        const fresh = await guestOf(`203.0.113.31`);
        world?.admin({ op: `pause`, reason: `a test` });
        for (let request = 1; request < clientRequestLimit.burst; request += 1) await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.30`) });
        const create = (cookie: string, address: string) =>
            app.inject({ method: `POST`, url: `/api/games`, ...via(address), cookies: { [sessionCookieName]: cookie }, payload: { bot: `somebot`, timeControl: { mode: `unlimited` } } });
        expect((await create(spent, `203.0.113.30`)).statusCode).toBe(429);
        expect((await create(fresh, `203.0.113.31`)).statusCode).toBe(503);
    });

    it('write neither the visitor address nor its key to any log line', async () => {
        const lines: string[] = [];
        const stream = new Writable({
            write(chunk: Buffer, _encoding, callback) {
                lines.push(chunk.toString());
                callback();
            },
        });
        const { app } = await start({ logger: { level: `info`, stream } });
        for (let request = 0; request <= clientRequestLimit.burst; request += 1) await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.40`) });
        expect(lines.length).toBeGreaterThan(clientRequestLimit.burst);
        expect(lines.join(``)).not.toContain(`203.0.113.40`);
        expect(lines.join(``)).not.toMatch(/x-forwarded-for/iu);
    });

    it('hold one bot to its own requests at once and a second, whatever address it calls from', async () => {
        const { app, tick } = await start();
        const token = await mintBot(app, await loginAs(app, `ownerone`), `limitedbot`);
        const account = (address: string) => app.inject({ method: `GET`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, remoteAddress: address });
        for (let request = 0; request < principalRequestLimit.burst; request += 1) {
            expect((await account(`203.0.113.${String(request)}`)).statusCode).toBe(200);
        }
        const refused = await account(`198.51.100.1`);
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(`1`);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        const other = await mintBot(app, await loginAs(app, `ownertwo`), `otherbot`);
        expect((await app.inject({ method: `GET`, url: `/api/bot/account`, headers: { authorization: `Bearer ${other}` } })).statusCode).toBe(200);
        tick(principalRequestLimit.refillMs);
        expect((await account(`198.51.100.1`)).statusCode).toBe(200);
    });

    it('hold a guest to its own requests before its request is read', async () => {
        const { app } = await start();
        const minted = await app.inject({ method: `POST`, url: guestPath });
        const cookie = minted.cookies.find((entry) => entry.name === sessionCookieName)?.value ?? ``;
        const create = () => app.inject({ method: `POST`, url: `/api/games`, cookies: { [sessionCookieName]: cookie }, payload: { bot: `?` } });
        for (let request = 0; request < principalRequestLimit.burst; request += 1) expect((await create()).statusCode).toBe(400);
        const refused = await create();
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
    });

    it('hold an account to 10 bot changes at once, then 1 a minute', async () => {
        const { app, tick } = await start();
        const cookie = await loginAs(app, `busyowner`);
        const create = () => app.inject({ method: `POST`, url: `/api/bots`, cookies: { [sessionCookieName]: cookie }, payload: { name: `?` } });
        for (let request = 0; request < botManagementLimit.burst; request += 1) expect((await create()).statusCode).toBe(400);
        const refused = await create();
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(`60`);
        tick(botManagementLimit.refillMs);
        expect((await create()).statusCode).toBe(400);
    });

    it('take its numbers from the contract unless told otherwise', () => {
        expect(defaultLimits).toEqual({
            client: clientRequestLimit,
            public: publicRequestLimit,
            principal: principalRequestLimit,
            botManagement: botManagementLimit,
            streamOpen: streamOpenLimit,
            engineDial: engineDialLimit,
            guestMint: guestMintLimit,
            signInStart: signInStartLimit,
            guestMintPrefix: guestMintPrefixLimit,
            signInStartPrefix: signInStartPrefixLimit,
            discordExchange: discordExchangeLimit,
            archiveRead: archiveReadLimit,
            archiveReadGlobal: archiveReadGlobalLimit,
            gameExport: gameExportLimit,
            gameExportGlobal: gameExportGlobalLimit,
            report: reportLimit,
            reportPrefix: reportPrefixLimit,
            reportGlobal: reportGlobalLimit,
            accountExport: accountExportLimit,
            positionRequest: positionRequestLimit,
            positionCheck: positionCheckLimit,
            positionCheckPrefix: positionCheckPrefixLimit,
        });
    });

    it('hold the clients it counts to 10,000, dropping the oldest', async () => {
        const { app } = await start();
        for (let client = 0; client <= 10_000; client += 1) {
            const address = `203.${String(Math.floor(client / 65_536) + 1)}.${String(Math.floor(client / 256) % 256)}.${String(client % 256)}`;
            await app.inject({ method: `GET`, url: `/api/me`, ...via(address) });
        }
        expect(world?.limits.clientCount).toBe(10_000);
        // Ten thousand requests take a few seconds, more on a loaded machine.
    }, 30_000);

    it('forget every client key when the UTC day turns and the keys change', async () => {
        const { app, tick } = await start();
        tick(86_400_000 - 1_000_000 - 50);
        for (let client = 1; client <= 5; client += 1) await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.${String(client)}`) });
        expect(world?.limits.clientCount).toBe(5);
        tick(100);
        await app.inject({ method: `GET`, url: `/api/me`, ...via(`203.0.113.1`) });
        expect(world?.limits.clientCount).toBe(1);
    });

    it('hold pages to the ceiling of callers without a credential when no address is known', async () => {
        const dir = mkdtempSync(join(tmpdir(), `limits-`));
        const indexPath = join(dir, `index.html`);
        writeFileSync(indexPath, `<!doctype html><title>x</title><meta name="description" content="x" /><meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:image" content="/icon-512.png" />`);
        const { app } = await start({ webIndexPath: indexPath });
        for (let request = 0; request < publicRequestLimit.burst; request += 1) await app.inject({ method: `GET`, url: `/bots` });
        const refused = await app.inject({ method: `GET`, url: `/bots` });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`content-type`]).toMatch(/^text\/plain/u);
    });

    it('limit every route by the class it names, pages and upgrades included', async () => {
        const dir = mkdtempSync(join(tmpdir(), `limits-`));
        const indexPath = join(dir, `index.html`);
        writeFileSync(indexPath, `<!doctype html>`);
        await start({ webIndexPath: indexPath });
        const classes = Object.fromEntries([...(world?.limits.classes ?? [])].filter(([route]) => !route.startsWith(`HEAD `)));
        expect(classes).toEqual({
            'GET /healthz': `public`,
            'GET /api/tournaments': `public`,
            'GET /api/players/:name': `public`,
            'GET /api/players/:name/rating': `public`,
            'GET /api/tournaments/:id': `public`,
            'GET /api/tournaments/:id/export': `public`,
            'PUT /api/tournaments/:id/entry': `principal`,
            'DELETE /api/tournaments/:id/entry': `principal`,
            'POST /api/duels': `principal`,
            'GET /api/duels': `public`,
            'GET /api/duels/bots': `public`,
            'GET /api/duels/:id': `public`,
            'GET /api/duels/:id/export': `public`,
            'POST /api/duels/:id/stop': `principal`,
            'GET /api/leaderboard': `public`,
            'GET /api/me': `public`,
            'DELETE /api/me': `principal`,
            'PATCH /api/me': `principal`,
            'GET /api/me/export': `principal`,
            'POST /api/auth/logout': `public`,
            'POST /api/auth/guest': `public`,
            'POST /api/reports': `public`,
            'GET /api/auth/discord/login': `public`,
            'GET /api/auth/discord/callback': `public`,
            'GET /api/signup': `public`,
            'POST /api/signup': `public`,
            'DELETE /api/signup': `public`,
            'POST /api/dev/login': `public`,
            'GET /api/dev/accounts': `public`,
            'GET /api/bots': `public`,
            'POST /api/bots': `botManagement`,
            'DELETE /api/bots/:name': `botManagement`,
            'POST /api/bots/:name/token': `botManagement`,
            'GET /api/bots/:name/settings': `principal`,
            'PATCH /api/bots/:name/settings': `principal`,
            'GET /api/bot/stream': `stream`,
            'GET /api/bot/account': `principal`,
            'PATCH /api/bot/account': `principal`,
            'POST /api/bot/challenge/:name': `principal`,
            'POST /api/bot/challenge/:challengeId/accept': `principal`,
            'POST /api/bot/challenge/:challengeId/decline': `principal`,
            'POST /api/bot/challenge/:challengeId/cancel': `principal`,
            'POST /api/games': `principal`,
            'GET /api/games': `public`,
            'GET /api/games/finished': `public`,
            'GET /api/games/:gameId': `public`,
            'GET /api/games/:gameId/events': `public`,
            'POST /api/games/:gameId/move': `principal`,
            'POST /api/games/:gameId/resign': `principal`,
            'GET /api/bot/game/:gameId/socket': `engine`,
            'POST /api/bot/game/:gameId/resign': `principal`,
            'POST /api/analysis/positions': `principal`,
            'POST /api/analysis/check': `public`,
            'POST /api/games/:gameId/analyses': `principal`,
            'GET /api/games/:gameId/analyses': `public`,
            'GET /api/bot/analysis/socket': `engine`,
            'GET /': `shell`,
            'GET /ladder': `shell`,
            'GET /play': `shell`,
            'GET /play/duels': `shell`,
            'GET /play/duels/:id': `shell`,
            'GET /play/tournament': `shell`,
            'GET /duels': `shell`,
            'GET /duels/:id': `shell`,
            'GET /analysis': `shell`,
            'GET /bots': `shell`,
            'GET /games': `shell`,
            'GET /games/live': `shell`,
            'GET /games/duels': `shell`,
            'GET /games/tournaments': `shell`,
            'GET /tournaments': `shell`,
            'GET /connect': `shell`,
            'GET /profile': `shell`,
            'GET /credits': `shell`,
            'GET /report': `shell`,
            'GET /welcome': `shell`,
            'GET /legal/imprint': `shell`,
            'GET /legal/privacy': `shell`,
            'GET /legal/terms': `shell`,
            'GET /bots/:name': `shell`,
            'GET /game/:gameId': `shell`,
            'GET /tournaments/:id': `shell`,
            'GET /players/:name': `shell`,
        });
    });

    it('refuse to register a route that names no limit', () => {
        const app = Fastify();
        new RequestLimits({ table: defaultLimits, now: () => 0, trustedProxy: null }).register(app);
        expect(() => app.get(`/unlimited`, () => `no`)).toThrow(/limit/u);
    });
});

describe('request bodies', () => {
    // A JSON object of exactly `bytes` bytes that names no bot.
    const bodyOf = (bytes: number) => {
        const frame = `{"pad":""}`;
        return `{"pad":"${`a`.repeat(bytes - frame.length)}"}`;
    };

    it(`read a body of ${String(requestBodyLimitBytes)} bytes and refuse one byte more with 413 payload_too_large`, async () => {
        const { app } = await start();
        const minted = await app.inject({ method: `POST`, url: guestPath, ...via(`203.0.113.7`) });
        const cookie = minted.cookies.find((entry) => entry.name === sessionCookieName)?.value ?? ``;
        const post = (payload: string) =>
            app.inject({
                method: `POST`,
                url: `/api/games`,
                ...via(`203.0.113.7`),
                headers: { ...via(`203.0.113.7`).headers, 'content-type': `application/json` },
                cookies: { [sessionCookieName]: cookie },
                payload,
            });
        expect((await post(bodyOf(requestBodyLimitBytes))).statusCode).toBe(400);
        const refused = await post(bodyOf(requestBodyLimitBytes + 1));
        expect(refused.statusCode).toBe(413);
        expect(refused.json()).toEqual({ error: expect.any(String) as unknown, code: `payload_too_large` });
    });
});
