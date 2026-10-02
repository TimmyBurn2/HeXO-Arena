import { discordCallbackPath, guestPath, mePath, meSchema, sessionMaxAgeSeconds, signupPath, signupSchema } from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app';
import { createQuery, nowSeconds, openDatabase, runMigrations } from '../src/db';
import { nameReservations, pendingSignups, sessions, users } from '../src/db/schema';
import { discordNameOf } from '../src/discord';
import { PresenceRegistry } from '../src/presence';
import { sweepSignups } from '../src/signups';
import { GameWatchers } from '../src/watchers';
import { createTestApp, fakeDiscord, signUpWithDiscord, startDiscordSignIn, type TestApp } from './helpers';

// A first sign-in through the fake Discord, held and waiting: the signup
// cookie's value.
async function heldSignup(world: TestApp, next = `/`): Promise<string> {
    const { state, cookies } = await startDiscordSignIn(world.app, next);
    const back = await world.app.inject({ method: `GET`, url: `${discordCallbackPath}?code=c&state=${encodeURIComponent(state)}`, cookies });
    return back.cookies.find((entry) => entry.name === `hexo_arena_signup`)?.value ?? ``;
}

function read(world: TestApp, signup?: string) {
    return world.app.inject({ method: `GET`, url: signupPath, ...(signup === undefined ? {} : { cookies: { hexo_arena_signup: signup } }) });
}

function create(world: TestApp, signup: string | undefined, name: unknown, session?: string) {
    return world.app.inject({
        method: `POST`,
        url: signupPath,
        payload: { name },
        cookies: { ...(signup === undefined ? {} : { hexo_arena_signup: signup }), ...(session === undefined ? {} : { hexo_arena_session: session }) },
    });
}

afterEach(() => {
    vi.useRealTimers();
});

describe(`GET ${signupPath}`, () => {
    it('shows the Discord account, a free name made from its username, and where the sign-in returns', async () => {
        const world = await createTestApp({ discord: fakeDiscord({ id: `9`, username: `mira.hex`, displayName: `Mira` }).oauth });
        const response = await read(world, await heldSignup(world, `/connect`));
        expect(response.statusCode).toBe(200);
        expect(signupSchema.parse(response.json())).toEqual({
            discord: { username: `mira.hex`, displayName: `Mira` },
            suggestedName: `mira-hex`,
            next: `/connect`,
        });
        await world.app.close();
    });

    it('answers 410 signup_expired without a cookie, or for one it does not know', async () => {
        const world = await createTestApp();
        for (const response of [await read(world), await read(world, `never-issued`)]) {
            expect(response.statusCode).toBe(410);
            expect(response.json()).toMatchObject({ code: `signup_expired` });
        }
        await world.app.close();
    });

    it('lets the sign-up go after 15 minutes', async () => {
        const world = await createTestApp();
        const signup = await heldSignup(world);
        vi.useFakeTimers({ toFake: [`Date`] });
        vi.setSystemTime(Date.now() + 15 * 60 * 1000);
        expect((await read(world, signup)).statusCode).toBe(410);
        await world.app.close();
    });

    it('suffixes the suggestion past a name another player holds', async () => {
        const world = await createTestApp({ discord: fakeDiscord({ id: `9`, username: `mira.hex` }).oauth });
        createQuery(world.sqlite).insert(nameReservations).values([{ nameKey: `mira-hex` }, { nameKey: `mira-hex-1` }]).run();
        expect(signupSchema.parse((await read(world, await heldSignup(world))).json()).suggestedName).toBe(`mira-hex-2`);
        await world.app.close();
    });

    it.each([
        [`some.user`, `some-user`],
        [`mira..hex`, `mira--hex`],
        [`.lead.dot`, `lead-dot`],
        [`1bob`, `bob`],
        [`bob-`, `bob`],
        [`bob.`, `bob`],
        [`a`, `user`],
        [`admin`, `admin-1`],
        [`\u00c4l\u00e4`, `user`],
        [`x`.repeat(32), `x`.repeat(30)],
        [`${`x`.repeat(29)}.y`, `x`.repeat(29)],
    ])('suggests %j as %s', async (username, expected) => {
        const world = await createTestApp({ discord: fakeDiscord({ id: `9`, username }).oauth });
        expect(signupSchema.parse((await read(world, await heldSignup(world))).json()).suggestedName).toBe(expected);
        await world.app.close();
    });
});

