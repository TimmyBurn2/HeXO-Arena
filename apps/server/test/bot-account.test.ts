import {
    botAccountPath,
    botAccountSchema,
    botsPath,
    botWithTokenSchema,
    devLoginPath,
} from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers';

async function devLogin(app: Awaited<ReturnType<typeof createTestApp>>['app'], name: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: devLoginPath, payload: { name } });
    expect(response.statusCode).toBe(200);
    return (response.headers[`set-cookie`] as string).split(`;`)[0]?.split(`=`)[1] ?? ``;
}

async function mintBotToken(
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    owner: string,
    name: string,
): Promise<string> {
    const created = await app.inject({
        method: 'POST',
        url: botsPath,
        payload: { name },
        cookies: { hexo_arena_session: owner },
    });
    expect(created.statusCode).toBe(201);
    const body: unknown = created.json();
    return botWithTokenSchema.parse(body).token;
}

async function patch(
    app: Awaited<ReturnType<typeof createTestApp>>['app'],
    token: string,
    payload: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
    const response = await app.inject({
        method: 'PATCH',
        url: botAccountPath,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload,
    });
    return { statusCode: response.statusCode, body: response.json() };
}

// An unrated bot sits at the bot seed, provisional until it has played.
const seed = { rating: 1500, provisional: true };

describe('GET /api/bot/account', () => {
    it('reads the seed rating and the declaration as stored', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Reader`);
        await patch(app, token, { about: `hello` });
        const response = await app.inject({
            method: 'GET',
            url: botAccountPath,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ name: `Reader`, ...seed, about: `hello` });
        await app.close();
    });

    it('reads the rating the bot holds now, in whole points', async () => {
        const { app, sqlite } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Rated`);
        sqlite
            .prepare(`insert into ratings (bot_id, rating, deviation, volatility) select id, 1622.5, 70, 0.06 from bots`)
            .run();
        const response = await app.inject({
            method: 'GET',
            url: botAccountPath,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.json()).toEqual({ name: `Rated`, rating: 1623, provisional: false });
        await app.close();
    });

    it('answers 401 without a token', async () => {
        const { app } = await createTestApp();
        const response = await app.inject({ method: 'GET', url: botAccountPath });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toMatchObject({ code: `unauthorized` });
        await app.close();
    });
});

describe('PATCH /api/bot/account', () => {
    it('stores the whole declaration and answers with the account as it stands', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Declarer`);
        const declaration = {
            about: `a careful bot`,
            version: `1.2.3`,
            repoUrl: `https://github.com/example/bot`,
            accepts: { turnMs: [5_000, 30_000], match: true, unlimited: false },
        };
        const result = await patch(app, token, declaration);
        expect(result.statusCode).toBe(200);
        expect(result.body).toEqual({ name: `Declarer`, ...seed, ...declaration });
        expect(botAccountSchema.parse(result.body)).toEqual({ name: `Declarer`, ...seed, ...declaration });
        await app.close();
    });

    it('keeps absent fields and replaces present ones', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Partial`);
        await patch(app, token, { about: `first`, version: `1` });
        const second = await patch(app, token, { version: `2` });
        expect(second.body).toEqual({ name: `Partial`, ...seed, about: `first`, version: `2` });
        await app.close();
    });

    it('accepts an empty declaration as a no-op that keeps everything', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Quiet`);
        await patch(app, token, { about: `stays` });
        const result = await patch(app, token, {});
        expect(result.statusCode).toBe(200);
        expect(result.body).toEqual({ name: `Quiet`, ...seed, about: `stays` });
        await app.close();
    });

    it('clears text fields with an empty string', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Clearer`);
        await patch(app, token, { about: `gone soon`, repoUrl: `https://example.com/bot` });
        const cleared = await patch(app, token, { about: ``, repoUrl: `` });
        expect(cleared.body).toEqual({ name: `Clearer`, ...seed });
        await app.close();
    });

    it('replaces accepts wholesale', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Picky`);
        await patch(app, token, { accepts: { turnMs: [5_000, 30_000], match: true, unlimited: false } });
        const replaced = await patch(app, token, { accepts: { turnMs: null, match: false, unlimited: true } });
        expect(replaced.body).toEqual({
            name: `Picky`,
            ...seed,
            accepts: { turnMs: null, match: false, unlimited: true },
        });
        await app.close();
    });

    it('answers 401 without or with an unknown token', async () => {
        const { app } = await createTestApp();
        const noToken = await patch(app, ``, { about: `x` });
        expect(noToken.statusCode).toBe(401);
        expect(noToken.body).toMatchObject({ code: `unauthorized` });
        const unknown = await patch(app, `hxo_${`a`.repeat(43)}`, { about: `x` });
        expect(unknown.statusCode).toBe(401);
        await app.close();
    });

    it.each([
        [`about over the cap`, { about: `a`.repeat(281) }],
        [`version over the cap`, { version: `v`.repeat(65) }],
        [`a non-http repo url`, { repoUrl: `ftp://example.com/bot` }],
        [`a bare-host repo url`, { repoUrl: `github.com/example/bot` }],
        [`accepts without match`, { accepts: { turnMs: null, unlimited: true } }],
        [`accepts with an inverted window`, { accepts: { turnMs: [30_000, 5_000], match: true, unlimited: true } }],
        [`accepts with a three-number window`, { accepts: { turnMs: [1, 2, 3], match: true, unlimited: true } }],
        [`an unknown field`, { nope: true }],
    ])('rejects %j with bad_request', async (_name, payload) => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Rejects`);
        const result = await patch(app, token, payload);
        expect(result.statusCode).toBe(400);
        expect(result.body).toMatchObject({ code: `bad_request` });
        await app.close();
    });

    it('surfaces the declaration in the directory', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Visible`);
        await patch(app, token, {
            about: `look at me`,
            version: `9.9.9`,
            repoUrl: `https://example.com/visible`,
            accepts: { turnMs: null, match: true, unlimited: true },
        });
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([
            {
                name: `Visible`,
                ownerName: `owner`,
                online: false,
                openForChallenges: false,
                rating: 1500,
                provisional: true,
                liveGames: 0,
                about: `look at me`,
                version: `9.9.9`,
                repoUrl: `https://example.com/visible`,
                accepts: { turnMs: null, match: true, unlimited: true },
            },
        ]);
        await app.close();
    });

    it('leaves the directory lean for an undeclared bot', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        await mintBotToken(app, owner, `Quiet`);
        const response = await app.inject({ method: 'GET', url: botsPath });
        expect(response.json()).toEqual([
            { name: `Quiet`, ownerName: `owner`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0 },
        ]);
        await app.close();
    });
});
