import { botAccountPath, gamesPath, gameSnapshotSchema, guestPath, logoutPath } from '@hexarena/contract';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arenaMeta, botMeta, gameMeta, renderShell } from '../src/og-shell';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const indexPath = join(dirname(fileURLToPath(import.meta.url)), `../../web/index.html`);

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
        const html = renderShell(readFileSync(indexPath, `utf8`), {
            title: `a <b> & "c"`,
            description: `it's <script>`,
        });
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
        expect(() => renderShell(template, { title: `t`, description: `d` })).toThrow(/og:title/);
    });
});

describe('shell meta wording', () => {
    it('counts the roster and names the leader when there is one', () => {
        expect(arenaMeta(0, 0, undefined).description).toBe(`0 bots listed, 0 online`);
        expect(arenaMeta(1, 1, { name: `sealbot`, rating: 1712.4 }).description).toBe(
            `1 bot listed, 1 online; top rated: sealbot (1712)`,
        );
    });

    it('describes a bot by owner, rating, presence, and an about excerpt', () => {
        const meta = botMeta({
            name: `sealbot`,
            ownerName: `alice`,
            rating: 1500,
            provisional: true,
            online: false,
            about: `x`.repeat(130),
        });
        expect(meta.title).toBe(`sealbot - hexarena`);
        expect(meta.description).toBe(`HeXO bot by alice, rated 1500, provisional, offline: ${`x`.repeat(120)}...`);
    });

    it('describes a live game by mover and clock, a finished one by its result', () => {
        const names = { x: `alpha`, o: `beta` };
        expect(
            gameMeta({ status: `live`, names, toMove: `o`, timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 } }),
        ).toEqual({ title: `alpha vs beta - hexarena`, description: `live, beta to move, 5 min + 3 s` });
        expect(gameMeta({ status: `finished`, names, winner: `x`, reason: `surrender` }).description).toBe(
            `alpha won by resignation`,
        );
        expect(gameMeta({ status: `finished`, names, winner: null, reason: `aborted` }).description).toBe(
            `nobody won, ended by abort`,
        );
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

    it('counts the roster on the arena route', async () => {
        await openBot(`sealbot`);
        const response = await shell(`/`);
        expect(response.status).toBe(200);
        expect(response.cacheControl).toBe(`no-cache`);
        expect(response.meta.ogTitle).toBe(`hexarena - bot arena for HeXO`);
        expect(response.meta.ogDescription).toBe(`1 bot listed, 1 online`);
    });

    it('describes a listed bot and answers 404 for an unknown or delisted one', async () => {
        await openBot(`sealbot`);
        const listed = await shell(`/bots/SealBot`);
        expect(listed.status).toBe(200);
        expect(listed.meta.ogTitle).toBe(`sealbot - hexarena`);
        expect(listed.meta.ogDescription).toBe(`HeXO bot by sealbotowner, rated 1500, provisional, online now: plays fast`);
        expect((await shell(`/bots/nobody`)).status).toBe(404);
        expect((await shell(`/bots/-bad-`)).meta.title).toBe(`not found - hexarena`);
        arena.sqlite.prepare(`update bots set delisted_at = 1 where name = 'sealbot'`).run();
        expect((await shell(`/bots/sealbot`)).status).toBe(404);
    });

    it('previews a live guest game, then forgets it once the guest leaves', async () => {
        await openBot(`sealbot`);
        const minted = await arena.app.inject({ method: `POST`, url: guestPath });
        const guest = minted.cookies.find((cookie) => cookie.name === `hexarena_session`)?.value ?? ``;
        const created = await arena.app.inject({
            method: `POST`,
            url: gamesPath,
            cookies: { hexarena_session: guest },
            payload: { bot: `sealbot`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingTurns: 0 },
        });
        expect(created.statusCode).toBe(201);
        const snapshot = gameSnapshotSchema.parse(created.json());
        const live = await shell(`/game/${snapshot.gameId}`);
        expect(live.status).toBe(200);
        expect(live.meta.ogTitle).toMatch(/^(sealbot vs Guest [a-z0-9]{4}|Guest [a-z0-9]{4} vs sealbot) - hexarena$/);
        expect(live.meta.ogDescription).toMatch(/^live, (sealbot|Guest [a-z0-9]{4}) to move, 30 s per turn$/);
        await arena.app.inject({ method: `POST`, url: logoutPath, cookies: { hexarena_session: guest } });
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
        expect(done.meta.ogTitle).toBe(`beta vs alpha - hexarena`);
        expect(done.meta.ogDescription).toBe(`alpha won by resignation`);
        expect((await shell(`/game/g_nothing`)).status).toBe(404);
    });
});

describe('without a web index', () => {
    it('leaves the shell routes unregistered', async () => {
        const arena = await createTestApp();
        expect((await arena.app.inject({ method: `GET`, url: `/` })).statusCode).toBe(404);
        await arena.app.close();
    });
});
