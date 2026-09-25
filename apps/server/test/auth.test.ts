import { discordCallbackPath, discordLoginPath, healthzPath } from '@hexarena/contract';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { users } from '../src/db/schema';
import { createTestApp, fakeDiscord } from './helpers';

describe('GET /healthz', () => {
    it('answers 200 with no body', async () => {
        const { app } = await createTestApp({ discord: null });
        const response = await app.inject({ method: 'GET', url: healthzPath });
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(``);
        await app.close();
    });
});

describe('GET /api/auth/discord/login', () => {
    it('redirects to discord with a fresh state and nonce', async () => {
        const { app, sqlite } = await createTestApp();
        const response = await app.inject({ method: 'GET', url: discordLoginPath });
        expect(response.statusCode).toBe(302);
        const location = new URL(response.headers.location ?? ``);
        expect(location.origin).toBe(`https://discord.example`);
        expect(location.searchParams.get(`state`)).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/);
        const query = createQuery(sqlite);
        expect(query.select().from(users).all()).toHaveLength(0);
        await app.close();
    });

    it('answers 503 when discord credentials are absent', async () => {
        const { app } = await createTestApp({ discord: null });
        const response = await app.inject({ method: 'GET', url: discordLoginPath });
        expect(response.statusCode).toBe(503);
        expect(response.json()).toMatchObject({ code: `oauth_unconfigured` });
        await app.close();
    });
});

async function loginOnce(app: FastifyInstance): Promise<string> {
    const response = await app.inject({ method: 'GET', url: discordLoginPath });
    const location = new URL(response.headers.location ?? ``);
    return location.searchParams.get(`state`) ?? ``;
}

describe('GET /api/auth/discord/callback', () => {
    it('creates the user, sets a lax httpOnly cookie, and redirects home', async () => {
        const { app, sqlite } = await createTestApp();
        const state = await loginOnce(app);
        const response = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(state)}`,
        });
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/`);
        const cookie = response.headers[`set-cookie`] ?? ``;
        expect(cookie).toContain(`HttpOnly`);
        expect(cookie).toContain(`SameSite=Lax`);
        expect(cookie).toContain(`Path=/`);
        expect(cookie).not.toContain(`Secure`);
        const rows = createQuery(sqlite).select().from(users).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.name).toBe(`tester`);
        await app.close();
    });

    it('marks the cookie Secure when the public origin is https', async () => {
        const { app } = await createTestApp({ secureCookies: true });
        const state = await loginOnce(app);
        const response = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(state)}`,
        });
        expect(response.headers[`set-cookie`]).toContain(`Secure`);
        await app.close();
    });

    it('rejects an unknown state', async () => {
        const { app } = await createTestApp();
        const response = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=never-issued`,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: `bad_state` });
        await app.close();
    });

    it('rejects a replayed state', async () => {
        const { app } = await createTestApp();
        const state = await loginOnce(app);
        const url = `${discordCallbackPath}?code=abc&state=${encodeURIComponent(state)}`;
        await app.inject({ method: 'GET', url });
        const replay = await app.inject({ method: 'GET', url });
        expect(replay.statusCode).toBe(400);
        expect(replay.json()).toMatchObject({ code: `bad_state` });
        await app.close();
    });

    it('answers 502 when discord rejects the exchange', async () => {
        const { app } = await createTestApp({
            discord: {
                authorizeUrl: (state: string) => `https://discord.example/authorize?state=${state}`,
                exchange: () => Promise.reject(new Error(`upstream down`)),
            },
        });
        const state = await loginOnce(app);
        const response = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(state)}`,
        });
        expect(response.statusCode).toBe(502);
        expect(response.json()).toMatchObject({ code: `discord_error` });
        await app.close();
    });

    it('reuses the existing user and keeps its name when discord renames it', async () => {
        const fake = fakeDiscord({ id: `77`, username: `tester` });
        const { app, sqlite } = await createTestApp({ discord: fake.oauth });
        const first = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(await loginOnce(app))}`,
        });
        expect(first.statusCode).toBe(302);
        fake.identity.username = `renamed`;
        const second = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=def&state=${encodeURIComponent(await loginOnce(app))}`,
        });
        expect(second.statusCode).toBe(302);
        const rows = createQuery(sqlite).select().from(users).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.name).toBe(`tester`);
        await app.close();
    });

    it.each([
        [`some.user`, `someuser`],
        [`1bob`, `bob`],
        [`bob-`, `bob`],
        [`a`, `user`],
        [`admin`, `admin-1`],
        [`\u00c4l\u00e4`, `user`],
        [`x`.repeat(35), `x`.repeat(30)],
    ])('derives the name %j as %s', async (username, expected) => {
        const fake = fakeDiscord({ id: `id-${username}`, username });
        const { app, sqlite } = await createTestApp({ discord: fake.oauth });
        const response = await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(await loginOnce(app))}`,
        });
        expect(response.statusCode).toBe(302);
        const rows = createQuery(sqlite).select().from(users).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.name).toBe(expected);
        await app.close();
    });

    it('suffixes deterministically when two discords want the same name', async () => {
        const first = fakeDiscord({ id: `1`, username: `tester` });
        const { app, sqlite } = await createTestApp({ discord: first.oauth });
        await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=abc&state=${encodeURIComponent(await loginOnce(app))}`,
        });
        first.identity.id = `2`;
        await app.inject({
            method: 'GET',
            url: `${discordCallbackPath}?code=def&state=${encodeURIComponent(await loginOnce(app))}`,
        });
        const names = createQuery(sqlite)
            .select({ name: users.name })
            .from(users)
            .all()
            .map((row) => row.name);
        expect(names).toEqual([`tester`, `tester-1`]);
        await app.close();
    });
});
