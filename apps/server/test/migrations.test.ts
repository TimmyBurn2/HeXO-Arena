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
        expect(indexes).toHaveLength(19);
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

describe('the analyzers migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every bot, user, game, and move, opted in and undeclared, and holds readings to their checks', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(20);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, user_id, bot_id, user_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('human', 'u1', 'b1', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('human', 1, 'o', 1, 0, 2, 0, 1);
            insert into admin_actions (actor, action, target, reason, at) values ('operator', 'pause', null, 'maintenance', 1);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, analyzer_max_seconds as s, analyzer_lines as l, analyzer_while_playing as w from bots order by id`).all()).toEqual([
            { id: `b1`, s: null, l: null, w: null },
            { id: `b2`, s: null, l: null, w: null },
        ]);
        expect(sqlite.prepare(`select analysis_opt_out as out from users`).all()).toEqual([{ out: 0 }]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 1 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const declare = sqlite.prepare(`update bots set analyzer_max_seconds = ?, analyzer_lines = ?, analyzer_while_playing = ? where id = 'b2'`);
        expect(() => declare.run(2, 3, 0)).not.toThrow();
        expect(() => declare.run(null, null, null)).not.toThrow();
        for (const values of [[11, 3, 0], [2, 4, 0], [2, 3, 2], [2, null, 0], [null, null, 1]]) {
            expect(() => declare.run(...values), JSON.stringify(values)).toThrow(/CHECK/);
        }
        expect(() => sqlite.prepare(`update users set analysis_opt_out = 2`).run()).toThrow(/CHECK/);

        const own = sqlite.prepare(`insert into own_lines (game_id, seq, rank, first_x, first_y, second_x, second_y, heuristic, win_in) values ('human', ?, ?, 1, 1, 2, 2, ?, ?)`);
        expect(() => own.run(1, 0, 0.5, null)).not.toThrow();
        expect(() => own.run(1, 1, null, -3)).not.toThrow();
        expect(() => own.run(1, 3, 0.5, null)).toThrow(/CHECK/);
        expect(() => own.run(1, 2, null, null)).toThrow(/CHECK/);
        expect(() => own.run(1, 2, null, 0)).toThrow(/CHECK/);
        expect(() => own.run(2, 0, 0.5, null)).toThrow(/FOREIGN KEY/);

        const reading = sqlite.prepare(`insert into analyses (id, game_id, analyzer_bot_id, requested_by, status, failure, failed_turn, seconds, created_at, finished_at) values (?, 'human', ?, 'u1', ?, ?, ?, 2, 1, ?)`);
        expect(() => reading.run(`a1`, null, `queued`, null, null, null)).not.toThrow();
        expect(() => reading.run(`a2`, `b2`, `done`, null, null, 5)).not.toThrow();
        expect(() => reading.run(`a3`, null, `failed`, `expired`, null, 5)).not.toThrow();
        expect(() => reading.run(`a4`, `b2`, `failed`, `timeout`, 3, 5)).not.toThrow();
        expect(() => reading.run(`a5`, `b2`, `done`, null, null, 6)).toThrow(/UNIQUE/);
        for (const [id, bot, status, failure, turn, finished] of [
            [`b1`, `b2`, `queued`, null, null, null],
            [`b2`, null, `running`, null, null, null],
            [`b3`, `b1`, `failed`, null, null, 5],
            [`b4`, `b1`, `failed`, `lazy`, null, 5],
            [`b5`, `b1`, `done`, null, 2, 5],
            [`b6`, `b1`, `done`, null, null, null],
        ] as const) {
            expect(() => reading.run(id, bot, status, failure, turn, finished), id).toThrow(/CHECK/);
        }
        sqlite.prepare(`insert into analysis_lines (analysis_id, turn, rank, first_x, first_y, second_x, second_y, heuristic) values ('a2', 1, 0, 1, 1, 2, 2, 0.1)`).run();
        sqlite.prepare(`delete from analyses where id = 'a2'`).run();
        expect(sqlite.prepare(`select count(*) as n from analysis_lines`).get()).toEqual({ n: 0 });
        sqlite.prepare(`delete from users where id = 'u1'`).run();
        expect(sqlite.prepare(`select count(*) as n from analyses`).get()).toEqual({ n: 0 });

        expect(sqlite.prepare(`select action from admin_actions`).all()).toEqual([{ action: `pause` }]);
        expect(() => sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values ('operator', 'delete-analysis', 'a1', 'lied', 2)`).run()).not.toThrow();
    });
});

