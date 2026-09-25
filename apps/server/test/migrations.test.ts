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