describe(`POST ${signupPath}`, () => {
    it('creates the account under the chosen name, signs it in, and drops the sign-up', async () => {
        const world = await createTestApp({ discord: fakeDiscord({ id: `9`, username: `mira.hex`, displayName: `Mira` }).oauth });
        const signup = await heldSignup(world);
        const response = await create(world, signup, `Mira`);
        expect(response.statusCode).toBe(201);
        expect(response.json()).toEqual({ name: `Mira` });
        const session = response.cookies.find((entry) => entry.name === `hexo_arena_session`);
        expect(session).toMatchObject({ httpOnly: true, sameSite: `Lax`, path: `/` });
        const cleared = response.cookies.find((entry) => entry.name === `hexo_arena_signup`);
        expect(cleared?.value).toBe(``);
        const me = meSchema.parse((await world.app.inject({ method: `GET`, url: mePath, cookies: { hexo_arena_session: session?.value ?? `` } })).json());
        expect(me).toEqual({ kind: `user`, name: `Mira`, rating: 1000, provisional: true, discord: { username: `mira.hex`, displayName: `Mira` }, liveGames: [] });
        const query = createQuery(world.sqlite);
        expect(query.select({ discordId: users.discordId, name: users.name }).from(users).all()).toEqual([{ discordId: `9`, name: `Mira` }]);
        expect(query.select().from(pendingSignups).all()).toHaveLength(0);
        expect((await read(world, signup)).statusCode).toBe(410);
        await world.app.close();
    });

    it.each([
        [`m`, 400, `invalid_name`],
        [`mira.hex`, 400, `invalid_name`],
        [42, 400, `invalid_name`],
        [`Admin`, 400, `name_reserved`],
        [`deleted-7`, 400, `name_reserved`],
    ])('refuses %j with %i %s and keeps the sign-up', async (name, status, code) => {
        const world = await createTestApp();
        const signup = await heldSignup(world);
        const response = await create(world, signup, name);
        expect(response.statusCode).toBe(status);
        expect(response.json()).toMatchObject({ code });
        expect((await read(world, signup)).statusCode).toBe(200);
        await world.app.close();
    });

    it('refuses a name another player holds with 409 name_taken', async () => {
        const world = await createTestApp();
        await world.app.inject({ method: `POST`, url: `/api/dev/login`, payload: { name: `taken` } });
        const response = await create(world, await heldSignup(world), `TAKEN`);
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: `name_taken` });
        await world.app.close();
    });

    it('answers 410 signup_expired without a sign-up', async () => {
        const world = await createTestApp();
        const response = await create(world, undefined, `mira`);
        expect(response.statusCode).toBe(410);
        expect(response.json()).toMatchObject({ code: `signup_expired` });
        await world.app.close();
    });

    it('ends the sign-up once it has tried 10 names', async () => {
        const world = await createTestApp();
        const signup = await heldSignup(world);
        for (let attempt = 0; attempt < 10; attempt += 1) {
            expect((await create(world, signup, `Admin`)).statusCode).toBe(400);
        }
        const limited = await create(world, signup, `mira`);
        expect(limited.statusCode).toBe(410);
        expect(limited.json()).toMatchObject({ code: `signup_limit` });
        expect((await read(world, signup)).statusCode).toBe(410);
        expect(createQuery(world.sqlite).select().from(users).all()).toHaveLength(0);
        await world.app.close();
    });

    it('ends the guest session the browser held, with its games, only once the account exists', async () => {
        const world = await createTestApp();
        const guest = (await world.app.inject({ method: `POST`, url: guestPath })).cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
        const signup = await heldSignup(world);
        const guestMe = () => world.app.inject({ method: `GET`, url: mePath, cookies: { hexo_arena_session: guest } });
        expect((await guestMe()).json()).toMatchObject({ kind: `guest` });
        expect((await create(world, signup, `mira`, guest)).statusCode).toBe(201);
        expect((await guestMe()).json()).toBeNull();
        await world.app.close();
    });
});

describe(`DELETE ${signupPath}`, () => {
    it('keeps nothing of the sign-up and clears its cookie', async () => {
        const world = await createTestApp();
        const signup = await heldSignup(world);
        const response = await world.app.inject({ method: `DELETE`, url: signupPath, cookies: { hexo_arena_signup: signup } });
        expect(response.statusCode).toBe(204);
        expect(response.cookies.find((entry) => entry.name === `hexo_arena_signup`)?.value).toBe(``);
        const query = createQuery(world.sqlite);
        expect(query.select().from(pendingSignups).all()).toHaveLength(0);
        expect(query.select().from(users).all()).toHaveLength(0);
        expect((await world.app.inject({ method: `DELETE`, url: signupPath })).statusCode).toBe(204);
        await world.app.close();
    });
});

