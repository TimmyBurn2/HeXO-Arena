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
    const folder = mkdtempSync(join(tmpdir(), `hexo-arena-migrations-`));
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
        const throughTurns = migrationsUpTo(9);
        migrate(drizzle(sqlite), { migrationsFolder: throughTurns });
        rmSync(throughTurns, { recursive: true, force: true });
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

describe('the opening plies migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('converts stored turn counts into plies with the origin and refuses any other count', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(9);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_turns, first_player, status, created_at, decided_at)
                values ('c0', 'b1', 'b2', 'r0', '{}', 0, 'random', 'expired', 1, 2),
                       ('c1', 'b1', 'b2', 'r1', '{}', 1, 'challenger', 'expired', 1, 2),
                       ('c2', 'b1', 'b2', 'r2', '{}', 2, 'random', 'declined', 1, 2),
                       ('c3', 'b1', 'b2', 'r3', '{}', 3, 'random', 'canceled', 1, 2),
                       ('c4', 'b1', 'b2', 'r4', '{}', 4, 'challenged', 'expired', 1, 2);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, opening_plies as plies, first_player as first from challenges order by id`).all()).toEqual([
            { id: `c0`, plies: 1, first: `random` },
            { id: `c1`, plies: 3, first: `challenger` },
            { id: `c2`, plies: 5, first: `random` },
            { id: `c3`, plies: 7, first: `random` },
            { id: `c4`, plies: 9, first: `challenged` },
        ]);
        const insert = sqlite.prepare(`
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_plies, first_player, status, created_at, decided_at)
                values (?, 'b1', 'b2', ?, '{}', ?, 'random', 'expired', 1, 2)
        `);
        insert.run(`c5`, `r5`, 5);
        for (const plies of [0, 2, 4, 11]) {
            expect(() => insert.run(`bad${String(plies)}`, `bad${String(plies)}`, plies)).toThrow(/CHECK/);
        }
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

describe('the sign-up migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every session and state, sessions without Discord names and states returning to the root', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(10);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into sessions (id, token_hash, user_id, created_at, expires_at) values ('s1', 'h1', 'u1', 1, 99);
            insert into auth_states (state, nonce, expires_at) values ('st', 'nc', 99);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, discord_username as username, discord_display_name as display from sessions`).all()).toEqual([
            { id: `s1`, username: null, display: null },
        ]);
        expect(sqlite.prepare(`select state, next from auth_states`).all()).toEqual([{ state: `st`, next: `/` }]);
        expect(sqlite.prepare(`select count(*) as n from pending_signups`).get()).toEqual({ n: 0 });
    });
});

describe('the weekly rules migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every tournament without a rule and every audit row, and audits the rule ops', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(16);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at)
                values ('t_aaaaaaaaaaaa', 'Autumn', 'scheduled', 100, '{}', 5, 12, 1);
            insert into admin_actions (actor, action, target, reason, at) values ('operator', 'tournament-create', 'Autumn', 'weekly', 1);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, rule_id as ruleId from tournaments`).all()).toEqual([{ id: `t_aaaaaaaaaaaa`, ruleId: null }]);
        expect(sqlite.prepare(`select id, action, target from admin_actions`).all()).toEqual([{ id: 1, action: `tournament-create`, target: `Autumn` }]);
        const audit = sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values ('operator', ?, '1', 'weekly', 2)`);
        expect(() => audit.run(`tournament-schedule-add`)).not.toThrow();
        expect(() => audit.run(`tournament-schedule-remove`)).not.toThrow();
        expect(() => audit.run(`tournament-schedule-list`)).toThrow(/CHECK/);
    });
});

describe('the reports migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every audit row and its numbering, audits closing a report, and holds reports to their checks', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(17);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`insert into admin_actions (actor, action, target, reason, at) values ('operator', 'ban-user', 'ann', 'spam', 1);`);
        runMigrations(sqlite);
        const audit = sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values ('operator', ?, '1', 'done', 2)`);
        expect(audit.run(`report-close`).lastInsertRowid).toBe(2);
        expect(sqlite.prepare(`select id, action, target from admin_actions order by id`).all()).toEqual([
            { id: 1, action: `ban-user`, target: `ann` },
            { id: 2, action: `report-close`, target: `1` },
        ]);
        const report = sqlite.prepare(`insert into reports (subject, reason, details, good_faith, created_at) values (?, ?, ?, ?, 1)`);
        expect(() => report.run(`/bots/x`, `name`, `rude`, 1)).not.toThrow();
        expect(() => report.run(`https://elsewhere.example`, `name`, `rude`, 1)).toThrow(/CHECK/);
        expect(() => report.run(`/bots/x`, `spam`, `rude`, 1)).toThrow(/CHECK/);
        expect(() => report.run(`/bots/x`, `name`, ``, 1)).toThrow(/CHECK/);
        expect(() => report.run(`/bots/x`, `name`, `rude`, 0)).toThrow(/CHECK/);
        expect(() => sqlite.prepare(`update reports set status = 'closed'`).run()).toThrow(/CHECK/);
        expect(() => sqlite.prepare(`update reports set status = 'closed', closed_at = 2, note = 'cleared'`).run()).not.toThrow();
    });
});

