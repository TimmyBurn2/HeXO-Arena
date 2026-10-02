import {
    archiveReadGlobalLimit,
    archiveReadLimit,
    clientWatcherCap,
    discordCallbackPath,
    discordExchangeLimit,
    discordLoginPath,
    guestMintLimit,
    guestMintPrefixLimit,
    guestPath,
    seatWatcherCap,
    sessionCookieName,
    signInStartLimit,
    signInStateCap,
} from '@hexo-arena/contract';
import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { createTestApp, fakeDiscord, FakeStreamSocket, loginAs, mintBot, roomyLimits, startDiscordSignIn, type StartedSignIn, type TestApp } from './helpers';

let world: TestApp | null = null;

afterEach(async () => {
    world?.app.server.closeAllConnections();
    await world?.app.close();
    world = null;
    vi.useRealTimers();
});

// A clock the limits and the database share, moved by the test.
function clocked(): Parameters<typeof createTestApp>[0] {
    vi.useFakeTimers({ toFake: [`Date`] });
    return { now: () => Date.now() };
}

async function start(options: Parameters<typeof createTestApp>[0] = {}): Promise<TestApp> {
    const now = 1_000_000;
    world = await createTestApp({ logger: false, trustedProxy: `127.0.0.1`, now: () => now, ...options });
    return world;
}

async function until(predicate: () => boolean): Promise<void> {
    for (let spin = 0; spin < 5_000 && !predicate(); spin += 1) {
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
}

// A request as the proxy forwards it, from a visitor at `address`.
const from = (address: string) => ({ headers: { 'x-forwarded-for': address } });

async function guestAt(app: TestApp[`app`], address: string): Promise<string> {
    const minted = await app.inject({ method: `POST`, url: guestPath, ...from(address) });
    return minted.cookies.find((cookie) => cookie.name === sessionCookieName)?.value ?? ``;
}

// A bot online and open for unlimited games, and a live game a guest at `address` plays against it.
async function liveGame(arena: TestApp, address: string): Promise<{ gameId: string; cookie: string }> {
    const token = await mintBot(arena.app, await loginAs(arena.app, `watchowner`), `watchedbot`);
    await arena.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts: { turnMs: null, match: false, unlimited: true } } });
    const bot = findBot(createQuery(arena.sqlite), `watchedbot`);
    if (bot === undefined) throw new Error(`no bot`);
    arena.presence.attach(bot.id, new FakeStreamSocket(), true);
    const cookie = await guestAt(arena.app, address);
    const created = await arena.app.inject({ method: `POST`, url: `/api/games`, ...from(address), cookies: { [sessionCookieName]: cookie }, payload: { bot: `watchedbot`, timeControl: { mode: `unlimited` } } });
    return { gameId: created.json<{ gameId: string }>().gameId, cookie };
}

// Opens a game's event stream over a real socket and reports its status, keeping it open until closed.
function watch(port: number, gameId: string, address: string, cookie?: string): Promise<{ status: number; close: () => void }> {
    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                host: `127.0.0.1`,
                port,
                path: `/api/games/${gameId}/events`,
                headers: { 'x-forwarded-for': address, ...(cookie === undefined ? {} : { cookie: `${sessionCookieName}=${cookie}` }) },
            },
            (response) => {
                resolve({ status: response.statusCode ?? 0, close: () => request.destroy() });
                response.resume();
            },
        );
        request.on(`error`, reject);
        request.end();
    });
}

