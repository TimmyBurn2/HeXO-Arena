import { botsPath, botTokenPattern, botWithTokenSchema, devLoginPath } from '@hexarena/contract';
import { desc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { botCapPerUser } from '../src/bots';
import { createQuery } from '../src/db';
import { bots } from '../src/db/schema';
import { sha256Hex } from '../src/tokens';
import { createTestApp, FakeStreamSocket } from './helpers';

function cookieFrom(response: { headers: { [key: string]: unknown } }): string {
    const setCookie = response.headers[`set-cookie`];
    return typeof setCookie === `string` ? (setCookie.split(`;`)[0] ?? ``) : ``;
}

async function devLogin(
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    name: string,
): Promise<string> {
    const response = await app.inject({ method: 'POST', url: devLoginPath, payload: { name } });
    expect(response.statusCode).toBe(200);
    return cookieFrom(response);
}

describe('POST /api/bots', () => {
    it('answers 401 without a session', async () => {
        const { app } = await createTestApp();
        const response = await app.inject({ method: 'POST', url: botsPath, payload: { name: `ibot` } });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ code: `unauthorized` });
        await app.close();
    });

    it('creates a bot and shows the token exactly once', async () => {
        const { app, sqlite } = await createTestApp();
        const cookie = await devLogin(app, `owner`);
        const response = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `MyBot` },
            cookies: { hexarena_session: cookie.split(`=`)[1] ?? `` },
        });
        expect(response.statusCode).toBe(201);
        const body: unknown = response.json();
        const created = botWithTokenSchema.parse(body);
        expect(created.name).toBe(`MyBot`);
        expect(created.token).toMatch(botTokenPattern);
        const row = createQuery(sqlite).select().from(bots).orderBy(desc(bots.createdAt)).all()[0];
        expect(row?.tokenHash).toBe(sha256Hex(created.token));
        expect(row?.scope).toBe(`bot:play`);
        await app.close();
    });

    it.each([
        [`a`, `invalid_name`],
        [`1bot`, `invalid_name`],
        [`admin`, `name_reserved`],
        [`Moderator`, `name_reserved`],
    ])('rejects the name %j with %j', async (name, code) => {
        const { app } = await createTestApp();
        const cookie = await devLogin(app, `owner`);
        const response = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name },
            cookies: { hexarena_session: cookie.split(`=`)[1] ?? `` },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code });
        await app.close();
    });

    it('rejects a fold collision with a bot', async () => {
        const { app } = await createTestApp();
        const cookie = await devLogin(app, `owner`);
        const session = cookie.split(`=`)[1] ?? ``;
        const first = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `FoldBot` },
            cookies: { hexarena_session: session },
        });
        expect(first.statusCode).toBe(201);
        const second = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `foldbot` },
            cookies: { hexarena_session: session },
        });
        expect(second.statusCode).toBe(409);
        expect(second.json()).toMatchObject({ code: `name_taken` });
        await app.close();
    });

    it('rejects a fold collision with a user across the shared namespace', async () => {
        const { app } = await createTestApp();
        const cookie = await devLogin(app, `HumanName`);
        const response = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `humanname` },
            cookies: { hexarena_session: cookie.split(`=`)[1] ?? `` },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({ code: `name_taken` });
        await app.close();
    });

    it(`caps each owner at ${botCapPerUser.toString()} bots`, async () => {
        const { app } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        for (let i = 0; i < botCapPerUser; i++) {
            const response = await app.inject({
                method: 'POST',
                url: botsPath,
                payload: { name: `bot-${i.toString()}` },
                cookies: { hexarena_session: session },
            });
            expect(response.statusCode).toBe(201);
        }
        const fourth = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `bot-3` },
            cookies: { hexarena_session: session },
        });
        expect(fourth.statusCode).toBe(403);
        expect(fourth.json()).toMatchObject({ code: `bot_limit` });
        await app.close();
    });
});

