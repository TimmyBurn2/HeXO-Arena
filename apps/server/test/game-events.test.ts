import {
    gameEventSchema,
    gameWatcherCap,
    guestPath,
    sessionCookieName,
    siteWatcherCap,
    watcherRetryAfterSeconds,
    type GameEvent,
    type GameSnapshot,
} from '@hexo-arena/contract';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

// A draw of 0.9 seats the human on o, and after the origin alone o moves first.
const humanCircles = () => 0.9;

interface Watch {
    readonly status: number;
    readonly headers: http.IncomingHttpHeaders;
    readonly events: GameEvent[];
    readonly ended: Promise<void>;
    next(): Promise<GameEvent>;
    drop(): void;
}

// A minimal EventSource: frames split on the blank line, comment lines are
// skipped, and every payload is parsed with the contract schema.
function watch(port: number, gameId: string, cookie = ``): Promise<Watch> {
    return new Promise((resolve, reject) => {
        const request = http.get(
            { host: `127.0.0.1`, port, path: `/api/games/${gameId}/events`, headers: cookie === `` ? {} : { cookie: `${sessionCookieName}=${cookie}` } },
            (response) => {
                const events: GameEvent[] = [];
                const waiting: ((event: GameEvent) => void)[] = [];
                let buffer = ``;
                let taken = 0;
                response.setEncoding(`utf8`);
                response.on(`data`, (chunk: string) => {
                    buffer += chunk;
                    let split = buffer.indexOf(`\n\n`);
                    while (split >= 0) {
                        const lines = buffer.slice(0, split).split(`\n`).filter((line) => !line.startsWith(`:`));
                        buffer = buffer.slice(split + 2);
                        split = buffer.indexOf(`\n\n`);
                        if (lines.length === 0) continue;
                        const field = (name: string) => lines.find((line) => line.startsWith(`${name}: `))?.slice(name.length + 2);
                        events.push(gameEventSchema.parse({ event: field(`event`), data: JSON.parse(field(`data`) ?? `null`) as unknown }));
                        waiting.shift()?.(events[taken++] as GameEvent);
                    }
                });
                resolve({
                    status: response.statusCode ?? 0,
                    headers: response.headers,
                    events,
                    ended: new Promise((done) => response.once(`end`, done)),
                    next: () => {
                        const ready = events[taken];
                        if (ready !== undefined) {
                            taken += 1;
                            return Promise.resolve(ready);
                        }
                        return new Promise((take) => waiting.push(take));
                    },
                    drop: () => {
                        request.destroy();
                    },
                });
            },
        );
        request.on(`error`, reject);
    });
}

function snapshotOf(event: GameEvent): GameSnapshot {
    if (event.event !== `snapshot`) throw new Error(`expected a snapshot, got ${event.event}`);
    return event.data;
}

