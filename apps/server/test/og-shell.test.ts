import { botAccountPath, gamesPath, gameSnapshotSchema, guestPath, logoutPath } from '@hexo-arena/contract';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderShell } from '../src/og-shell';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), `../../web/index.html`);
const origin = `https://arena.example`;

function metaOf(html: string): { title: string; description: string; ogTitle: string; ogDescription: string } {
    const pick = (pattern: RegExp): string => pattern.exec(html)?.[1] ?? `missing`;
    return {
        title: pick(/<title>([^<]*)<\/title>/),
        description: pick(/<meta name="description" content="([^"]*)"/),
        ogTitle: pick(/<meta property="og:title" content="([^"]*)"/),
        ogDescription: pick(/<meta property="og:description" content="([^"]*)"/),
    };
}

describe('renderShell', () => {
    it('sets the title, description, and both og tags, escaped', () => {
        const html = renderShell(
            readFileSync(indexPath, `utf8`),
            {
                title: `a <b> & "c"`,
                description: `it's <script>`,
            },
            origin,
        );
        expect(metaOf(html)).toEqual({
            title: `a &lt;b&gt; &amp; &quot;c&quot;`,
            description: `it&#39;s &lt;script&gt;`,
            ogTitle: `a &lt;b&gt; &amp; &quot;c&quot;`,
            ogDescription: `it&#39;s &lt;script&gt;`,
        });
        expect(html).not.toContain(`<script>`);
    });

    it('refuses a template that lost one of its tags', () => {
        const template = readFileSync(indexPath, `utf8`).replace(/<meta property="og:title"[^>]*>/, ``);
        expect(() => renderShell(template, { title: `t`, description: `d` }, origin)).toThrow(/og:title/);
        const imageless = readFileSync(indexPath, `utf8`).replace(/<meta property="og:image"[^>]*>/, ``);
        expect(() => renderShell(imageless, { title: `t`, description: `d` }, origin)).toThrow(/og:image/);
    });

    it('points the preview image at the site icon on the public origin, since a preview needs an absolute address', () => {
        const html = renderShell(readFileSync(indexPath, `utf8`), { title: `t`, description: `d` }, origin);
        expect(html).toContain(`<meta property="og:image" content="https://arena.example/icon-512.png" />`);
        expect(html).toContain(`<meta property="og:site_name" content="HeXO Arena" />`);
    });
});