describe('the held sign-ups', () => {
    const row = { tokenHash: `h`, discordId: `9`, discordUsername: `mira.hex`, discordDisplayName: null, next: `/`, expiresAt: 1 };

    it('refuse rows that break their bounds', () => {
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const query = createQuery(sqlite);
        for (const bad of [
            { discordId: `` },
            { discordUsername: `` },
            { discordUsername: `m`.repeat(33) },
            { discordDisplayName: `` },
            { discordDisplayName: `M`.repeat(33) },
            { next: `ladder` },
            { next: `/${`a`.repeat(256)}` },
            { attempts: 11 },
            { attempts: -1 },
        ]) {
            expect(() => query.insert(pendingSignups).values({ ...row, ...bad }).run()).toThrow(/CHECK constraint failed/);
        }
        query.insert(pendingSignups).values(row).run();
        expect(() => query.insert(pendingSignups).values({ ...row, tokenHash: `other` }).run()).toThrow(/UNIQUE constraint failed/);
        sqlite.close();
    });

    it('leave on the sweep once expired, and at boot with expired sessions', async () => {
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const query = createQuery(sqlite);
        query.insert(pendingSignups).values([row, { ...row, tokenHash: `live`, discordId: `10`, expiresAt: nowSeconds() + 60 }]).run();
        expect(sweepSignups(query)).toBe(1);
        query.insert(pendingSignups).values(row).run();
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into sessions (id, token_hash, user_id, created_at, expires_at, discord_username) values ('s1', 'h1', 'u1', 1, 2, 'owner.name');
        `);
        const built = await buildApp({
            sqlite,
            discord: null,
            secureCookies: false,
            devLogin: false,
            presence: new PresenceRegistry(),
            watchers: new GameWatchers(),
            adminActor: `operator`,
            publicOrigin: `https://arena.example`,
        });
        expect(query.select({ tokenHash: pendingSignups.tokenHash }).from(pendingSignups).all()).toEqual([{ tokenHash: `live` }]);
        expect(query.select().from(sessions).all()).toHaveLength(0);
        await built.app.close();
        sqlite.close();
    });

    it('leave on the minute beat once expired, and the sessions that keep Discord names with them', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        const world = await createTestApp();
        await signUpWithDiscord(world.app, `mira`);
        const query = createQuery(world.sqlite);
        query.insert(pendingSignups).values({ ...row, discordId: `10`, expiresAt: nowSeconds() + 30 }).run();
        vi.advanceTimersByTime(60_000);
        expect(query.select().from(pendingSignups).all()).toHaveLength(0);
        expect(query.select().from(sessions).all()).toHaveLength(1);
        vi.setSystemTime(Date.now() + sessionMaxAgeSeconds * 1000);
        vi.advanceTimersByTime(60_000);
        expect(query.select().from(sessions).all()).toHaveLength(0);
        await world.app.close();
    });

    it('never outlive the account they became', async () => {
        const world = await createTestApp();
        await signUpWithDiscord(world.app, `mira`);
        const query = createQuery(world.sqlite);
        expect(query.select().from(pendingSignups).all()).toHaveLength(0);
        expect(query.select({ username: sessions.discordUsername }).from(sessions).all()).toEqual([{ username: `tester` }]);
        await world.app.close();
    });
});

describe('discordNameOf', () => {
    it.each([
        [`Mira`, `Mira`],
        [`  Mira  `, `Mira`],
        [`Mi\u0000ra\u0007`, `Mira`],
        [`\u202eariM`, `ariM`],
        [`\u2067Mira\u2069\u200e`, `Mira`],
        [`Mi\u200bra\u00ad\ufeff`, `Mira`],
        [`Mira\nHex\t Arena`, `Mira Hex Arena`],
        [`Cafe\u0301`, `Caf\u00e9`],
        [`\u{1f3b2}`.repeat(40), `\u{1f3b2}`.repeat(32)],
        [`M`.repeat(40), `M`.repeat(32)],
        [`\u0000\u202e`, null],
        [``, null],
        [null, null],
        [undefined, null],
    ])('keeps %j as %j', (raw, kept) => {
        expect(discordNameOf(raw)).toBe(kept);
    });
});
