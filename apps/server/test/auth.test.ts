import { discordCallbackPath, discordLoginHref, discordLoginPath, guestPath, healthzPath, mePath, meSchema } from '@hexo-arena/contract';
import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { pendingSignups, sessions, users } from '../src/db/schema';
import { createDiscordOAuth } from '../src/discord';
import { createTestApp, fakeDiscord, signUpWithDiscord } from './helpers';

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
    it('redirects to discord with a fresh state and nonce, creating nothing', async () => {
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

    it('sends the visitor back where they started with the reason when discord credentials are absent', async () => {
        const { app } = await createTestApp({ discord: null });
        const home = await app.inject({ method: 'GET', url: discordLoginPath });
        expect(home.statusCode).toBe(302);
        expect(home.headers.location).toBe(`/?signin=unconfigured`);
        const back = await app.inject({ method: 'GET', url: discordLoginHref(`/bots?online=1`) });
        expect(back.headers.location).toBe(`/bots?online=1&signin=unconfigured`);
        await app.close();
    });

    it.each([`//evil.example/`, `/\\evil.example`, `https://evil.example/`, `/api/me`, `/welcome`])(
        'reads the return path %j as the root',
        async (next) => {
            const { app } = await createTestApp({ discord: null });
            const response = await app.inject({ method: 'GET', url: `${discordLoginPath}?next=${encodeURIComponent(next)}` });
            expect(response.headers.location).toBe(`/?signin=unconfigured`);
            await app.close();
        },
    );

    it('asks Discord for the identify scope alone, and to skip its screen for an app already allowed', () => {
        const oauth = createDiscordOAuth({ clientId: `c1`, clientSecret: `s1`, redirectUri: `https://arena.example/api/auth/discord/callback` });
        const url = new URL(oauth.authorizeUrl(`st.nc`));
        expect(url.origin + url.pathname).toBe(`https://discord.com/oauth2/authorize`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            client_id: `c1`,
            response_type: `code`,
            scope: `identify`,
            redirect_uri: `https://arena.example/api/auth/discord/callback`,
            state: `st.nc`,
            prompt: `none`,
        });
    });
});

async function loginOnce(app: FastifyInstance, next?: string): Promise<string> {
    const response = await app.inject({ method: 'GET', url: next === undefined ? discordLoginPath : discordLoginHref(next) });
    const location = new URL(response.headers.location ?? ``);
    return location.searchParams.get(`state`) ?? ``;
}

function callback(app: FastifyInstance, query: string, cookies?: Record<string, string>) {
    return app.inject({ method: 'GET', url: `${discordCallbackPath}?${query}`, ...(cookies === undefined ? {} : { cookies }) });
}

describe('GET /api/auth/discord/callback, a first sign-in', () => {
    it('creates nothing yet: it holds the sign-up behind a lax httpOnly cookie and asks for the name', async () => {
        const { app, sqlite } = await createTestApp();
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app, `/connect`))}`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/welcome`);
        const cookie = response.cookies.find((entry) => entry.name === `hexo_arena_signup`);
        expect(cookie).toMatchObject({ httpOnly: true, sameSite: `Lax`, path: `/api/signup`, maxAge: 900 });
        expect(cookie?.secure).toBeUndefined();
        expect(response.cookies.find((entry) => entry.name === `hexo_arena_session`)).toBeUndefined();
        const query = createQuery(sqlite);
        expect(query.select().from(users).all()).toHaveLength(0);
        expect(query.select({ next: pendingSignups.next }).from(pendingSignups).all()).toEqual([{ next: `/connect` }]);
        await app.close();
    });

    it('marks the sign-up cookie Secure when the public origin is https', async () => {
        const { app } = await createTestApp({ secureCookies: true });
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app))}`);
        expect(response.cookies.find((entry) => entry.name === `hexo_arena_signup`)?.secure).toBe(true);
        await app.close();
    });

    it('keeps one sign-up per Discord account, the newest', async () => {
        const { app, sqlite } = await createTestApp();
        await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app, `/ladder`))}`);
        await callback(app, `code=def&state=${encodeURIComponent(await loginOnce(app, `/credits`))}`);
        expect(createQuery(sqlite).select({ next: pendingSignups.next }).from(pendingSignups).all()).toEqual([{ next: `/credits` }]);
        await app.close();
    });
});

