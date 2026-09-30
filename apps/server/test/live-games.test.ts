import { guestPath, liveGameEntrySchema, liveGameListCap, sessionCookieName, type LiveGameEntry } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

// Four bots at four games each cover the cap and one more.
const botNames = [`listbot-a`, `listbot-b`, `listbot-c`, `listbot-d`];

describe('GET /api/games', () => {
    let world: TestApp;

    async function guest(): Promise<string> {
        const minted = await world.app.inject({ method: `POST`, url: guestPath });
        return minted.cookies.find((cookie) => cookie.name === sessionCookieName)?.value ?? ``;
    }

    async function start(cookie: string, bot: string): Promise<string> {
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { [sessionCookieName]: cookie },
            payload: { bot, timeControl: { mode: `unlimited` } },
        });
        if (created.statusCode !== 201) throw new Error(`game creation failed: ${created.body}`);
        return created.json<{ gameId: string }>().gameId;
    }

    async function list(): Promise<LiveGameEntry[]> {
        const response = await world.app.inject({ method: `GET`, url: `/api/games` });
        expect(response.statusCode).toBe(200);
        return liveGameEntrySchema.array().parse(response.json());
    }

    beforeEach(async () => {
        world = await createTestApp({ logger: false });
        const owners = [await loginAs(world.app, `ownerone`), await loginAs(world.app, `ownertwo`)];
        for (const [index, name] of botNames.entries()) {
            const token = await mintBot(world.app, owners[index === 3 ? 1 : 0] ?? ``, name);
            await world.app.inject({
                method: `PATCH`,
                url: `/api/bot/account`,
                headers: { authorization: `Bearer ${token}` },
                payload: { accepts: { turnMs: null, match: false, unlimited: true } },
            });
            const bot = findBot(createQuery(world.sqlite), name);
            if (bot === undefined) throw new Error(`no bot`);
            world.presence.attach(bot.id, new FakeStreamSocket(), true);
        }
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('answers without a session, newest first, with seats, stones, clock, and turn', async () => {
        const first = await start(await loginAs(world.app, `firstplayer`), `listbot-a`);
        const player = await guest();
        const second = await start(player, `listbot-b`);
        const entries = await list();
        expect(entries.map((entry) => entry.gameId)).toEqual([second, first]);
        const [newest] = entries;
        expect(newest).toMatchObject({ timeControl: { mode: `unlimited` }, clock: { mode: `unlimited` } });
        expect([newest?.players.x.name, newest?.players.o.name]).toContain(`listbot-b`);
        const snapshot = await world.app.inject({ method: `GET`, url: `/api/games/${second}`, cookies: { [sessionCookieName]: player } });
        const board = snapshot.json<{ board: { cells: unknown[] } }>().board.cells;
        expect(newest?.cells).toEqual(board);
        expect(newest?.cells).toHaveLength(5);
        expect(newest?.cells[0]).toEqual({ x: 0, y: 0, side: `x` });
    });

    it('states a clock that runs as the snapshot states it', async () => {
        const token = await mintBot(world.app, await loginAs(world.app, `clockowner`), `clockbot`);
        await world.app.inject({
            method: `PATCH`,
            url: `/api/bot/account`,
            headers: { authorization: `Bearer ${token}` },
            payload: { accepts: { turnMs: null, match: true, unlimited: false } },
        });
        const bot = findBot(createQuery(world.sqlite), `clockbot`);
        if (bot === undefined) throw new Error(`no bot`);
        world.presence.attach(bot.id, new FakeStreamSocket(), true);
        vi.useFakeTimers({ toFake: [`Date`] });
        try {
            const player = await guest();
            const created = await world.app.inject({
                method: `POST`,
                url: `/api/games`,
                cookies: { [sessionCookieName]: player },
                payload: { bot: `clockbot`, timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 } },
            });
            expect(created.statusCode).toBe(201);
            const gameId = created.json<{ gameId: string }>().gameId;
            vi.advanceTimersByTime(4_000);
            const snapshot = await world.app.inject({ method: `GET`, url: `/api/games/${gameId}`, cookies: { [sessionCookieName]: player } });
            const [entry] = await list();
            expect(entry?.clock).toEqual(snapshot.json<{ clock: unknown }>().clock);
            expect(entry?.clock).toMatchObject({ mode: `match` });
        } finally {
            vi.useRealTimers();
        }
    });

    it('serves every caller the same body within a second, then the list as it stands', async () => {
        vi.useFakeTimers({ toFake: [`Date`] });
        try {
            const first = await start(await guest(), `listbot-a`);
            const before = await world.app.inject({ method: `GET`, url: `/api/games` });
            const second = await start(await guest(), `listbot-b`);
            vi.advanceTimersByTime(999);
            const within = await world.app.inject({ method: `GET`, url: `/api/games`, cookies: { [sessionCookieName]: await guest() } });
            expect(within.body).toBe(before.body);
            expect(within.headers[`content-type`]).toMatch(/^application\/json/u);
            expect(liveGameEntrySchema.array().parse(within.json()).map((entry) => entry.gameId)).toEqual([first]);
            vi.advanceTimersByTime(1);
            expect((await list()).map((entry) => entry.gameId)).toEqual([second, first]);
            // A clock stepped back starts a new window rather than holding the old body.
            const third = await start(await guest(), `listbot-c`);
            vi.setSystemTime(Date.now() - 60_000);
            expect((await list()).map((entry) => entry.gameId)).toEqual([third, second, first]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lists a guest game as unrated with the guest seat unrated too, and a user game as rated', async () => {
        await start(await loginAs(world.app, `ratedplayer`), `listbot-a`);
        await start(await guest(), `listbot-b`);
        const [guestGame, userGame] = await list();
        expect(guestGame?.rated).toBe(false);
        const guestSeat = [guestGame?.players.x, guestGame?.players.o].find((player) => player?.kind === `guest`);
        expect(guestSeat).toMatchObject({ rating: null, provisional: false });
        expect(guestSeat?.name).toMatch(/^Guest [a-z0-9]{4}$/);
        expect(userGame?.rated).toBe(true);
    });

    it(`caps the list at ${String(liveGameListCap)}, dropping the oldest`, async () => {
        const created: string[] = [];
        for (let index = 0; index <= liveGameListCap; index += 1) {
            created.push(await start(await guest(), botNames[index % botNames.length] ?? ``));
        }
        const entries = await list();
        expect(entries).toHaveLength(liveGameListCap);
        expect(entries.map((entry) => entry.gameId)).toEqual(created.slice(1).reverse());
    });

    it('drops a game once it finishes', async () => {
        const player = await guest();
        const ended = await start(player, `listbot-a`);
        const running = await start(await guest(), `listbot-b`);
        await world.app.inject({ method: `POST`, url: `/api/games/${ended}/resign`, cookies: { [sessionCookieName]: player } });
        expect((await list()).map((entry) => entry.gameId)).toEqual([running]);
    });
});
