import { devLoginPath } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/env';
import { createQuery } from '../src/db';
import { users } from '../src/db/schema';
import { createTestApp, fakeDiscord } from './helpers';

describe('DEV_LOGIN env flag', () => {
    it.each([
        [{ DEV_LOGIN: `1` }, true],
        [{ DEV_LOGIN: `0` }, false],
        [{}, false],
    ])('%j parses to %j', (source, enabled) => {
        expect(parseEnv(source).DEV_LOGIN).toBe(enabled);
    });

    it.each([`1`, `0`])('set to %j in production refuses to parse', (value) => {
        expect(() => parseEnv({ NODE_ENV: `production`, DEV_LOGIN: value })).toThrow(/DEV_LOGIN/);
    });

    it('unset in production parses with the route off', () => {
        expect(parseEnv({ NODE_ENV: `production`, LEGAL_DETAILS_PATH: `/etc/legal.json` }).DEV_LOGIN).toBe(false);
    });
});

describe('POST /api/dev/login', () => {
    it('creates a synthetic identity and sets the session cookie', async () => {
        const { app, sqlite } = await createTestApp();
        const response = await app.inject({
            method: 'POST',
            url: devLoginPath,
            payload: { name: `DevHuman` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ name: `DevHuman` });
        const cookie = response.headers[`set-cookie`] ?? ``;
        expect(cookie).toContain(`HttpOnly`);
        expect(cookie).toContain(`SameSite=Lax`);
        const rows = createQuery(sqlite).select().from(users).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]?.discordId).toBe(`dev:devhuman`);
        await app.close();
    });

    it('resumes the same identity on a repeat login', async () => {
        const { app, sqlite } = await createTestApp();
        for (const payload of [{ name: `ada` }, { name: `ada` }]) {
            const response = await app.inject({ method: 'POST', url: devLoginPath, payload });
            expect(response.statusCode).toBe(200);
        }
        const rows = createQuery(sqlite).select().from(users).all();
        expect(rows).toHaveLength(1);
        await app.close();
    });

    it.each([
        [`a`, `invalid_name`],
        [`1ab`, `invalid_name`],
        [`ab_`, `invalid_name`],
        [`Admin`, `name_reserved`],
        [`ROOT`, `name_reserved`],
    ])('rejects the name %j with %j', async (name, code) => {
        const { app } = await createTestApp();
        const response = await app.inject({ method: 'POST', url: devLoginPath, payload: { name } });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code });
        await app.close();
    });

    it('rejects a fold collision with an existing user', async () => {
        const fake = fakeDiscord({ id: `1`, username: `ada` });
        const { app } = await createTestApp({ discord: fake.oauth });
        const state = await app.inject({ method: 'GET', url: `/api/auth/discord/login` });
        const stateParam = new URL(state.headers.location ?? ``).searchParams.get(`state`) ?? ``;
        await app.inject({ method: 'GET', url: `/api/auth/discord/callback?code=x&state=${encodeURIComponent(stateParam)}` });
        const collision = await app.inject({ method: 'POST', url: devLoginPath, payload: { name: `Ada` } });
        expect(collision.statusCode).toBe(409);
        expect(collision.json()).toMatchObject({ code: `name_taken` });
        await app.close();
    });

    it('is not registered when the flag is unset', async () => {
        const { app, sqlite } = await createTestApp({ devLogin: false });
        const response = await app.inject({
            method: 'POST',
            url: devLoginPath,
            payload: { name: `DevHuman` },
        });
        expect(response.statusCode).toBe(404);
        expect(createQuery(sqlite).select().from(users).all()).toHaveLength(0);
        await app.close();
    });
});