describe('the unrated by choice migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every game and its ratings as they were, and holds the mark to a signed-in person\'s game at the bot\'s default level', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(21);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, user_id, bot_id, user_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('human', 'u1', 'b1', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('human', 'x', 1000, 1100, 300), ('human', 'o', 1500, 1500, 500);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, unrated_by_choice as unrated from games`).all()).toEqual([{ id: `human`, unrated: 0 }]);
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const level = `{"id":"quick","label":"quick"}`;
        const human = sqlite.prepare(`insert into games (id, user_id, bot_id, user_side, o_level, unrated_by_choice, time_control, opening_cells, created_at) values (?, 'u1', 'b1', 'x', ?, ?, '{}', '[]', 5)`);
        expect(() => human.run(`g1`, null, 1)).not.toThrow();
        expect(() => human.run(`g2`, null, 0)).not.toThrow();
        expect(() => human.run(`g3`, level, 1)).toThrow(/CHECK/);
        expect(() => human.run(`g4`, null, 2)).toThrow(/CHECK/);
        const guest = sqlite.prepare(`insert into games (id, guest_name, bot_id, user_side, unrated_by_choice, time_control, opening_cells, created_at) values (?, 'Guest k3f9', 'b1', 'o', ?, '{}', '[]', 5)`);
        expect(() => guest.run(`g5`, 0)).not.toThrow();
        expect(() => guest.run(`g6`, 1)).toThrow(/CHECK/);
        const bots = sqlite.prepare(`insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, x_level, unrated_by_choice, time_control, opening_cells, created_at) values (?, 'b1', 'b2', 'x', ?, ?, '{}', '[]', 5)`);
        expect(() => bots.run(`g7`, null, 0)).not.toThrow();
        expect(() => bots.run(`g8`, level, 1)).toThrow(/CHECK/);
    });
});

describe('the analyzer values migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every bot, reading, and own line as declaring no values, and holds values to a scale and a meaning together, and rising cuts, beside what declared them', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(22);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, analyzer_max_seconds, analyzer_lines, analyzer_while_playing)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1, null, null, null), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1, 2, 3, 0);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b1', 'b2', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('g1', 1, 'o', 1, 0, 2, 0, 1);
            insert into own_lines (game_id, seq, rank, first_x, first_y, second_x, second_y, heuristic) values ('g1', 1, 0, 1, 0, 2, 0, 0.3);
            insert into analyses (id, game_id, analyzer_bot_id, analyzer_version, status, seconds, created_at, started_at, finished_at) values ('a1', 'g1', 'b2', '0.9', 'done', 2, 1, 1, 2);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, analyzer_scale as scale, analyzer_cut_inaccuracy as i, analyzer_cut_mistake as m, analyzer_cut_blunder as b, analyzer_meaning as meaning from bots order by id`).all()).toEqual([
            { id: `b1`, scale: null, i: null, m: null, b: null, meaning: null },
            { id: `b2`, scale: null, i: null, m: null, b: null, meaning: null },
        ]);
        expect(sqlite.prepare(`select id, analyzer_bot_id as bot, analyzer_scale as scale, analyzer_cut_blunder as b, analyzer_meaning as meaning from analyses`).all()).toEqual([
            { id: `a1`, bot: `b2`, scale: null, b: null, meaning: null },
        ]);
        expect(sqlite.prepare(`select count(*) as n from own_lines`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`select count(*) as n from own_values`).get()).toEqual({ n: 0 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const declare = sqlite.prepare(`update bots set analyzer_scale = ?, analyzer_cut_inaccuracy = ?, analyzer_cut_mistake = ?, analyzer_cut_blunder = ?, analyzer_meaning = ? where id = ?`);
        expect(() => declare.run(1000, null, null, null, `raw`, `b2`)).not.toThrow();
        expect(() => declare.run(1, 0.1, 0.2, 0.3, `expected`, `b2`)).not.toThrow();
        expect(() => declare.run(null, null, null, null, null, `b2`)).not.toThrow();
        for (const values of [
            [1, null, null, null, `raw`, `b1`],
            [0, null, null, null, `raw`, `b2`],
            [2_000_000, null, null, null, `raw`, `b2`],
            [null, 0.1, 0.2, 0.3, null, `b2`],
            [1, 0.1, null, 0.3, `raw`, `b2`],
            [1, 0.2, 0.2, 0.3, `raw`, `b2`],
            [1, 0, 0.2, 0.3, `raw`, `b2`],
            [1, 0.1, 0.2, 2.5, `raw`, `b2`],
            [1, null, null, null, null, `b2`],
            [null, null, null, null, `raw`, `b2`],
            [1, null, null, null, `winning`, `b2`],
        ] as const) {
            expect(() => declare.run(...values), JSON.stringify(values)).toThrow(/CHECK/);
        }

        const snapshot = sqlite.prepare(`update analyses set analyzer_bot_id = ?, status = ?, analyzer_scale = ?, analyzer_cut_inaccuracy = ?, analyzer_cut_mistake = ?, analyzer_cut_blunder = ?, analyzer_meaning = ?, finished_at = ? where id = 'a1'`);
        expect(() => snapshot.run(`b2`, `done`, 1000, 0.1, 0.2, 0.3, `expected`, 2)).not.toThrow();
        expect(() => snapshot.run(null, `queued`, 1, null, null, null, `raw`, null)).toThrow(/CHECK/);
        expect(() => snapshot.run(`b2`, `done`, 1, 0.3, 0.2, 0.1, `raw`, 2)).toThrow(/CHECK/);
        expect(() => snapshot.run(`b2`, `done`, 1, null, null, null, null, 2)).toThrow(/CHECK/);

        const own = sqlite.prepare(`insert into own_values (game_id, side, scale, cut_inaccuracy, cut_mistake, cut_blunder, meaning) values (?, ?, ?, ?, ?, ?, ?)`);
        expect(() => own.run(`g1`, `o`, null, null, null, null, null)).not.toThrow();
        expect(() => own.run(`g1`, `x`, 1000, 0.1, 0.2, 0.3, `expected`)).not.toThrow();
        expect(() => own.run(`g1`, `x`, 1, null, null, null, `raw`)).toThrow(/UNIQUE|PRIMARY/);
        expect(() => own.run(`g1`, `z`, null, null, null, null, null)).toThrow(/CHECK/);
        expect(() => own.run(`gone`, `o`, null, null, null, null, null)).toThrow(/FOREIGN KEY/);
        sqlite.prepare(`delete from own_values`).run();
        expect(() => own.run(`g1`, `x`, 1, null, null, null, `calibrated`)).toThrow(/CHECK/);
        expect(() => own.run(`g1`, `x`, null, null, null, null, `raw`)).toThrow(/CHECK/);
        own.run(`g1`, `o`, null, null, null, null, null);
        sqlite.prepare(`delete from games where id = 'g1'`).run();
        expect(sqlite.prepare(`select count(*) as n from own_values`).get()).toEqual({ n: 0 });
    });
});

