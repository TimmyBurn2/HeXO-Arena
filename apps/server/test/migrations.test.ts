import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), `../src/db/migrations`);

// A copy of the migrations folder whose journal stops after `count`
// entries, so a test can seed rows the way an older deploy left them.
function migrationsUpTo(count: number): string {
    const folder = mkdtempSync(join(tmpdir(), `hexarena-migrations-`));
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, `meta/_journal.json`);
    const journal = JSON.parse(readFileSync(journalPath, `utf8`)) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, count);
    writeFileSync(journalPath, JSON.stringify(journal));
    return folder;
}

describe('the finish order migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('numbers earlier finishes by time and keeps the challenges that point at them', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(5);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at) values
                ('late', 'b1', 'b2', 'x', '{}', '[]', 'x', 'surrender', 1, 30),
                ('early', 'b1', 'b2', 'x', '{}', '[]', 'o', 'surrender', 2, 20),
                ('live', 'b1', 'b2', 'x', '{}', '[]', null, null, 3, null);
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_stones, first_player, status, game_id, created_at, decided_at)
                values ('c1', 'b1', 'b2', 'r1', '{}', 0, 'random', 'accepted', 'late', 1, 1);
        `);
        runMigrations(sqlite);
        const order = sqlite.prepare(`select id, finish_seq as seq from games order by id`).all();
        expect(order).toEqual([
            { id: `early`, seq: 1 },
            { id: `late`, seq: 2 },
            { id: `live`, seq: null },
        ]);
        expect(sqlite.prepare(`select id, game_id as gameId from challenges`).all()).toEqual([
            { id: `c1`, gameId: `late` },
        ]);
    });
});

describe('the moderation migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every earlier row and starts it unmoderated', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(6);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b1', 'b2', 'x', '{}', '[]', 'x', 'surrender', 1, 2, 1);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select deleted_at as deletedAt from users`).all()).toEqual([{ deletedAt: null }]);
        expect(sqlite.prepare(`select delisted_at as delistedAt, deleted_at as deletedAt from bots`).all()).toEqual([
            { delistedAt: null, deletedAt: null },
            { delistedAt: null, deletedAt: null },
        ]);
        expect(sqlite.prepare(`select id, voided_at as voidedAt from games`).all()).toEqual([{ id: `g1`, voidedAt: null }]);
        expect(sqlite.prepare(`select count(*) as n from site_state`).get()).toEqual({ n: 0 });
    });

});

describe('the opening turns migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('converts stored stone counts into turns and refuses a count past four', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(8);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_stones, first_player, status, created_at, decided_at)
                values ('c0', 'b1', 'b2', 'r0', '{}', 0, 'random', 'expired', 1, 2),
                       ('c6', 'b1', 'b2', 'r6', '{}', 6, 'random', 'expired', 1, 2);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, opening_turns as turns from challenges order by id`).all()).toEqual([
            { id: `c0`, turns: 0 },
            { id: `c6`, turns: 3 },
        ]);
        const insert = sqlite.prepare(`
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_turns, first_player, status, created_at, decided_at)
                values (?, 'b1', 'b2', ?, '{}', ?, 'random', 'expired', 1, 2)
        `);
        insert.run(`c4`, `r4`, 4);
        expect(() => insert.run(`c5`, `r5`, 5)).toThrow(/CHECK/);
    });
});

describe('the admin tables', () => {
    it('refuse an audit row without a reason or with an unknown action, and a second state row', () => {
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const insert = sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values (?, ?, null, ?, 1)`);
        expect(() => insert.run(`operator`, `pause`, ``)).toThrow(/CHECK/);
        expect(() => insert.run(`operator`, `reset-rating`, `abuse`)).toThrow(/CHECK/);
        insert.run(`operator`, `pause`, `incident`);
        expect(() => sqlite.prepare(`insert into site_state (id) values (2)`).run()).toThrow(/CHECK/);
        sqlite.close();
    });
});