describe('anonymous limits per client', () => {
    it('let one client mint three guests at once, then one every twenty minutes', async () => {
        const arena = await start(clocked());
        for (let mint = 0; mint < guestMintLimit.burst; mint += 1) expect((await arena.app.inject({ method: `POST`, url: guestPath, ...from(`203.0.113.50`) })).statusCode).toBe(201);
        const refused = await arena.app.inject({ method: `POST`, url: guestPath, ...from(`203.0.113.50`) });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(String(guestMintLimit.refillMs / 1000));
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect((await arena.app.inject({ method: `POST`, url: guestPath, ...from(`203.0.113.51`) })).statusCode).toBe(201);
        vi.advanceTimersByTime(guestMintLimit.refillMs);
        expect((await arena.app.inject({ method: `POST`, url: guestPath, ...from(`203.0.113.50`) })).statusCode).toBe(201);
    });

    it('let a client refused a guest just before midnight UTC mint one just after, under its new key', async () => {
        const arena = await start(clocked());
        vi.setSystemTime(Math.ceil(Date.now() / 86_400_000) * 86_400_000 - 1_000);
        const mint = () => arena.app.inject({ method: `POST`, url: guestPath, ...from(`203.0.113.52`) });
        for (let minted = 0; minted < guestMintLimit.burst; minted += 1) expect((await mint()).statusCode).toBe(201);
        expect((await mint()).statusCode).toBe(429);
        vi.advanceTimersByTime(2_000);
        expect((await mint()).statusCode).toBe(201);
    });

    it('send a sign-in past its client limit back with signin=busy, leaving no state behind', async () => {
        const arena = await start(clocked());
        const login = () => arena.app.inject({ method: `GET`, url: `${discordLoginPath}?next=/play`, ...from(`203.0.113.60`) });
        for (let started = 0; started < signInStartLimit.burst; started += 1) expect((await login()).headers.location).toMatch(/^https:\/\/discord/u);
        const states = () => (arena.sqlite.prepare(`select count(*) as n from auth_states`).get() as { n: number }).n;
        const before = states();
        const refused = await login();
        expect(refused.statusCode).toBe(302);
        expect(refused.headers.location).toBe(`/play?signin=busy`);
        expect(states()).toBe(before);
        vi.advanceTimersByTime(signInStartLimit.refillMs);
        expect((await login()).headers.location).toMatch(/^https:\/\/discord/u);
    });

    it('send every sign-in back busy while the outstanding states are at their cap, and not once they expire', async () => {
        const arena = await start({ limits: roomyLimits, ...clocked() });
        for (let started = 0; started < signInStateCap; started += 1) await arena.app.inject({ method: `GET`, url: discordLoginPath });
        expect((await arena.app.inject({ method: `GET`, url: discordLoginPath, ...from(`203.0.113.61`) })).headers.location).toBe(`/?signin=busy`);
        // A sign-in state lives ten minutes.
        vi.advanceTimersByTime(601_000);
        expect((await arena.app.inject({ method: `GET`, url: discordLoginPath, ...from(`203.0.113.61`) })).headers.location).toMatch(/^https:\/\/discord/u);
    });

    it('refuse one client its eleventh watch of games it has no seat in, and a seat its fifth stream, as watcher_limit', async () => {
        const arena = await start();
        const { gameId, cookie } = await liveGame(arena, `203.0.113.70`);
        await arena.app.listen({ host: `127.0.0.1`, port: 0 });
        const address = arena.app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        const held: { status: number; close: () => void }[] = [];
        for (let watcher = 0; watcher < clientWatcherCap; watcher += 1) held.push(await watch(address.port, gameId, `203.0.113.71`));
        expect(held.map((watcher) => watcher.status)).toEqual(Array.from({ length: clientWatcherCap }, () => 200));
        expect((await watch(address.port, gameId, `203.0.113.71`)).status).toBe(429);
        expect((await watch(address.port, gameId, `203.0.113.72`)).status).toBe(200);
        for (let stream = 0; stream < seatWatcherCap; stream += 1) expect((await watch(address.port, gameId, `203.0.113.70`, cookie)).status).toBe(200);
        expect((await watch(address.port, gameId, `203.0.113.70`, cookie)).status).toBe(429);
        // The seat's own streams count against the seat alone, not against its address.
        for (let watcher = 0; watcher < clientWatcherCap; watcher += 1) expect((await watch(address.port, gameId, `203.0.113.70`)).status).toBe(200);
        // A closed stream frees its place once the server sees it go.
        held[0]?.close();
        const unseated = arena.watchers.unseatedCount(gameId);
        await until(() => arena.watchers.unseatedCount(gameId) < unseated);
        expect((await watch(address.port, gameId, `203.0.113.71`)).status).toBe(200);
    });

    it('hold finished-game reads to ten at once a client and twenty across callers, a second on', async () => {
        const arena = await start(clocked());
        const { gameId, cookie } = await liveGame(arena, `203.0.113.79`);
        await arena.app.inject({ method: `POST`, url: `/api/games/${gameId}/resign`, ...from(`203.0.113.79`), cookies: { [sessionCookieName]: cookie } });
        const read = (address: string) => arena.app.inject({ method: `GET`, url: `/api/games/${gameId}`, ...from(address) });
        for (let reads = 0; reads < archiveReadLimit.burst; reads += 1) expect((await read(`203.0.113.80`)).statusCode).toBe(200);
        const refused = await read(`203.0.113.80`);
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        for (let reads = archiveReadLimit.burst; reads < archiveReadGlobalLimit.burst; reads += 1) expect((await read(`203.0.113.81`)).statusCode).toBe(200);
        expect((await read(`203.0.113.82`)).statusCode).toBe(429);
        vi.advanceTimersByTime(archiveReadLimit.refillMs);
        expect((await read(`203.0.113.80`)).statusCode).toBe(200);
    });
});