describe('the involved analyzers migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every reading and its lines as read by an analyzer whose owner sat in neither seat, and holds the mark to a reading an analyzer took', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(23);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('reader'), ('alpha'), ('beta'), ('gamma');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1), ('u2', 'd2', 'reader', 'reader', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, analyzer_max_seconds, analyzer_lines, analyzer_while_playing)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1, null, null, null), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1, null, null, null),
                    ('b3', 'u2', 'gamma', 'gamma', 'h3', 'bot:play', 1, 2, 3, 0);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b1', 'b2', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
            insert into analyses (id, game_id, analyzer_bot_id, analyzer_version, status, seconds, created_at, started_at, finished_at)
                values ('a1', 'g1', 'b3', '0.9', 'done', 2, 1, 1, 2), ('a2', 'g1', null, null, 'queued', 2, 3, null, null);
            insert into analysis_lines (analysis_id, turn, rank, first_x, first_y, second_x, second_y, heuristic) values ('a1', 1, 0, 1, 0, 2, 0, 0.3);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, analyzer_bot_id as bot, status, involved from analyses order by id`).all()).toEqual([
            { id: `a1`, bot: `b3`, status: `done`, involved: 0 },
            { id: `a2`, bot: null, status: `queued`, involved: 0 },
        ]);
        expect(sqlite.prepare(`select count(*) as n from analysis_lines`).get()).toEqual({ n: 1 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const mark = sqlite.prepare(`update analyses set involved = ? where id = ?`);
        expect(() => mark.run(1, `a1`)).not.toThrow();
        expect(() => mark.run(1, `a2`)).toThrow(/CHECK/);
        expect(() => mark.run(2, `a1`)).toThrow(/CHECK/);
        expect(() => mark.run(null, `a1`)).toThrow(/NOT NULL/);
    });
});

describe('the series migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every game, its unrated mark, moves, and ratings, and turns every bot\'s switch for duels by others on', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(24);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, user_id, bot_id, user_side, unrated_by_choice, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('chosen', 'u1', 'b1', 'x', 1, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1),
                       ('rated', 'u1', 'b1', 'o', 0, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 3, 2);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('rated', 'x', 1000, 1100, 300), ('rated', 'o', 1500, 1500, 500);
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('chosen', 1, 'o', 1, 0, 0, 1, 2);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, unrated_by_choice as unrated, duel_id as duel from games order by id`).all()).toEqual([
            { id: `chosen`, unrated: 1, duel: null },
            { id: `rated`, unrated: 0, duel: null },
        ]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select distinct duels_by_others as on_ from bots`).all()).toEqual([{ on_: 1 }]);
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
        expect(() => sqlite.prepare(`update bots set duels_by_others = 2 where id = 'b1'`).run()).toThrow(/CHECK/);
    });
});

describe('the duels migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    const turn = `{"mode":"turn","turnTimeMs":10000}`;

    // As the dev stack left it: a series between two owners' bots with its games, one between one owner's bots,
    // a game of a person against their own bot, one played rated before, an owner's switch off, and the operator's stop.
    function seedSeries(): void {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(27);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('ann'), ('bob'), ('alpha'), ('aster'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'ann', 'ann', 1), ('u2', 'd2', 'bob', 'bob', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, series_by_others)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1, 1), ('b2', 'u1', 'aster', 'aster', 'h2', 'bot:play', 1, 0), ('b3', 'u2', 'beta', 'beta', 'h3', 'bot:play', 1, 1);
            insert into series (id, started_by, bot_a_id, bot_b_id, a_first, a_x, games, time_control, opening_plies, a_rating, b_rating, rated, status, end_reason, end_bot, created_at, ended_at)
                values ('s_abcdefghjkmn', 'u2', 'b1', 'b3', 1, 0, 2, '${turn}', 5, 1500, 1500, 1, 'finished', null, null, 10, 20),
                       ('s_npqrstuvwxyz', 'u1', 'b1', 'b2', 0, 1, 4, '${turn}', 5, 1500, 1480, 0, 'stopped', 'operator', null, 30, 40);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, unrated_by_choice, series_id, series_game, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b3', 'b1', 'x', 0, 's_abcdefghjkmn', 1, '${turn}', '[]', 'x', 'surrender', 10, 11, 1),
                       ('g2', 'b1', 'b3', 'x', 0, 's_abcdefghjkmn', 2, '${turn}', '[]', 'o', 'surrender', 12, 13, 2),
                       ('g3', 'b2', 'b1', 'x', 1, 's_npqrstuvwxyz', 1, '${turn}', '[]', 'x', 'surrender', 30, 31, 3),
                       ('rated', 'b1', 'b2', 'x', 0, null, null, '${turn}', '[]', 'x', 'surrender', 1, 2, 4);
            insert into games (id, user_id, bot_id, user_side, unrated_by_choice, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('own', 'u1', 'b1', 'x', 1, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 5, 6, 5),
                       ('chosen', 'u2', 'b1', 'x', 1, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 5, 7, 6);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('g1', 'x', 1500, 1510, 300), ('g1', 'o', 1500, 1490, 300);
            insert into admin_actions (actor, action, target, reason, at) values ('operator', 'series-stop', 's_npqrstuvwxyz', 'farming', 40), ('operator', 'pause', null, 'deploy', 41);
        `);
        runMigrations(sqlite);
    }

    const insertDuel = (id: string, status: string, extra: Record<string, unknown> = {}) => {
        const row = {
            id,
            started_by: `u1`,
            bot_a_id: `b1`,
            bot_b_id: `b3`,
            a_first: 1,
            a_x: 0,
            test: 0,
            games: 2,
            time_control: turn,
            opening_plies: 5,
            a_level: null,
            b_level: null,
            a_rating: 1500,
            b_rating: 1500,
            a_version: null,
            b_version: null,
            rated: 0,
            status,
            end_reason: null,
            end_bot: null,
            created_at: 10,
            ended_at: status === `running` ? null : 20,
            ...extra,
        };
        const columns = Object.keys(row);
        return sqlite.prepare(`insert into duels (${columns.join(`, `)}) values (${columns.map((column) => `@${column}`).join(`, `)})`).run(row).changes;
    };

    it('keeps every series as a duel under a new id, a test where one person owns both bots, and its games pointing at it', () => {
        seedSeries();
        expect(sqlite.prepare(`select id, test, games, rated, status, end_reason as reason, a_version as aVersion, b_version as bVersion from duels order by created_at`).all()).toEqual([
            { id: `d_abcdefghjkmn`, test: 0, games: 2, rated: 1, status: `finished`, reason: null, aVersion: null, bVersion: null },
            { id: `d_npqrstuvwxyz`, test: 1, games: 4, rated: 0, status: `stopped`, reason: `operator`, aVersion: null, bVersion: null },
        ]);
        expect(sqlite.prepare(`select id, duel_id as duel, duel_game as game, unrated_by_choice as unrated, test from games order by id`).all()).toEqual([
            { id: `chosen`, duel: null, game: null, unrated: 1, test: 0 },
            { id: `g1`, duel: `d_abcdefghjkmn`, game: 1, unrated: 0, test: 0 },
            { id: `g2`, duel: `d_abcdefghjkmn`, game: 2, unrated: 0, test: 0 },
            { id: `g3`, duel: `d_npqrstuvwxyz`, game: 1, unrated: 1, test: 1 },
            { id: `own`, duel: null, game: null, unrated: 1, test: 1 },
            { id: `rated`, duel: null, game: null, unrated: 0, test: 0 },
        ]);
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select id, duels_by_others as on_ from bots order by id`).all()).toEqual([
            { id: `b1`, on_: 1 },
            { id: `b2`, on_: 0 },
            { id: `b3`, on_: 1 },
        ]);
        expect(sqlite.prepare(`select action, target from admin_actions order by id`).all()).toEqual([
            { action: `duel-stop`, target: `d_npqrstuvwxyz` },
            { action: `pause`, target: null },
        ]);
        expect(sqlite.prepare(`select count(*) as n from sqlite_master where name = 'series'`).get()).toEqual({ n: 0 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
        expect(() => sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values ('operator', 'series-stop', 'x', 'r', 1)`).run()).toThrow(/CHECK/);
    });

    it('holds a pair to one running duel in one stored order, and a duel to its lengths, openings, and endings', () => {
        seedSeries();
        insertDuel(`d1`, `running`);
        expect(() => insertDuel(`d2`, `running`)).toThrow(/UNIQUE/);
        expect(() => insertDuel(`d3`, `finished`)).not.toThrow();
        expect(() => insertDuel(`d4`, `running`, { bot_a_id: `b3`, bot_b_id: `b1` })).toThrow(/CHECK/);
        expect(() => insertDuel(`d5`, `finished`, { games: 3 })).toThrow(/CHECK/);
        expect(() => insertDuel(`d6`, `finished`, { opening_plies: 1, games: 4 })).toThrow(/CHECK/);
        expect(() => insertDuel(`d7`, `finished`, { opening_plies: 1, games: 2 })).not.toThrow();
        expect(() => insertDuel(`d8`, `cut_short`, { end_reason: `offline`, end_bot: `a` })).not.toThrow();
        expect(() => insertDuel(`d9`, `cut_short`)).toThrow(/CHECK/);
        expect(() => insertDuel(`d10`, `stopped`, { end_reason: `offline` })).toThrow(/CHECK/);
        expect(() => insertDuel(`d11`, `stopped`, { end_reason: `owner`, end_bot: `b` })).not.toThrow();
        expect(() => insertDuel(`d12`, `finished`, { end_bot: `a` })).toThrow(/CHECK/);
        expect(() => insertDuel(`d13`, `finished`, { ended_at: null })).toThrow(/CHECK/);
        expect(() => insertDuel(`d14`, `finished`, { rated: 1, a_level: `{"id":"easy","label":"easy"}` })).toThrow(/CHECK/);
        expect(() => insertDuel(`d15`, `finished`, { rated: 0, a_level: `{"id":"easy","label":"easy"}` })).not.toThrow();
        expect(() => insertDuel(`d16`, `finished`, { a_version: `0.3.1`, b_version: `x`.repeat(64) })).not.toThrow();
        expect(() => insertDuel(`d17`, `finished`, { a_version: `` })).toThrow(/CHECK/);
        expect(() => insertDuel(`d18`, `finished`, { b_version: `x`.repeat(65) })).toThrow(/CHECK/);
    });

    it('lets only a test play more than ten games, and never rated', () => {
        seedSeries();
        expect(() => insertDuel(`d1`, `finished`, { games: 20 })).toThrow(/CHECK/);
        for (const games of [20, 30, 50]) expect(() => insertDuel(`t${String(games)}`, `finished`, { test: 1, games })).not.toThrow();
        expect(() => insertDuel(`d2`, `finished`, { test: 1, games: 40 })).toThrow(/CHECK/);
        expect(() => insertDuel(`d3`, `finished`, { test: 1, rated: 1 })).toThrow(/CHECK/);
        expect(() => insertDuel(`d4`, `finished`, { test: 2 })).toThrow(/CHECK/);
    });

    it('lets a duel game be a bot game alone, numbered within its duel, and marks unrated games of a duel', () => {
        seedSeries();
        insertDuel(`d1`, `running`, { test: 1, games: 50 });
        const game = sqlite.prepare(
            `insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, unrated_by_choice, x_level, duel_id, duel_game, time_control, opening_cells, created_at) values (?, 'b1', 'b3', 'x', ?, ?, ?, ?, '{}', '[]', 5)`,
        );
        expect(() => game.run(`x1`, 1, null, `d1`, 1)).not.toThrow();
        expect(() => game.run(`x2`, 1, `{"id":"easy","label":"easy"}`, `d1`, 50)).not.toThrow();
        expect(() => game.run(`x3`, 1, `{"id":"easy","label":"easy"}`, null, null)).toThrow(/CHECK/);
        expect(() => game.run(`x4`, 0, null, `d1`, null)).toThrow(/CHECK/);
        expect(() => game.run(`x5`, 0, null, `d1`, 51)).toThrow(/CHECK/);
        expect(() => game.run(`x6`, 0, null, `nowhere`, 1)).toThrow(/FOREIGN KEY/);
        const human = sqlite.prepare(`insert into games (id, user_id, bot_id, user_side, duel_id, duel_game, time_control, opening_cells, created_at) values (?, 'u1', 'b1', 'x', 'd1', 1, '{}', '[]', 5)`);
        expect(() => human.run(`x7`)).toThrow(/CHECK/);
        sqlite.prepare(`delete from bots where id = 'b3'`).run();
        expect(sqlite.prepare(`select count(*) as n from duels where id = 'd1'`).get()).toEqual({ n: 0 });
        expect(sqlite.prepare(`select count(*) as n from games where duel_id = 'd1'`).get()).toEqual({ n: 0 });
    });

    it('marks a test only on an unrated game or one at another level, never a guest\'s or a tournament\'s', () => {
        seedSeries();
        const human = sqlite.prepare(`insert into games (id, user_id, bot_id, user_side, unrated_by_choice, o_level, test, time_control, opening_cells, created_at) values (?, 'u1', 'b1', 'x', ?, ?, 1, '{}', '[]', 5)`);
        expect(() => human.run(`t1`, 1, null)).not.toThrow();
        expect(() => human.run(`t2`, 0, `{"id":"easy","label":"easy"}`)).not.toThrow();
        expect(() => human.run(`t3`, 0, null)).toThrow(/CHECK/);
        const guest = sqlite.prepare(`insert into games (id, guest_name, bot_id, user_side, test, time_control, opening_cells, created_at) values (?, 'Guest k3f9', 'b1', 'o', 1, '{}', '[]', 5)`);
        expect(() => guest.run(`t4`)).toThrow(/CHECK/);
        expect(() => sqlite.prepare(`update games set test = 2 where id = 't1'`).run()).toThrow(/CHECK/);
    });

    it('keeps a duel when its starter goes, naming nobody', () => {
        seedSeries();
        sqlite.exec(`insert into name_reservations (name_key) values ('starter'); insert into users (id, discord_id, name, name_key, created_at) values ('u3', 'd3', 'starter', 'starter', 1)`);
        insertDuel(`d1`, `finished`, { started_by: `u3` });
        sqlite.prepare(`delete from users where id = 'u3'`).run();
        expect(sqlite.prepare(`select id, started_by as startedBy from duels where id = 'd1'`).all()).toEqual([{ id: `d1`, startedBy: null }]);
    });
});

