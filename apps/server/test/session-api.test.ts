import {
    devLoginPath,
    guestIdleSeconds,
    guestMeSchema,
    guestPath,
    guestSessionCap,
    logoutPath,
    mePath,
    meSchema,
} from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQuery } from '../src/db';
import { sessions } from '../src/db/schema';
import { createTestApp, loginAs, roomyLimits, type TestApp } from './helpers';

async function mintGuest(arena: TestApp): Promise<{ session: string; name: string }> {
    const response = await arena.app.inject({ method: `POST`, url: guestPath });
    expect(response.statusCode).toBe(201);
    const cookie = response.cookies.find((entry) => entry.name === `hexo_arena_session`);
    if (cookie === undefined) throw new Error(`guest minting set no cookie`);
    return { session: cookie.value, name: guestMeSchema.parse(response.json()).name };
}

async function readMe(arena: TestApp, session?: string): Promise<unknown> {
    const response = await arena.app.inject({
        method: `GET`,
        url: mePath,
        ...(session !== undefined && { cookies: { hexo_arena_session: session } }),
    });
    expect(response.statusCode).toBe(200);
    return meSchema.parse(response.json());
}

describe('GET /api/me', () => {
    it('answers null without a session and for an unknown token', async () => {
        const arena = await createTestApp();
        expect(await readMe(arena)).toBeNull();
        expect(await readMe(arena, `not-a-session-token`)).toBeNull();
        await arena.app.close();
    });

    it('names the signed-in user with the seeded, provisional rating before any game', async () => {
        const arena = await createTestApp();
        const session = await loginAs(arena.app, `alice`);
        expect(await readMe(arena, session)).toEqual({ kind: `user`, name: `alice`, rating: 1000, provisional: true, discord: null, liveGames: [] });
        await arena.app.close();
    });
});

describe('POST /api/auth/logout', () => {
    it('ends the session, clears the cookie, and leaves the user unknown', async () => {
        const arena = await createTestApp();
        const session = await loginAs(arena.app, `alice`);
        const response = await arena.app.inject({
            method: `POST`,
            url: logoutPath,
            cookies: { hexo_arena_session: session },
        });
        expect(response.statusCode).toBe(204);
        const cleared = response.cookies.find((cookie) => cookie.name === `hexo_arena_session`);
        expect(cleared?.value).toBe(``);
        expect(createQuery(arena.sqlite).select().from(sessions).all()).toHaveLength(0);
        expect(await readMe(arena, session)).toBeNull();
        await arena.app.close();
    });

    it('answers 204 without a session', async () => {
        const arena = await createTestApp();
        const response = await arena.app.inject({ method: `POST`, url: logoutPath });
        expect(response.statusCode).toBe(204);
        await arena.app.close();
    });
});

describe('POST /api/auth/guest', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('mints a browser-lifetime session that me names as a guest, with no account behind it', async () => {
        const arena = await createTestApp();
        const response = await arena.app.inject({ method: `POST`, url: guestPath });
        expect(response.statusCode).toBe(201);
        const cookie = response.cookies.find((entry) => entry.name === `hexo_arena_session`);
        expect(cookie?.httpOnly).toBe(true);
        expect(cookie?.maxAge).toBeUndefined();
        const { name } = guestMeSchema.parse(response.json());
        expect(await readMe(arena, cookie?.value)).toEqual({ kind: `guest`, name, liveGames: [] });
        const rows = arena.sqlite.prepare(`select (select count(*) from users) + (select count(*) from sessions) as n`).get();
        expect(rows).toEqual({ n: 0 });
        await arena.app.close();
    });

    it('answers the same guest again instead of minting a second one', async () => {
        const arena = await createTestApp();
        const guest = await mintGuest(arena);
        const again = await arena.app.inject({
            method: `POST`,
            url: guestPath,
            cookies: { hexo_arena_session: guest.session },
        });
        expect(again.statusCode).toBe(200);
        expect(again.json()).toEqual({ kind: `guest`, name: guest.name, liveGames: [] });
        await arena.app.close();
    });

    it('refuses to replace a signed-in user', async () => {
        const arena = await createTestApp();
        const session = await loginAs(arena.app, `alice`);
        const response = await arena.app.inject({
            method: `POST`,
            url: guestPath,
            cookies: { hexo_arena_session: session },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: `signed_in` });
        await arena.app.close();
    });

    it('answers 429 with retry-after once the global cap is full', async () => {
        const arena = await createTestApp({ limits: roomyLimits });
        for (let minted = 0; minted < guestSessionCap; minted += 1) await mintGuest(arena);
        const response = await arena.app.inject({ method: `POST`, url: guestPath });
        expect(response.statusCode).toBe(429);
        expect(response.headers[`retry-after`]).toBe(`60`);
        expect(response.json()).toMatchObject({ code: `guest_limit` });
        await arena.app.close();
    });

    it('forgets a guest idle for a day', async () => {
        vi.useFakeTimers({ toFake: [`Date`] });
        const arena = await createTestApp();
        const guest = await mintGuest(arena);
        vi.setSystemTime(Date.now() + guestIdleSeconds * 1000);
        expect(await readMe(arena, guest.session)).toBeNull();
        await arena.app.close();
    });

    it('ends the guest session when a user signs in over it', async () => {
        const arena = await createTestApp();
        const guest = await mintGuest(arena);
        const login = await arena.app.inject({
            method: `POST`,
            url: devLoginPath,
            payload: { name: `alice` },
            cookies: { hexo_arena_session: guest.session },
        });
        expect(login.statusCode).toBe(200);
        expect(await readMe(arena, guest.session)).toBeNull();
        await arena.app.close();
    });

    it('ends the guest session on sign-out', async () => {
        const arena = await createTestApp();
        const guest = await mintGuest(arena);
        const response = await arena.app.inject({
            method: `POST`,
            url: logoutPath,
            cookies: { hexo_arena_session: guest.session },
        });
        expect(response.statusCode).toBe(204);
        expect(await readMe(arena, guest.session)).toBeNull();
        await arena.app.close();
    });
});
