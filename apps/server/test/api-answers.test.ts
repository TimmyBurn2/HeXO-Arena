import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, type TestApp } from './helpers';

let world: TestApp;

afterEach(async () => {
    await world.app.close();
    world.sqlite.close();
});

describe('API answers', () => {
    it('carry no-store wherever the app left them unmarked, refusals included', async () => {
        world = await createTestApp({ logger: false });
        const session = await loginAs(world.app, `alice`);
        const answers = [
            await world.app.inject({ method: `GET`, url: `/api/me`, cookies: { hexo_arena_session: session } }),
            await world.app.inject({ method: `POST`, url: `/api/bots`, cookies: { hexo_arena_session: session }, payload: { name: `tokenbot` } }),
            await world.app.inject({ method: `GET`, url: `/api/leaderboard?kind=robots` }),
            await world.app.inject({ method: `GET`, url: `/api/players/nobody` }),
        ];
        expect(answers.map((answer) => answer.statusCode)).toEqual([200, 201, 400, 404]);
        for (const answer of answers) expect(answer.headers[`cache-control`]).toBe(`no-store`);
    });

    it('leave the health check and the page shell to their own caching', async () => {
        const site = mkdtempSync(join(tmpdir(), `hexo-arena-shell-`));
        const indexPath = join(site, `index.html`);
        writeFileSync(
            indexPath,
            `<title>t</title><meta name="description" content="d" /><meta property="og:title" content="t" /><meta property="og:description" content="d" /><meta property="og:image" content="/i.png" />`,
        );
        world = await createTestApp({ logger: false, webIndexPath: indexPath });
        expect((await world.app.inject({ method: `GET`, url: `/healthz` })).headers[`cache-control`]).toBeUndefined();
        expect((await world.app.inject({ method: `GET`, url: `/` })).headers[`cache-control`]).toBe(`no-cache`);
    });
});

describe('the framework\'s own refusals', () => {
    it('answer an unknown route 404 not_found, never echoing its path or query', async () => {
        world = await createTestApp({ logger: false });
        for (const method of [`GET`, `POST`, `DELETE`] as const) {
            const missing = await world.app.inject({ method, url: `/api/nowhere/pathmarker?q=querymarker` });
            expect(missing.statusCode).toBe(404);
            expect(missing.json()).toEqual({ error: `not found`, code: `not_found` });
        }
    });

    it('answer a malformed, empty, or prototype-polluting json body 400 bad_request', async () => {
        world = await createTestApp({ logger: false });
        const session = await loginAs(world.app, `alice`);
        for (const payload of [`{"name": bodymarker`, ``, `{"__proto__": {"x": 1}, "name": "bodymarker"}`]) {
            const refused = await world.app.inject({ method: `POST`, url: `/api/bots`, cookies: { hexo_arena_session: session }, headers: { 'content-type': `application/json` }, payload });
            expect(refused.statusCode, payload).toBe(400);
            expect(refused.json(), payload).toEqual({ error: `the request is malformed`, code: `bad_request` });
        }
    });

    it('answer a body of a type the app does not read 415 unsupported_media_type', async () => {
        world = await createTestApp({ logger: false });
        const refused = await world.app.inject({ method: `POST`, url: `/api/bots`, headers: { 'content-type': `application/xml` }, payload: `<name>bodymarker</name>` });
        expect(refused.statusCode).toBe(415);
        expect(refused.json()).toEqual({ error: `the body's content type is not supported`, code: `unsupported_media_type` });
    });

    it('answer a path that fails to decode or runs past the parameter cap in the contract shape, never echoing it', async () => {
        world = await createTestApp({ logger: false });
        const undecodable = await world.app.inject({ method: `GET`, url: `/api/players/marker%c0` });
        expect(undecodable.statusCode).toBe(400);
        expect(undecodable.json()).toEqual({ error: `the request is malformed`, code: `bad_request` });
        const long = await world.app.inject({ method: `GET`, url: `/api/players/${`marker`.repeat(20)}` });
        expect(long.statusCode).toBe(414);
        expect(long.json()).toEqual({ error: `the path is too long`, code: `bad_request` });
    });
});