describe('the guest games migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every game with its moves, ratings, and challenges, and holds a guest seat to its label alone', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(18);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, user_id, bot_id, user_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('human', 'u1', 'b1', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('bots', 'b1', 'b2', 'o', '{"mode":"unlimited"}', '[]', 'o', 'surrender', 3, 4, 2);
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('bots', 1, 'o', 1, 0, 2, 0, 3);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('bots', 'x', 1500, 1480, 300), ('bots', 'o', 1500, 1520, 300);
            insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_plies, first_player, status, game_id, created_at, decided_at)
                values ('c1', 'b1', 'b2', 'r1', '{}', 5, 'random', 'accepted', 'bots', 3, 3);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, guest_name as guest from games order by id`).all()).toEqual([
            { id: `bots`, guest: null },
            { id: `human`, guest: null },
        ]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select id, game_id as gameId from challenges`).all()).toEqual([{ id: `c1`, gameId: `bots` }]);
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
        const guest = sqlite.prepare(`insert into games (id, user_id, guest_name, bot_id, user_side, time_control, opening_cells, created_at) values (?, ?, ?, 'b1', 'o', '{}', '[]', 5)`);
        expect(() => guest.run(`g1`, null, `Guest k3f9`)).not.toThrow();
        expect(() => guest.run(`g2`, `u1`, `Guest k3f9`)).toThrow(/CHECK/);
        expect(() => guest.run(`g3`, null, `Guest K3F9`)).toThrow(/CHECK/);
        expect(() => guest.run(`g4`, null, `Guest k3f9 and more`)).toThrow(/CHECK/);
        expect(() => guest.run(`g5`, null, null)).toThrow(/CHECK/);
        const indexes = sqlite.prepare(`select name from sqlite_master where type = 'index' and tbl_name = 'games' and name like 'games_%' order by name`).all();
        expect(indexes).toHaveLength(14);
    });
});

describe('the bot levels migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every bot and game without a level, and holds a level to a bounded object on a bot seat', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(19);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, accepts)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1, '{"turnMs":null,"match":true,"unlimited":true}'), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1, null);
            insert into games (id, user_id, bot_id, user_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('human', 'u1', 'b1', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('human', 'x', 1000, 1100, 300), ('human', 'o', 1500, 1500, 500);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, levels from bots order by id`).all()).toEqual([
            { id: `b1`, levels: null },
            { id: `b2`, levels: null },
        ]);
        expect(sqlite.prepare(`select id, x_level as x, o_level as o from games`).all()).toEqual([{ id: `human`, x: null, o: null }]);
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const declare = sqlite.prepare(`update bots set levels = ? where id = 'b2'`);
        expect(() => declare.run(`{"default":"a","list":[]}`)).not.toThrow();
        expect(() => declare.run(`{"default":`)).toThrow(/CHECK/);
        expect(() => declare.run(`"a"`)).toThrow(/CHECK/);
        expect(() => declare.run(`{"x":"${`a`.repeat(16_384)}"}`)).toThrow(/CHECK/);

        const level = `{"id":"quick","label":"quick"}`;
        const game = sqlite.prepare(`insert into games (id, user_id, bot_id, user_side, x_level, o_level, time_control, opening_cells, created_at) values (?, 'u1', 'b1', ?, ?, ?, '{}', '[]', 5)`);
        expect(() => game.run(`g1`, `x`, null, level)).not.toThrow();
        expect(() => game.run(`g2`, `o`, level, null)).not.toThrow();
        expect(() => game.run(`g3`, `x`, level, null)).toThrow(/CHECK/);
        expect(() => game.run(`g4`, `o`, null, level)).toThrow(/CHECK/);
        expect(() => game.run(`g5`, `x`, null, `{"id":`)).toThrow(/CHECK/);
        expect(() => game.run(`g6`, `x`, null, `["quick"]`)).toThrow(/CHECK/);
        expect(() => game.run(`g7`, `x`, null, `{"note":"${`n`.repeat(1024)}"}`)).toThrow(/CHECK/);
    });
});