describe('GET /api/auth/discord/callback, a known account', () => {
    it('sets a lax httpOnly session cookie and returns to where the sign-in started', async () => {
        const { app } = await createTestApp();
        await signUpWithDiscord(app, `tester`);
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app, `/bots/devbot-c?online=1`))}`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/bots/devbot-c?online=1`);
        const cookie = response.cookies.find((entry) => entry.name === `hexo_arena_session`);
        expect(cookie).toMatchObject({ httpOnly: true, sameSite: `Lax`, path: `/` });
        expect(cookie?.secure).toBeUndefined();
        await app.close();
    });

    it('marks the session cookie Secure when the public origin is https', async () => {
        const { app } = await createTestApp({ secureCookies: true });
        await signUpWithDiscord(app, `tester`);
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app))}`);
        expect(response.cookies.find((entry) => entry.name === `hexo_arena_session`)?.secure).toBe(true);
        await app.close();
    });

    it('keeps the public name when Discord renames the account, and shows the new Discord names to the person', async () => {
        const fake = fakeDiscord({ id: `77`, username: `mira.hex`, displayName: `Mira` });
        const { app, sqlite } = await createTestApp({ discord: fake.oauth });
        await signUpWithDiscord(app, `mira-hex`);
        fake.identity.names = { username: `mira.renamed`, displayName: null };
        const response = await callback(app, `code=def&state=${encodeURIComponent(await loginOnce(app))}`);
        const session = response.cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
        const me = meSchema.parse((await app.inject({ method: 'GET', url: mePath, cookies: { hexo_arena_session: session } })).json());
        expect(me).toMatchObject({ kind: `user`, name: `mira-hex`, discord: { username: `mira.renamed`, displayName: null } });
        expect(createQuery(sqlite).select({ name: users.name }).from(users).all()).toEqual([{ name: `mira-hex` }]);
        await app.close();
    });

    it('ends the guest session the browser held, with its games', async () => {
        const { app } = await createTestApp();
        await signUpWithDiscord(app, `tester`);
        const guest = (await app.inject({ method: 'POST', url: guestPath })).cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
        await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app))}`, { hexo_arena_session: guest });
        expect((await app.inject({ method: 'GET', url: mePath, cookies: { hexo_arena_session: guest } })).json()).toBeNull();
        await app.close();
    });

    it('turns a banned account away before anything else, at the page it started from', async () => {
        const { app, sqlite } = await createTestApp();
        await signUpWithDiscord(app, `tester`);
        createQuery(sqlite).update(users).set({ bannedAt: 1 }).run();
        const guest = (await app.inject({ method: 'POST', url: guestPath })).cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
        const before = createQuery(sqlite).select().from(sessions).all().length;
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app, `/connect`))}`, { hexo_arena_session: guest });
        expect(response.headers.location).toBe(`/connect?signin=banned`);
        expect(response.headers[`set-cookie`]).toBeUndefined();
        expect(createQuery(sqlite).select().from(sessions).all()).toHaveLength(before);
        expect(createQuery(sqlite).select().from(pendingSignups).all()).toHaveLength(0);
        expect((await app.inject({ method: 'GET', url: mePath, cookies: { hexo_arena_session: guest } })).json()).toMatchObject({ kind: `guest` });
        await app.close();
    });
});

describe('GET /api/auth/discord/callback, a sign-in that does not finish', () => {
    it('reads an unknown state as expired, at the root', async () => {
        const { app } = await createTestApp();
        const response = await callback(app, `code=abc&state=never-issued`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/?signin=expired`);
        expect(response.headers[`set-cookie`]).toBeUndefined();
        await app.close();
    });

    it('reads a replayed state as expired', async () => {
        const { app } = await createTestApp();
        const query = `code=abc&state=${encodeURIComponent(await loginOnce(app, `/connect`))}`;
        await callback(app, query);
        const replay = await callback(app, query);
        expect(replay.headers.location).toBe(`/?signin=expired`);
        await app.close();
    });

    it('reads access_denied as a cancel at the page it started from, keeping nothing', async () => {
        const { app, sqlite } = await createTestApp();
        const response = await callback(app, `error=access_denied&state=${encodeURIComponent(await loginOnce(app, `/profile`))}`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/profile?signin=cancelled`);
        expect(response.headers[`set-cookie`]).toBeUndefined();
        expect(createQuery(sqlite).select().from(pendingSignups).all()).toHaveLength(0);
        await app.close();
    });

    it('reads a cancel with a stale state as a cancel at the root', async () => {
        const { app } = await createTestApp();
        const response = await callback(app, `error=access_denied&state=never-issued`);
        expect(response.headers.location).toBe(`/?signin=cancelled`);
        await app.close();
    });

    it.each([`error=server_error`, `error=invalid_scope&error_description=nope`, ``])('reads %j with a good state as rejected', async (extra) => {
        const { app } = await createTestApp();
        const state = `state=${encodeURIComponent(await loginOnce(app, `/ladder`))}`;
        const response = await callback(app, extra === `` ? state : `${extra}&${state}`);
        expect(response.headers.location).toBe(`/ladder?signin=rejected`);
        await app.close();
    });

    it('sends the visitor home with the reason when discord credentials are absent', async () => {
        const { app } = await createTestApp({ discord: null });
        const response = await callback(app, `code=abc&state=x`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/?signin=unconfigured`);
        await app.close();
    });

    it('reads a refused exchange as rejected, at the page it started from', async () => {
        const { app } = await createTestApp({
            discord: {
                authorizeUrl: (state: string) => `https://discord.example/authorize?state=${state}`,
                exchange: () => Promise.reject(new Error(`upstream down`)),
            },
        });
        const response = await callback(app, `code=abc&state=${encodeURIComponent(await loginOnce(app, `/credits`))}`);
        expect(response.statusCode).toBe(302);
        expect(response.headers.location).toBe(`/credits?signin=rejected`);
        expect(response.headers[`set-cookie`]).toBeUndefined();
        await app.close();
    });
});