describe('the own bot games migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    it('keeps every game and its unrated mark, and admits the mark on a challenge\'s game between two bots at their defaults', () => {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(25);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1);
            insert into games (id, user_id, bot_id, user_side, unrated_by_choice, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('chosen', 'u1', 'b1', 'x', 1, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1),
                       ('rated', 'u1', 'b1', 'o', 0, '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 3, 2);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('rated', 'x', 1000, 1100, 300), ('rated', 'o', 1500, 1500, 500);
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('chosen', 1, 'o', 1, 0, 0, 1, 2);
        `);
        runMigrations(sqlite);
        expect(sqlite.prepare(`select id, unrated_by_choice as unrated from games order by id`).all()).toEqual([
            { id: `chosen`, unrated: 1 },
            { id: `rated`, unrated: 0 },
        ]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 1 });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);

        const level = `{"id":"easy","label":"easy"}`;
        const bots = sqlite.prepare(`insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, x_level, unrated_by_choice, time_control, opening_cells, created_at) values (?, 'b1', 'b2', 'x', ?, ?, '{}', '[]', 5)`);
        expect(() => bots.run(`g1`, null, 1)).not.toThrow();
        expect(() => bots.run(`g2`, level, 1)).toThrow(/CHECK/);
        expect(() => bots.run(`g3`, null, 2)).toThrow(/CHECK/);
        const guest = sqlite.prepare(`insert into games (id, guest_name, bot_id, user_side, unrated_by_choice, time_control, opening_cells, created_at) values (?, 'Guest k3f9', 'b1', 'o', ?, '{}', '[]', 5)`);
        expect(() => guest.run(`g4`, 1)).toThrow(/CHECK/);
    });
});

describe('the owner text and bot clients migrations', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    function seed(): void {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(26);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('owner'), ('alpha'), ('beta');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'owner', 'owner', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, about, repo_url)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1, 'Declared', 'https://example.org'), ('b2', 'u1', 'beta', 'beta', 'h2', 'bot:play', 1, null, null);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('played', 'b1', 'b2', 'x', '{"mode":"unlimited"}', '[]', 'x', 'surrender', 1, 2, 1);
        `);
        runMigrations(sqlite);
    }

    it('keeps every bot as it declared, with no text of its owner\'s and no client seen', () => {
        seed();
        expect(sqlite.prepare(`select id, about, repo_url as repo, owner_about as ownerAbout, owner_repo_url as ownerRepo, client_kind as kind, client_version as version, client_at as at from bots order by id`).all()).toEqual([
            { id: `b1`, about: `Declared`, repo: `https://example.org`, ownerAbout: null, ownerRepo: null, kind: null, version: null, at: null },
            { id: `b2`, about: null, repo: null, ownerAbout: null, ownerRepo: null, kind: null, version: null, at: null },
        ]);
        expect(sqlite.prepare(`select count(*) as n from games`).get()).toEqual({ n: 1 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
    });

    it('holds the owner\'s text to its cap, and the link to http or https within its cap', () => {
        seed();
        const set = (column: string, value: string) => sqlite.prepare(`update bots set ${column} = ? where id = 'b1'`).run(value);
        expect(() => set(`owner_about`, `x`.repeat(280))).not.toThrow();
        expect(() => set(`owner_about`, `x`.repeat(281))).toThrow(/CHECK/);
        expect(() => set(`owner_about`, ``)).toThrow(/CHECK/);
        expect(() => set(`owner_repo_url`, `HTTPS://example.org`)).not.toThrow();
        expect(() => set(`owner_repo_url`, `http://example.org`)).not.toThrow();
        expect(() => set(`owner_repo_url`, `javascript:alert(1)`)).toThrow(/CHECK/);
        expect(() => set(`owner_repo_url`, `https://${`x`.repeat(2041)}`)).toThrow(/CHECK/);
    });

    it('holds a client to hexo-bridge with a release of three numbers, or other with none, and a time beside either', () => {
        seed();
        const client = (kind: string | null, version: string | null, at: number | null) =>
            sqlite.prepare(`update bots set client_kind = ?, client_version = ?, client_at = ? where id = 'b1'`).run(kind, version, at);
        expect(() => client(`hexo-bridge`, `0.3.0`, 5)).not.toThrow();
        expect(() => client(`hexo-bridge`, `12.40.1000`, 5)).not.toThrow();
        expect(() => client(`other`, null, 5)).not.toThrow();
        expect(() => client(null, null, null)).not.toThrow();
        for (const [kind, version, at] of [
            [`hexo-bridge`, null, 5],
            [`other`, `0.3.0`, 5],
            [`other`, null, null],
            [null, null, 5],
            [`firefox`, null, 5],
            [`hexo-bridge`, `0.3`, 5],
            [`hexo-bridge`, `0.3.0.1`, 5],
            [`hexo-bridge`, `0..3`, 5],
            [`hexo-bridge`, `0.3.0rc1`, 5],
            [`hexo-bridge`, `0.3.`, 5],
            [`hexo-bridge`, `.0.3`, 5],
        ] as const) {
            expect(() => client(kind, version, at), `${String(kind)} ${String(version)} ${String(at)}`).toThrow(/CHECK/);
        }
    });
});

