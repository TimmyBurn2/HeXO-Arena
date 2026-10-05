import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQuery, openDatabase, type Sqlite } from '../src/db';
import { insertGame, recordFinish } from '../src/game-store';
import { findBot } from '../src/bots';
import { createTestApp, loginAs, mintBot, type TestApp } from './helpers';

const day = 86_400;

describe('the erasure journal', () => {
    let dir: string;
    let journal: string;
    const opened: { sqlite: Sqlite; world: TestApp }[] = [];

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), `hexo-arena-erasures-`));
        journal = join(dir, `erasures.jsonl`);
    });

    afterEach(async () => {
        for (const { sqlite, world } of opened.splice(0)) {
            await world.app.close();
            sqlite.close();
        }
        rmSync(dir, { recursive: true, force: true });
    });

    async function boot(file: string): Promise<TestApp> {
        const sqlite = openDatabase(join(dir, file));
        const world = await createTestApp({ sqlite, erasures: { path: journal, keepDays: 15 } });
        opened.push({ sqlite, world });
        return world;
    }

    function entries(): { userId: string; at: number }[] {
        return readFileSync(journal, `utf8`)
            .split(`\n`)
            .filter((line) => line !== ``)
            .map((line) => JSON.parse(line) as { userId: string; at: number });
    }

    // Ann owns alpha and plays bob's beta once, so a deletion keeps her row under a placeholder.
    async function seed(world: TestApp): Promise<string> {
        const ann = await loginAs(world.app, `ann`);
        await mintBot(world.app, ann, `alpha`);
        await mintBot(world.app, await loginAs(world.app, `bob`), `beta`);
        const query = createQuery(world.sqlite);
        const annId = (world.sqlite.prepare(`select id from users where name = 'ann'`).get() as { id: string }).id;
        const game = insertGame(query, { userId: annId, botId: findBot(query, `beta`)?.id ?? ``, userSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
        recordFinish(query, game, { winner: `x`, reason: `six-in-a-row` });
        expect(world.admin({ op: `ban-user`, name: `ann`, reason: `spam` })).toMatchObject({ kind: `done` });
        return annId;
    }

    it('takes one entry per deletion once it is committed, and none for a refused one', async () => {
        const world = await boot(`arena.sqlite`);
        const annId = await seed(world);
        const before = Math.floor(Date.now() / 1000);
        world.admin({ op: `delete-user`, name: `nobody`, reason: `typo` });
        world.admin({ op: `delete-user`, name: `ann`, reason: `asked` });
        expect(entries()).toEqual([{ userId: annId, at: expect.any(Number) as number }]);
        expect(entries()[0]?.at).toBeGreaterThanOrEqual(before);
    });

    it('deletes again at boot an account a restore brought back, audited by the restore, and leaves a deleted one alone', async () => {
        const world = await boot(`arena.sqlite`);
        const annId = await seed(world);
        world.sqlite.prepare(`vacuum into ?`).run(join(dir, `backup.sqlite`));
        world.admin({ op: `delete-user`, name: `ann`, reason: `asked` });

        const restored = await boot(`backup.sqlite`);
        const users = restored.sqlite.prepare(`select id, name, discord_id as discordId, deleted_at is not null as deleted from users order by name`).all();
        expect(users).toEqual([
            { id: expect.any(String) as string, name: `bob`, discordId: `dev:bob`, deleted: 0 },
            { id: annId, name: `deleted-1`, discordId: `deleted:deleted-1`, deleted: 1 },
        ]);
        expect(restored.sqlite.prepare(`select name from bots order by name`).all()).toEqual([{ name: `beta` }]);
        expect(restored.sqlite.prepare(`select actor, action, target, reason from admin_actions order by id`).all()).toEqual([
            { actor: `operator`, action: `ban-user`, target: `deleted-1`, reason: `spam` },
            { actor: `restore`, action: `delete-user`, target: `deleted-1`, reason: `applied again after a restore` },
        ]);
        expect(entries()).toHaveLength(1);

        const again = await boot(`backup.sqlite`);
        expect(again.sqlite.prepare(`select count(*) as n from admin_actions where actor = 'restore'`).get()).toEqual({ n: 1 });
    });

    it('drops entries older than its days at boot, and skips a line that is no entry', async () => {
        const now = Math.floor(Date.now() / 1000);
        writeFileSync(journal, [
            JSON.stringify({ userId: `u_old`, at: now - 16 * day }),
            `{"userId":`,
            JSON.stringify({ userId: `u_recent`, at: now - 14 * day }),
            ``,
        ].join(`\n`));
        await boot(`arena.sqlite`);
        expect(entries()).toEqual([{ userId: `u_recent`, at: now - 14 * day }]);
    });
});
