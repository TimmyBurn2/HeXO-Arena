import { botAccountPath, botStreamPath, botsPath, botWithTokenSchema } from '@hexo-arena/contract';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { users } from '../src/db/schema';
import { createTestApp } from './helpers';

async function devLogin(app: Awaited<ReturnType<typeof createTestApp>>['app'], name: string): Promise<string> {
    const response = await app.inject({ method: 'POST', url: `/api/dev/login`, payload: { name } });
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

const unauthorized = { error: `missing, unknown, or rotated token`, code: `unauthorized` };

describe('bot bearer auth', () => {
    it('answers 401 with the contract error body on every bot surface without a token', async () => {
        const { app } = await createTestApp();
        const stream = await app.inject({ method: 'GET', url: botStreamPath });
        expect(stream.statusCode).toBe(401);
        expect(stream.json()).toMatchObject(unauthorized);
        const account = await app.inject({ method: 'PATCH', url: botAccountPath, payload: {} });
        expect(account.statusCode).toBe(401);
        expect(account.json()).toMatchObject(unauthorized);
        await app.close();
    });

    it('answers 401 for a malformed bearer and for a well-shaped unknown token', async () => {
        const { app } = await createTestApp();
        for (const authorization of [`Bearer not-a-token`, `Basic hxo_x`, `Bearer hxo_${`a`.repeat(43)}`]) {
            const response = await app.inject({
                method: 'GET',
                url: botStreamPath,
                headers: { authorization },
            });
            expect(response.statusCode).toBe(401);
            expect(response.json()).toMatchObject(unauthorized);
        }
        await app.close();
    });

    it('rejects a rotated token', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Turncoat`);
        const rotated = await app.inject({
            method: 'POST',
            url: `/api/bots/Turncoat/token`,
            cookies: { hexo_arena_session: owner },
        });
        expect(rotated.statusCode).toBe(200);
        const response = await app.inject({
            method: 'GET',
            url: botStreamPath,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(401);
        await app.close();
    });

    it('answers 403 banned while the owner is banned', async () => {
        const { app, sqlite } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Banned`);
        createQuery(sqlite)
            .update(users)
            .set({ bannedAt: 1 })
            .where(eq(users.nameKey, `owner`))
            .run();
        const response = await app.inject({
            method: 'GET',
            url: botStreamPath,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ code: `banned` });
        await app.close();
    });

    it('authenticates a live token far enough to reach the query validation', async () => {
        const { app } = await createTestApp();
        const owner = await devLogin(app, `owner`);
        const token = await mintBotToken(app, owner, `Online`);
        const response = await app.inject({
            method: 'GET',
            url: `${botStreamPath}?open=0`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: `bad_request` });
        await app.close();
    });
});