describe('anonymous limits per IPv6 /48', () => {
    it('stop guest mints spread over the /64s of one /48 at four clients\' worth, while another /48 mints', async () => {
        const arena = await start(clocked());
        const mint = (address: string) => arena.app.inject({ method: `POST`, url: guestPath, ...from(address) });
        for (let network = 0; network < 4; network += 1) {
            for (let minted = 0; minted < guestMintLimit.burst; minted += 1) expect((await mint(`2001:db8:5:${String(network)}::1`)).statusCode).toBe(201);
        }
        const refused = await mint(`2001:db8:5:4::1`);
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect(refused.headers[`retry-after`]).toBe(String(guestMintPrefixLimit.refillMs / 1000));
        expect((await mint(`2001:db8:6::1`)).statusCode).toBe(201);
        vi.advanceTimersByTime(guestMintPrefixLimit.refillMs);
        expect((await mint(`2001:db8:5:4::1`)).statusCode).toBe(201);
    });

    it('send sign-ins spread over the /64s of one /48 back busy past four clients\' worth', async () => {
        const arena = await start(clocked());
        const login = (address: string) => arena.app.inject({ method: `GET`, url: `${discordLoginPath}?next=/play`, ...from(address) });
        for (let network = 0; network < 4; network += 1) {
            for (let started = 0; started < signInStartLimit.burst; started += 1) expect((await login(`2001:db8:7:${String(network)}::1`)).headers.location).toMatch(/^https:\/\/discord/u);
        }
        expect((await login(`2001:db8:7:4::1`)).headers.location).toBe(`/play?signin=busy`);
        expect((await login(`2001:db8:8::1`)).headers.location).toMatch(/^https:\/\/discord/u);
    });
});

describe('the Discord exchange limit', () => {
    it('send callbacks past the burst back busy without asking Discord, and let one through once a token returns', async () => {
        const fake = fakeDiscord({ id: `9`, username: `flood` });
        const exchanged: string[] = [];
        const arena = await start({
            ...clocked(),
            discord: {
                ...fake.oauth,
                exchange: (code) => {
                    exchanged.push(code);
                    return fake.oauth.exchange(code);
                },
            },
        });
        const started: StartedSignIn[] = [];
        for (let sign = 0; sign < discordExchangeLimit.burst + 2; sign += 1) started.push(await startDiscordSignIn(arena.app));
        const back = async (sign: StartedSignIn | undefined) =>
            (await arena.app.inject({ method: `GET`, url: `${discordCallbackPath}?code=c&state=${encodeURIComponent(sign?.state ?? ``)}`, cookies: sign?.cookies ?? {} })).headers.location;
        for (const sign of started.slice(0, discordExchangeLimit.burst)) expect(await back(sign)).toBe(`/welcome`);
        expect(await back(started[discordExchangeLimit.burst])).toBe(`/?signin=busy`);
        expect(exchanged).toHaveLength(discordExchangeLimit.burst);
        vi.advanceTimersByTime(discordExchangeLimit.refillMs);
        expect(await back(started[discordExchangeLimit.burst + 1])).toBe(`/welcome`);
        expect(exchanged).toHaveLength(discordExchangeLimit.burst + 1);
    });
});