describe('the og shell routes', () => {
    let arena: TestApp;

    beforeEach(async () => {
        arena = await createTestApp({ webIndexPath: indexPath });
    });

    afterEach(async () => {
        await arena.app.close();
    });

    async function shell(url: string): Promise<{ status: number; cacheControl: unknown; meta: ReturnType<typeof metaOf> }> {
        const response = await arena.app.inject({ method: `GET`, url });
        expect(response.headers[`content-type`]).toBe(`text/html; charset=utf-8`);
        return { status: response.statusCode, cacheControl: response.headers[`cache-control`], meta: metaOf(response.body) };
    }

    async function openBot(name: string): Promise<void> {
        const session = await loginAs(arena.app, `${name}owner`);
        const token = await mintBot(arena.app, session, name);
        const declared = await arena.app.inject({
            method: `PATCH`,
            url: botAccountPath,
            headers: { authorization: `Bearer ${token}` },
            payload: { about: `plays fast`, accepts: { turnMs: [5_000, 60_000], match: false, unlimited: false } },
        });
        expect(declared.statusCode).toBe(200);
        // The bot was minted just above and names are unique, so exactly one row answers.
        const row = arena.sqlite.prepare(`select id from bots where name = ?`).get(name) as { id: string };
        arena.presence.attach(row.id, new FakeStreamSocket(), true);
    }

    it('counts the roster on the root under the site title', async () => {
        await openBot(`sealbot`);
        const response = await shell(`/`);
        expect(response.status).toBe(200);
        expect(response.cacheControl).toBe(`no-cache`);
        expect(response.meta.ogTitle).toBe(`HeXO Arena - one ladder for bots and humans`);
        expect(response.meta.ogDescription).toBe(`1 bot listed, 1 online`);
    });

    it('carries the site icon and name on every shell route, found or not', async () => {
        for (const url of [`/`, `/ladder`, `/bots/nobody`, `/game/g_nothing`]) {
            const response = await arena.app.inject({ method: `GET`, url });
            expect(response.body).toContain(`<meta property="og:image" content="https://arena.example/icon-512.png" />`);
            expect(response.body).toContain(`<meta property="og:site_name" content="HeXO Arena" />`);
        }
    });

    it('counts the roster on the ladder route under its own title', async () => {
        await openBot(`sealbot`);
        const response = await shell(`/ladder`);
        expect(response.status).toBe(200);
        expect(response.cacheControl).toBe(`no-cache`);
        expect(response.meta.title).toBe(`Ladder - HeXO Arena`);
        expect(response.meta.ogTitle).toBe(`Ladder - HeXO Arena`);
        expect(response.meta.ogDescription).toBe(`1 bot listed, 1 online`);
    });

    it('describes a listed bot and answers 404 for an unknown or delisted one', async () => {
        await openBot(`sealbot`);
        const listed = await shell(`/bots/SealBot`);
        expect(listed.status).toBe(200);
        expect(listed.meta.ogTitle).toBe(`sealbot - HeXO Arena`);
        expect(listed.meta.ogDescription).toBe(
            `HeXO bot by sealbotowner, rated 1500 (provisional), online and open for challenges. plays fast`,
        );
        expect((await shell(`/bots/nobody`)).status).toBe(404);
        expect((await shell(`/bots/-bad-`)).meta.title).toBe(`Not found - HeXO Arena`);
        arena.sqlite.prepare(`update bots set delisted_at = 1 where name = 'sealbot'`).run();
        expect((await shell(`/bots/sealbot`)).status).toBe(404);
    });

    it('previews a live guest game, then forgets it once the guest leaves', async () => {
        await openBot(`sealbot`);
        const minted = await arena.app.inject({ method: `POST`, url: guestPath });
        const guest = minted.cookies.find((cookie) => cookie.name === `hexo_arena_session`)?.value ?? ``;
        const created = await arena.app.inject({
            method: `POST`,
            url: gamesPath,
            cookies: { hexo_arena_session: guest },
            payload: { bot: `sealbot`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1 },
        });
        expect(created.statusCode).toBe(201);
        const snapshot = gameSnapshotSchema.parse(created.json());
        const live = await shell(`/game/${snapshot.gameId}`);
        expect(live.status).toBe(200);
        expect(live.meta.ogTitle).toMatch(/^(sealbot vs Guest [a-z0-9]{4}|Guest [a-z0-9]{4} vs sealbot) - HeXO Arena$/);
        expect(live.meta.ogDescription).toMatch(/^Live; (sealbot|Guest [a-z0-9]{4}) to move; turn clock 30 s$/);
        await arena.app.inject({ method: `POST`, url: logoutPath, cookies: { hexo_arena_session: guest } });
        expect((await shell(`/game/${snapshot.gameId}`)).status).toBe(404);
    });

    it('previews a stored bot-vs-bot result and answers 404 for an unknown game', async () => {
        await openBot(`alpha`);
        await openBot(`beta`);
        arena.sqlite
            .prepare(
                `insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                 select 'g_done', a.id, b.id, 'o', '{"mode":"unlimited"}', '[]', 'o', 'surrender', 1, 2, 1
                 from bots a, bots b where a.name = 'alpha' and b.name = 'beta'`,
            )
            .run();
        const done = await shell(`/game/g_done`);
        expect(done.meta.ogTitle).toBe(`beta vs alpha - HeXO Arena`);
        expect(done.meta.ogDescription).toBe(`alpha won; beta resigned`);
        expect((await shell(`/game/g_nothing`)).status).toBe(404);
    });
});

describe('without a web index', () => {
    it('leaves the shell routes unregistered', async () => {
        const arena = await createTestApp();
        expect((await arena.app.inject({ method: `GET`, url: `/` })).statusCode).toBe(404);
        expect((await arena.app.inject({ method: `GET`, url: `/ladder` })).statusCode).toBe(404);
        await arena.app.close();
    });
});