describe('GET /api/bots', () => {
    it('lists bots with their owner names, ordered by the name fold', async () => {
        const { app } = await createTestApp();
        const owner = (await devLogin(app, `Zed`)).split(`=`)[1] ?? ``;
        const other = (await devLogin(app, `Ann`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Beta` },
            cookies: { hexarena_session: owner },
        });
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `alpha` },
            cookies: { hexarena_session: other },
        });
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([
            { name: `alpha`, ownerName: `Ann`, online: false, openForChallenges: false },
            { name: `Beta`, ownerName: `Zed`, online: false, openForChallenges: false },
        ]);
        await app.close();
    });

    it('is public and empty before any bot exists', async () => {
        const { app } = await createTestApp();
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([]);
        await app.close();
    });

    it('derives online and openForChallenges from the live presence registry', async () => {
        const { app, sqlite, presence } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Idle` },
            cookies: { hexarena_session: session },
        });
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Live` },
            cookies: { hexarena_session: session },
        });
        const rows = createQuery(sqlite).select({ id: bots.id, name: bots.name }).from(bots).orderBy(bots.nameKey).all();
        const live = rows.find((row) => row.name === `Live`);
        if (!live) throw new Error(`the Live bot is missing from the roster`);
        presence.attach(live.id, new FakeStreamSocket(), true);
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.json()).toEqual([
            { name: `Idle`, ownerName: `owner`, online: false, openForChallenges: false },
            { name: `Live`, ownerName: `owner`, online: true, openForChallenges: true },
        ]);
        await app.close();
    });

    it('drops presence when the stream dies', async () => {
        const { app, sqlite, presence } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Dropped` },
            cookies: { hexarena_session: session },
        });
        const [row] = createQuery(sqlite).select({ id: bots.id }).from(bots).all();
        if (!row) throw new Error(`the bot row is missing`);
        const socket = new FakeStreamSocket();
        presence.attach(row.id, socket, true);
        socket.emitClose();
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.json()).toEqual([
            { name: `Dropped`, ownerName: `owner`, online: false, openForChallenges: false },
        ]);
        await app.close();
    });

    it('narrows the roster with online=1 and rejects any other value', async () => {
        const { app, sqlite, presence } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Idle` },
            cookies: { hexarena_session: session },
        });
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Live` },
            cookies: { hexarena_session: session },
        });
        const rows = createQuery(sqlite).select({ id: bots.id, name: bots.name }).from(bots).orderBy(bots.nameKey).all();
        const live = rows.find((row) => row.name === `Live`);
        if (!live) throw new Error(`the Live bot is missing from the roster`);
        presence.attach(live.id, new FakeStreamSocket(), false);
        const narrowed = await app.inject({ method: 'GET', url: `${botsPath}?online=1` });
        expect(narrowed.json()).toEqual([
            { name: `Live`, ownerName: `owner`, online: true, openForChallenges: false },
        ]);
        const rejected = await app.inject({ method: 'GET', url: `${botsPath}?online=0` });
        expect(rejected.statusCode).toBe(400);
        expect(rejected.json()).toMatchObject({ code: `bad_request` });
        await app.close();
    });
});

describe('DELETE /api/bots/:name', () => {
    it('deletes the owner bot, frees the name, and 404s afterwards', async () => {
        const { app } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Gone` },
            cookies: { hexarena_session: session },
        });
        const deleted = await app.inject({
            method: 'DELETE',
            url: `/api/bots/Gone`,
            cookies: { hexarena_session: session },
        });
        expect(deleted.statusCode).toBe(204);
        const second = await app.inject({
            method: 'DELETE',
            url: `/api/bots/Gone`,
            cookies: { hexarena_session: session },
        });
        expect(second.statusCode).toBe(404);
        expect(second.json()).toMatchObject({ code: `not_found` });
        const relisted = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `gone` },
            cookies: { hexarena_session: session },
        });
        expect(relisted.statusCode).toBe(201);
        await app.close();
    });

    it('hides another owner bot behind 404', async () => {
        const { app } = await createTestApp();
        const owner = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        const stranger = (await devLogin(app, `stranger`)).split(`=`)[1] ?? ``;
        await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `OwnBot` },
            cookies: { hexarena_session: owner },
        });
        const response = await app.inject({
            method: 'DELETE',
            url: `/api/bots/OwnBot`,
            cookies: { hexarena_session: stranger },
        });
        expect(response.statusCode).toBe(404);
        const roster = await app.inject({ method: 'GET', url: botsPath });
        expect(roster.json()).toHaveLength(1);
        await app.close();
    });
});

describe('POST /api/bots/:name/token', () => {
    it('rotates the token and replaces the stored hash', async () => {
        const { app, sqlite } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        const created = await app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name: `Turncoat` },
            cookies: { hexarena_session: session },
        });
        expect(created.statusCode).toBe(201);
        const oldToken: unknown = created.json();
        const oldParsed = botWithTokenSchema.parse(oldToken).token;
        const rotated = await app.inject({
            method: 'POST',
            url: `/api/bots/Turncoat/token`,
            cookies: { hexarena_session: session },
        });
        expect(rotated.statusCode).toBe(200);
        const rotatedBody: unknown = rotated.json();
        const newParsed = botWithTokenSchema.parse(rotatedBody);
        expect(newParsed.name).toBe(`Turncoat`);
        expect(newParsed.token).toMatch(botTokenPattern);
        expect(newParsed.token).not.toBe(oldParsed);
        const row = createQuery(sqlite).select().from(bots).all()[0];
        expect(row?.tokenHash).toBe(sha256Hex(newParsed.token));
        await app.close();
    });

    it('answers 404 for an unknown bot', async () => {
        const { app } = await createTestApp();
        const session = (await devLogin(app, `owner`)).split(`=`)[1] ?? ``;
        const response = await app.inject({
            method: 'POST',
            url: `/api/bots/ghost/token`,
            cookies: { hexarena_session: session },
        });
        expect(response.statusCode).toBe(404);
        await app.close();
    });
});