async function until(check: () => boolean): Promise<void> {
    while (!check()) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('the game event stream', () => {
    let world: TestApp;
    let port: number;
    let player: string;
    let gameId: string;

    async function startGame(cookie: string): Promise<string> {
        const created = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { [sessionCookieName]: cookie },
            payload: { bot: `watchedbot`, timeControl: { mode: `unlimited` }, openingPlies: 1 },
        });
        if (created.statusCode !== 201) throw new Error(`game creation failed: ${created.body}`);
        return created.json<{ gameId: string }>().gameId;
    }

    function move(cookie: string, cells: { x: number; y: number }[]) {
        return world.app.inject({
            method: `POST`,
            url: `/api/games/${gameId}/move`,
            cookies: { [sessionCookieName]: cookie },
            payload: { cells },
        });
    }

    beforeEach(async () => {
        world = await createTestApp({ logger: false, random: humanCircles });
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `watchedbot`);
        await world.app.inject({
            method: `PATCH`,
            url: `/api/bot/account`,
            headers: { authorization: `Bearer ${token}` },
            payload: { accepts: { turnMs: null, match: false, unlimited: true } },
        });
        const bot = findBot(createQuery(world.sqlite), `watchedbot`);
        if (bot === undefined) throw new Error(`no bot`);
        world.presence.attach(bot.id, new FakeStreamSocket(), true);
        player = await loginAs(world.app, `player`);
        gameId = await startGame(player);
        port = Number(new URL(await world.app.listen({ host: `127.0.0.1`, port: 0 })).port);
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('opens with the snapshot as server-sent events', async () => {
        const watcher = await watch(port, gameId);
        expect(watcher.status).toBe(200);
        expect(watcher.headers[`content-type`]).toBe(`text/event-stream`);
        expect(watcher.headers[`content-encoding`]).toBeUndefined();
        const snapshot = snapshotOf(await watcher.next());
        expect(snapshot).toMatchObject({ gameId, status: `in-progress`, toMove: `o` });
        expect(snapshot.players.o).toMatchObject({ name: `player`, kind: `user` });
        expect(snapshot.players.x).toMatchObject({ name: `watchedbot`, kind: `bot` });
    });

    it('carries you on a seated caller\'s snapshot and not on a watcher\'s', async () => {
        expect(snapshotOf(await (await watch(port, gameId, player)).next()).you).toBe(`o`);
        const other = await loginAs(world.app, `other`);
        expect(snapshotOf(await (await watch(port, gameId, other)).next()).you).toBeUndefined();
        expect(snapshotOf(await (await watch(port, gameId)).next()).you).toBeUndefined();
    });

    it('delivers a played turn as a turn event', async () => {
        const watcher = await watch(port, gameId);
        await watcher.next();
        const cells = [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ];
        expect((await move(player, cells)).statusCode).toBe(200);
        expect(await watcher.next()).toEqual({
            event: `turn`,
            data: { turn: 1, side: `o`, cells, toMove: `x`, clock: { mode: `unlimited` } },
        });
    });

    it('delivers the finish and then ends the stream', async () => {
        const watcher = await watch(port, gameId);
        await watcher.next();
        const resigned = await world.app.inject({
            method: `POST`,
            url: `/api/games/${gameId}/resign`,
            cookies: { [sessionCookieName]: player },
        });
        expect(resigned.statusCode).toBe(200);
        expect(await watcher.next()).toEqual({
            event: `finish`,
            data: { winner: `x`, reason: `surrender`, clock: { mode: `unlimited` } },
        });
        await watcher.ended;
        expect(world.watchers.unseatedCount()).toBe(0);
    });

    it('answers a finished game with its snapshot and closes', async () => {
        await world.app.inject({ method: `POST`, url: `/api/games/${gameId}/resign`, cookies: { [sessionCookieName]: player } });
        const watcher = await watch(port, gameId);
        await watcher.ended;
        expect(watcher.events).toHaveLength(1);
        expect(snapshotOf(watcher.events[0] as GameEvent)).toMatchObject({ status: `finished`, winner: `x` });
    });

    it('answers an unknown game with 404', async () => {
        expect((await world.app.inject({ method: `GET`, url: `/api/games/g_unknown/events` })).statusCode).toBe(404);
    });

    it('refuses the 51st watcher of one game with 429 and Retry-After, but never the seated player', async () => {
        for (let i = 0; i < gameWatcherCap; i += 1) {
            world.watchers.attach(gameId, new FakeStreamSocket(), false, { event: `finish`, data: { winner: null, reason: `aborted`, clock: { mode: `unlimited` } } });
        }
        const refused = await world.app.inject({ method: `GET`, url: `/api/games/${gameId}/events` });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(String(watcherRetryAfterSeconds));
        expect(refused.json()).toMatchObject({ code: `watcher_limit` });
        expect((await watch(port, gameId, player)).status).toBe(200);
    });

    it('refuses the 501st watcher across the site with 429', async () => {
        for (let i = 0; i < siteWatcherCap; i += 1) {
            world.watchers.attach(`elsewhere-${String(i % 10)}`, new FakeStreamSocket(), false, {
                event: `finish`,
                data: { winner: null, reason: `aborted`, clock: { mode: `unlimited` } },
            });
        }
        const refused = await world.app.inject({ method: `GET`, url: `/api/games/${gameId}/events` });
        expect(refused.statusCode).toBe(429);
        expect(refused.headers[`retry-after`]).toBe(String(watcherRetryAfterSeconds));
    });

    it('frees a dropped watcher\'s slot at once', async () => {
        for (let i = 0; i < gameWatcherCap - 1; i += 1) {
            world.watchers.attach(gameId, new FakeStreamSocket(), false, { event: `finish`, data: { winner: null, reason: `aborted`, clock: { mode: `unlimited` } } });
        }
        const last = await watch(port, gameId);
        expect(last.status).toBe(200);
        expect((await world.app.inject({ method: `GET`, url: `/api/games/${gameId}/events` })).statusCode).toBe(429);
        last.drop();
        await until(() => world.watchers.unseatedCount(gameId) < gameWatcherCap);
        expect((await watch(port, gameId)).status).toBe(200);
    });

    it('streams a guest game to anyone, the guest shown by its label', async () => {
        const minted = await world.app.inject({ method: `POST`, url: guestPath });
        const guest = minted.cookies.find((cookie) => cookie.name === sessionCookieName)?.value ?? ``;
        gameId = await startGame(guest);
        const watcher = await watch(port, gameId);
        const snapshot = snapshotOf(await watcher.next());
        expect(snapshot.players.o).toMatchObject({ rating: null, kind: `guest` });
        expect(snapshot.players.o.name).toMatch(/^Guest [a-z0-9]{4}$/);
        await move(guest, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect((await watcher.next()).event).toBe(`turn`);
    });

    it('ends every watcher on shutdown', async () => {
        const watcher = await watch(port, gameId);
        const seated = await watch(port, gameId, player);
        await world.app.close();
        await Promise.all([watcher.ended, seated.ended]);
        expect(world.watchers.unseatedCount()).toBe(0);
    });
});