describe('the round robins migration', () => {
    let sqlite: Sqlite;
    let folder: string;
    let through: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
        rmSync(through, { recursive: true, force: true });
    });

    const turn = `{"mode":"turn","turnTimeMs":10000}`;

    // As a deploy left it: a finished weekly with its entries, a pairing, and its two rated games with moves and
    // ratings; a waiting weekly with an entry; a duel game and a challenge's game beside them.
    function seed(): void {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(30);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('ann'), ('bob'), ('cid'), ('alpha'), ('beta'), ('gamma'), ('aster');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'ann', 'ann', 1), ('u2', 'd2', 'bob', 'bob', 1), ('u3', 'd3', 'cid', 'cid', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u2', 'beta', 'beta', 'h2', 'bot:play', 1),
                       ('b3', 'u3', 'gamma', 'gamma', 'h3', 'bot:play', 1), ('b4', 'u1', 'aster', 'aster', 'h4', 'bot:play', 1);
            insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at, started_at, ended_at)
                values ('t_aaaaaaaaaaaa', 'Autumn', 'finished', 100, '${turn}', 5, 12, 1, 100, 200),
                       ('t_bbbbbbbbbbbb', 'Winter', 'scheduled', 900, '${turn}', 5, 12, 1, null, null);
            insert into tournament_entries (tournament_id, bot_id, owner_id, state, reason, rating_at_start, entered_at)
                values ('t_aaaaaaaaaaaa', 'b1', 'u1', 'playing', null, 1500, 1), ('t_aaaaaaaaaaaa', 'b2', 'u2', 'playing', null, 1480, 2),
                       ('t_aaaaaaaaaaaa', 'b3', 'u3', 'withdrawn', 'missed', 1450, 3), ('t_bbbbbbbbbbbb', 'b1', 'u1', 'entered', null, null, 4);
            insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, opening_cells, game1, game1_seat, game2, game2_seat)
                values ('p1', 't_aaaaaaaaaaaa', 1, 'b1', 'b2', '[]', 'played', 'first', 'played', 'second');
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, pairing_id, pairing_game, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b1', 'b2', 'x', 'p1', 1, '${turn}', '[]', 'x', 'surrender', 100, 110, 1),
                       ('g2', 'b2', 'b1', 'x', 'p1', 2, '${turn}', '[]', 'x', 'surrender', 110, 120, 2),
                       ('plain', 'b1', 'b4', 'x', null, null, '${turn}', '[]', 'o', 'surrender', 1, 2, 3);
            update games set unrated_by_choice = 1, test = 1 where id = 'plain';
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('g1', 1, 'o', 1, 0, 0, 1, 101), ('g2', 1, 'o', 1, 0, 0, 1, 111);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('g1', 'x', 1500, 1510, 300), ('g1', 'o', 1480, 1470, 300);
        `);
        // Through this migration alone, so its rules stand as it wrote them.
        through = migrationsUpTo(31);
        migrate(drizzle(sqlite), { migrationsFolder: through });
    }

    const insertTournament = (id: string, extra: Record<string, unknown> = {}) => {
        const row = {
            id,
            name: null,
            status: `running`,
            starts_at: 10,
            time_control: turn,
            opening_plies: 5,
            max_entrants: 3,
            created_at: 10,
            started_at: 10,
            ended_at: null,
            origin: `person`,
            created_by: `u1`,
            rated: 0,
            test: 0,
            games_per_pair: 2,
            end_reason: null,
            ...extra,
        };
        const columns = Object.keys(row);
        return sqlite.prepare(`insert into tournaments (${columns.join(`, `)}) values (${columns.map((column) => `@${column}`).join(`, `)})`).run(row).changes;
    };

    it('keeps every tournament as the operator\'s, rated, with its entries, its pairings as first legs, and its games, moves, and ratings', () => {
        seed();
        expect(sqlite.prepare(`select id, name, origin, created_by as createdBy, rated, test, games_per_pair as games, end_reason as reason from tournaments order by id`).all()).toEqual([
            { id: `t_aaaaaaaaaaaa`, name: `Autumn`, origin: `operator`, createdBy: null, rated: 1, test: 0, games: 2, reason: null },
            { id: `t_bbbbbbbbbbbb`, name: `Winter`, origin: `operator`, createdBy: null, rated: 1, test: 0, games: 2, reason: null },
        ]);
        expect(sqlite.prepare(`select tournament_id as t, bot_id as bot, state, reason, origin, level, version from tournament_entries order by tournament_id, bot_id`).all()).toEqual([
            { t: `t_aaaaaaaaaaaa`, bot: `b1`, state: `playing`, reason: null, origin: `operator`, level: null, version: null },
            { t: `t_aaaaaaaaaaaa`, bot: `b2`, state: `playing`, reason: null, origin: `operator`, level: null, version: null },
            { t: `t_aaaaaaaaaaaa`, bot: `b3`, state: `withdrawn`, reason: `missed`, origin: `operator`, level: null, version: null },
            { t: `t_bbbbbbbbbbbb`, bot: `b1`, state: `entered`, reason: null, origin: `operator`, level: null, version: null },
        ]);
        expect(sqlite.prepare(`select id, leg, game1, game1_seat as seat1, game2, game2_seat as seat2 from tournament_pairings`).all()).toEqual([
            { id: `p1`, leg: 1, game1: `played`, seat1: `first`, game2: `played`, seat2: `second` },
        ]);
        expect(sqlite.prepare(`select id, pairing_id as pairing, pairing_game as game, unrated_by_choice as unrated, test from games order by id`).all()).toEqual([
            { id: `g1`, pairing: `p1`, game: 1, unrated: 0, test: 0 },
            { id: `g2`, pairing: `p1`, game: 2, unrated: 0, test: 0 },
            { id: `plain`, pairing: null, game: null, unrated: 1, test: 1 },
        ]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select count(*) as n from sqlite_master where name like '__kept_%' or name like '__new_%'`).get()).toEqual({ n: 0 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
    });

    it('holds one person to one running round robin, of 3 to 8 bots, never rated, named for them alone', () => {
        seed();
        expect(insertTournament(`t1`)).toBe(1);
        expect(() => insertTournament(`t2`)).toThrow(/UNIQUE/);
        expect(() => insertTournament(`t3`, { status: `finished`, ended_at: 20 })).not.toThrow();
        expect(() => insertTournament(`t4`, { created_by: `u2` })).not.toThrow();
        expect(() => insertTournament(`t5`, { created_by: `u3`, max_entrants: 9 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t6`, { created_by: `u3`, rated: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t7`, { created_by: `u3`, name: `Mine` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t8`, { created_by: `u3`, status: `scheduled`, started_at: null })).toThrow(/CHECK/);
        expect(() => insertTournament(`t9`, { origin: `operator`, created_by: null, name: `Spring`, rated: 1, status: `stopped`, end_reason: `creator`, ended_at: 20 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t10`, { origin: `operator`, created_by: `u3`, name: `Spring`, rated: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t11`, { origin: `operator`, created_by: null, name: null, rated: 1 })).toThrow(/CHECK/);
    });

    it('lets only a test play more than two openings a pair, a 1-ply opening only one, and stops a round robin with its reason alone', () => {
        seed();
        const over = { status: `finished`, ended_at: 20 };
        expect(() => insertTournament(`t1`, { ...over, games_per_pair: 4 })).not.toThrow();
        expect(() => insertTournament(`t2`, { ...over, games_per_pair: 6 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t3`, { ...over, games_per_pair: 10, test: 1 })).not.toThrow();
        expect(() => insertTournament(`t4`, { ...over, games_per_pair: 8, test: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t5`, { ...over, games_per_pair: 4, opening_plies: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t6`, { status: `stopped`, ended_at: 20, end_reason: `creator` })).not.toThrow();
        expect(() => insertTournament(`t7`, { status: `stopped`, ended_at: 20 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t8`, { ...over, end_reason: `creator` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t9`, { status: `stopped`, ended_at: 20, end_reason: `starter` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t10`, { ...over, origin: `operator`, created_by: null, name: `Spring`, rated: 1, test: 1 })).toThrow(/CHECK/);
    });

    it('keys an entry to its tournament\'s origin, holding one bot per owner and the operator\'s states to the weekly alone', () => {
        seed();
        insertTournament(`t1`);
        const entry = sqlite.prepare(`insert into tournament_entries (tournament_id, bot_id, owner_id, state, reason, origin, level, version, entered_at) values (?, ?, ?, ?, ?, ?, ?, ?, 10)`);
        expect(() => entry.run(`t1`, `b1`, `u1`, `playing`, null, `person`, `{"id":"club","label":"club"}`, `1.4.0`)).not.toThrow();
        expect(() => entry.run(`t1`, `b4`, `u1`, `withdrawn`, `owner`, `person`, null, null)).not.toThrow();
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, null, `operator`, null, null)).toThrow(/FOREIGN KEY/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `entered`, null, `person`, null, null)).toThrow(/CHECK/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `withdrawn`, `bored`, `person`, null, null)).toThrow(/CHECK/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, null, `person`, null, ``)).toThrow(/CHECK/);
        expect(() => entry.run(`t_bbbbbbbbbbbb`, `b4`, `u1`, `entered`, null, `operator`, null, null)).toThrow(/UNIQUE/);
        expect(() => entry.run(`t_bbbbbbbbbbbb`, `b2`, `u2`, `withdrawn`, `owner`, `operator`, null, null)).toThrow(/CHECK/);
        expect(() => entry.run(`t_bbbbbbbbbbbb`, `b3`, `u3`, `entered`, null, `operator`, `{"id":"club","label":"club"}`, null)).toThrow(/CHECK/);
    });

    it('numbers a pair\'s legs one to five, each once, and marks a round robin game unrated, a test between two bots of one owner', () => {
        seed();
        insertTournament(`t1`, { test: 1, games_per_pair: 10 });
        const leg = sqlite.prepare(`insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, leg) values (?, 't1', 1, 'b1', 'b4', ?)`);
        expect(() => leg.run(`l1`, 1)).not.toThrow();
        expect(() => leg.run(`l5`, 5)).not.toThrow();
        expect(() => leg.run(`l6`, 6)).toThrow(/CHECK/);
        expect(() => leg.run(`again`, 1)).toThrow(/UNIQUE/);
        const game = sqlite.prepare(
            `insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, pairing_id, pairing_game, unrated_by_choice, test, x_level, time_control, opening_cells, created_at) values (?, 'b1', 'b4', 'x', 'l1', 1, ?, ?, ?, '{}', '[]', 5)`,
        );
        expect(() => game.run(`r1`, 1, 1, null)).not.toThrow();
        expect(() => game.run(`r2`, 1, 0, `{"id":"club","label":"club"}`)).not.toThrow();
        expect(() => game.run(`r3`, 0, 1, null)).toThrow(/CHECK/);
        sqlite.prepare(`delete from tournaments where id = 't1'`).run();
        expect(sqlite.prepare(`select count(*) as n from games where pairing_id in ('l1', 'l5')`).get()).toEqual({ n: 0 });
    });

    it('keeps a round robin when its creator goes, naming nobody', () => {
        seed();
        insertTournament(`t1`, { created_by: `u3`, status: `finished`, ended_at: 20 });
        sqlite.prepare(`delete from users where id = 'u3'`).run();
        expect(sqlite.prepare(`select id, created_by as createdBy from tournaments where id = 't1'`).all()).toEqual([{ id: `t1`, createdBy: null }]);
    });
});

describe('the two-bot tournaments migration', () => {
    let sqlite: Sqlite;
    let folder: string;

    afterEach(() => {
        sqlite.close();
        rmSync(folder, { recursive: true, force: true });
    });

    const turn = `{"mode":"turn","turnTimeMs":10000}`;

    // As a deploy left it: a finished weekly with a pairing and its two rated games, a person's round robin running with
    // a live game, and another person's over that played two openings a pair, one game at a level, each field entered at once.
    function seed(): void {
        sqlite = openDatabase(`:memory:`);
        folder = migrationsUpTo(31);
        migrate(drizzle(sqlite), { migrationsFolder: folder });
        sqlite.exec(`
            insert into name_reservations (name_key) values ('ann'), ('bob'), ('cid'), ('alpha'), ('beta'), ('gamma'), ('aster');
            insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'ann', 'ann', 1), ('u2', 'd2', 'bob', 'bob', 1), ('u3', 'd3', 'cid', 'cid', 1);
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
                values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u2', 'beta', 'beta', 'h2', 'bot:play', 1),
                       ('b3', 'u3', 'gamma', 'gamma', 'h3', 'bot:play', 1), ('b4', 'u1', 'aster', 'aster', 'h4', 'bot:play', 1);
            insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at, started_at, ended_at)
                values ('t_aaaaaaaaaaaa', 'Autumn', 'finished', 100, '${turn}', 5, 12, 1, 100, 200);
            insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at, started_at, ended_at, origin, created_by, rated, games_per_pair)
                values ('t_bbbbbbbbbbbb', null, 'running', 300, '${turn}', 5, 3, 300, 300, null, 'person', 'u1', 0, 2),
                       ('t_cccccccccccc', null, 'finished', 300, '${turn}', 5, 3, 300, 300, 400, 'person', 'u2', 0, 4);
            insert into tournament_entries (tournament_id, bot_id, owner_id, state, reason, rating_at_start, entered_at, origin)
                values ('t_aaaaaaaaaaaa', 'b2', 'u2', 'playing', null, 1480, 1, 'operator'), ('t_aaaaaaaaaaaa', 'b1', 'u1', 'playing', null, 1500, 2, 'operator'),
                       ('t_bbbbbbbbbbbb', 'b3', 'u3', 'playing', null, 1450, 300, 'person'), ('t_bbbbbbbbbbbb', 'b1', 'u1', 'playing', null, 1500, 300, 'person'),
                       ('t_bbbbbbbbbbbb', 'b2', 'u2', 'withdrawn', 'owner', 1480, 300, 'person'),
                       ('t_cccccccccccc', 'b3', 'u3', 'playing', null, 1450, 300, 'person'), ('t_cccccccccccc', 'b4', 'u1', 'playing', null, 1500, 300, 'person'),
                       ('t_cccccccccccc', 'b2', 'u2', 'playing', null, 1480, 300, 'person');
            insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, opening_cells, game1, game1_seat, game2, game2_seat, leg)
                values ('p1', 't_aaaaaaaaaaaa', 1, 'b1', 'b2', '[]', 'played', 'first', 'played', 'second', 1),
                       ('p2', 't_bbbbbbbbbbbb', 1, 'b1', 'b3', '[]', 'live', null, 'pending', null, 1),
                       ('p3', 't_cccccccccccc', 1, 'b4', 'b3', '[]', 'played', 'first', 'played', null, 2);
            insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, pairing_id, pairing_game, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq)
                values ('g1', 'b1', 'b2', 'x', 'p1', 1, '${turn}', '[]', 'x', 'surrender', 100, 110, 1),
                       ('g2', 'b2', 'b1', 'x', 'p1', 2, '${turn}', '[]', 'x', 'surrender', 110, 120, 2),
                       ('g3', 'b1', 'b3', 'x', 'p2', 1, '${turn}', '[]', null, null, 300, null, null),
                       ('g4', 'b4', 'b3', 'x', 'p3', 1, '${turn}', '[]', 'x', 'surrender', 310, 320, 3);
            update games set unrated_by_choice = 1 where id in ('g3', 'g4');
            update games set x_level = '{"id":"club","label":"club"}' where id = 'g4';
            insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at) values ('g1', 1, 'o', 1, 0, 0, 1, 101), ('g3', 1, 'o', 1, 0, 0, 1, 301);
            insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after) values ('g1', 'x', 1500, 1510, 300), ('g1', 'o', 1480, 1470, 300);
        `);
        runMigrations(sqlite);
    }

    const insertTournament = (id: string, extra: Record<string, unknown> = {}) => {
        const row = {
            id,
            name: null,
            status: `running`,
            starts_at: 10,
            time_control: turn,
            opening_plies: 5,
            max_entrants: 2,
            created_at: 10,
            started_at: 10,
            ended_at: null,
            origin: `person`,
            created_by: `u3`,
            rated: 0,
            test: 0,
            games_per_pair: 2,
            end_reason: null,
            end_bot_id: null,
            live_slot: 1,
            ...extra,
        };
        const columns = Object.keys(row);
        return sqlite.prepare(`insert into tournaments (${columns.join(`, `)}) values (${columns.map((column) => `@${column}`).join(`, `)})`).run(row).changes;
    };

    const over = { status: `finished`, ended_at: 20 };

    it('keeps every tournament, its entries seated in the order their keys read, its pairings, and its games, moves, and ratings', () => {
        seed();
        expect(sqlite.prepare(`select id, status, live_slot as slot, end_reason as reason, end_bot_id as bot, games_per_pair as games from tournaments order by id`).all()).toEqual([
            { id: `t_aaaaaaaaaaaa`, status: `finished`, slot: null, reason: null, bot: null, games: 2 },
            { id: `t_bbbbbbbbbbbb`, status: `running`, slot: 1, reason: null, bot: null, games: 2 },
            { id: `t_cccccccccccc`, status: `finished`, slot: 1, reason: null, bot: null, games: 4 },
        ]);
        expect(sqlite.prepare(`select tournament_id as t, bot_id as bot, state, reason, seat from tournament_entries order by tournament_id, seat, bot_id`).all()).toEqual([
            { t: `t_aaaaaaaaaaaa`, bot: `b1`, state: `playing`, reason: null, seat: null },
            { t: `t_aaaaaaaaaaaa`, bot: `b2`, state: `playing`, reason: null, seat: null },
            { t: `t_bbbbbbbbbbbb`, bot: `b1`, state: `playing`, reason: null, seat: 1 },
            { t: `t_bbbbbbbbbbbb`, bot: `b2`, state: `withdrawn`, reason: `owner`, seat: 2 },
            { t: `t_bbbbbbbbbbbb`, bot: `b3`, state: `playing`, reason: null, seat: 3 },
            { t: `t_cccccccccccc`, bot: `b4`, state: `playing`, reason: null, seat: 1 },
            { t: `t_cccccccccccc`, bot: `b2`, state: `playing`, reason: null, seat: 2 },
            { t: `t_cccccccccccc`, bot: `b3`, state: `playing`, reason: null, seat: 3 },
        ]);
        expect(sqlite.prepare(`select id, leg, games_per_pair as games, game1, game2 from tournament_pairings order by id`).all()).toEqual([
            { id: `p1`, leg: 1, games: 2, game1: `played`, game2: `played` },
            { id: `p2`, leg: 1, games: 2, game1: `live`, game2: `pending` },
            { id: `p3`, leg: 2, games: 4, game1: `played`, game2: `played` },
        ]);
        expect(sqlite.prepare(`select id, pairing_id as pairing, pairing_game as game, unrated_by_choice as unrated, x_level as level from games order by id`).all()).toEqual([
            { id: `g1`, pairing: `p1`, game: 1, unrated: 0, level: null },
            { id: `g2`, pairing: `p1`, game: 2, unrated: 0, level: null },
            { id: `g3`, pairing: `p2`, game: 1, unrated: 1, level: null },
            { id: `g4`, pairing: `p3`, game: 1, unrated: 1, level: `{"id":"club","label":"club"}` },
        ]);
        expect(sqlite.prepare(`select count(*) as n from moves`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 2 });
        expect(sqlite.prepare(`select count(*) as n from sqlite_master where name like '__kept_%' or name like '__new_%'`).get()).toEqual({ n: 0 });
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
    });

    it('holds a person to two running at once, each in a live slot, of 2 to 8 bots, and the operator to slots of none', () => {
        seed();
        expect(insertTournament(`t1`)).toBe(1);
        expect(insertTournament(`t2`, { live_slot: 2, max_entrants: 8 })).toBe(1);
        expect(() => insertTournament(`t3`, { live_slot: 2 })).toThrow(/UNIQUE/);
        expect(() => insertTournament(`t4`, { live_slot: 3 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t5`, { live_slot: null })).toThrow(/CHECK/);
        expect(() => insertTournament(`t6`, { ...over, live_slot: 2 })).not.toThrow();
        expect(() => insertTournament(`t7`, { created_by: `u2`, max_entrants: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t8`, { created_by: `u2`, max_entrants: 9 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t9`, { origin: `operator`, created_by: null, name: `Spring`, rated: 1, status: `scheduled`, started_at: null, max_entrants: 3, live_slot: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t10`, { origin: `operator`, created_by: null, name: `Spring`, rated: 1, status: `scheduled`, started_at: null, max_entrants: 2, live_slot: null })).toThrow(/CHECK/);
        expect(() => insertTournament(`t11`, { origin: `operator`, created_by: null, name: `Spring`, rated: 1, status: `scheduled`, started_at: null, max_entrants: 3, live_slot: null })).not.toThrow();
    });

    it('holds a pair to a single game or one to five openings, a test to fifty games, and no bot past 30 games, or 70 in a test', () => {
        seed();
        expect(() => insertTournament(`t1`, { ...over, games_per_pair: 1 })).not.toThrow();
        expect(() => insertTournament(`t2`, { ...over, games_per_pair: 10, max_entrants: 4 })).not.toThrow();
        expect(() => insertTournament(`t3`, { ...over, games_per_pair: 10, max_entrants: 5 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t4`, { ...over, games_per_pair: 20 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t5`, { ...over, games_per_pair: 20, max_entrants: 4, test: 1 })).not.toThrow();
        expect(() => insertTournament(`t6`, { ...over, games_per_pair: 50, test: 1 })).not.toThrow();
        expect(() => insertTournament(`t7`, { ...over, games_per_pair: 50, max_entrants: 3, test: 1 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t8`, { ...over, games_per_pair: 3 })).toThrow(/CHECK/);
        expect(() => insertTournament(`t9`, { ...over, games_per_pair: 1, opening_plies: 1 })).not.toThrow();
        expect(() => insertTournament(`t10`, { ...over, games_per_pair: 4, opening_plies: 1 })).toThrow(/CHECK/);
    });

    it('cuts a person\'s short with why its last bot left and which, and stops one for the stop reasons alone', () => {
        seed();
        const cut = { status: `cut_short`, ended_at: 20 };
        expect(() => insertTournament(`t1`, { ...cut, end_reason: `missed`, end_bot_id: `b3` })).not.toThrow();
        expect(() => insertTournament(`t2`, { ...cut, end_reason: `owner` })).not.toThrow();
        expect(() => insertTournament(`t3`, cut)).toThrow(/CHECK/);
        expect(() => insertTournament(`t4`, { ...cut, end_reason: `creator` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t5`, { status: `stopped`, ended_at: 20, end_reason: `missed` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t6`, { status: `stopped`, ended_at: 20, end_reason: `creator`, end_bot_id: `b3` })).toThrow(/CHECK/);
        expect(() => insertTournament(`t7`, { ...cut, end_reason: `missed`, origin: `operator`, created_by: null, name: `Spring`, rated: 1, max_entrants: 3, live_slot: null })).toThrow(/CHECK/);
        sqlite.prepare(`delete from bots where id = 'b3'`).run();
        expect(sqlite.prepare(`select end_reason as reason, end_bot_id as bot from tournaments where id = 't1'`).get()).toEqual({ reason: `missed`, bot: null });
    });

    it('seats a person\'s entries once each, from 1 to 8, and the operator\'s none', () => {
        seed();
        insertTournament(`t1`);
        const entry = sqlite.prepare(`insert into tournament_entries (tournament_id, bot_id, owner_id, state, origin, seat, entered_at) values (?, ?, ?, ?, ?, ?, 10)`);
        expect(() => entry.run(`t1`, `b1`, `u1`, `playing`, `person`, 1)).not.toThrow();
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, `person`, 1)).toThrow(/UNIQUE/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, `person`, 9)).toThrow(/CHECK/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, `person`, null)).toThrow(/CHECK/);
        expect(() => entry.run(`t1`, `b2`, `u2`, `playing`, `person`, 2)).not.toThrow();
        expect(() => entry.run(`t_aaaaaaaaaaaa`, `b3`, `u3`, `playing`, `operator`, 3)).toThrow(/CHECK/);
    });

    it('holds a pairing to its tournament\'s games a pair: a single game\'s second slot none, and its legs to the openings it plays', () => {
        seed();
        insertTournament(`t1`, { games_per_pair: 1 });
        insertTournament(`t2`, { games_per_pair: 50, test: 1, live_slot: 2 });
        const pairing = sqlite.prepare(`insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, leg, game2, games_per_pair) values (?, ?, 1, 'b1', 'b3', ?, ?, ?)`);
        expect(() => pairing.run(`s1`, `t1`, 1, `none`, 1)).not.toThrow();
        expect(() => pairing.run(`s2`, `t1`, 1, `pending`, 1)).toThrow(/CHECK/);
        expect(() => pairing.run(`s3`, `t2`, 1, `none`, 50)).toThrow(/CHECK/);
        expect(() => pairing.run(`s4`, `t1`, 2, `none`, 1)).toThrow(/CHECK/);
        expect(() => pairing.run(`s5`, `t2`, 25, `pending`, 50)).not.toThrow();
        expect(() => pairing.run(`s6`, `t2`, 26, `pending`, 50)).toThrow(/CHECK/);
        expect(() => pairing.run(`s7`, `t2`, 1, `pending`, 2)).toThrow(/FOREIGN KEY/);
        sqlite.prepare(`update tournament_pairings set game1 = 'played', game1_seat = 'first' where id = 's1'`).run();
        expect(() => sqlite.prepare(`update tournament_pairings set game2 = 'played' where id = 's1'`).run()).toThrow(/CHECK/);
        sqlite.prepare(`delete from tournaments where id in ('t1', 't2')`).run();
        expect(sqlite.prepare(`select count(*) as n from tournament_pairings where id in ('s1', 's5')`).get()).toEqual({ n: 0 });
    });
});
