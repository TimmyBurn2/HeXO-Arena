import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishedGamesPageSchema, gameSnapshotSchema, tournamentDetailSchema, tournamentListSchema, type TournamentDetail } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import { createTestApp, type TestApp } from './helpers';
import { migrationsUpTo } from './migrations-folder';
import { readZip } from './zip-reader';

const turn = `{"mode":"turn","turnTimeMs":10000}`;
const five = `[{"x":0,"y":0,"player":0},{"x":1,"y":0,"player":1},{"x":0,"y":1,"player":1},{"x":-1,"y":0,"player":0},{"x":0,"y":-1,"player":0}]`;
const three = `[{"x":0,"y":0,"player":0},{"x":2,"y":0,"player":1},{"x":0,"y":2,"player":1}]`;
const one = `[{"x":0,"y":0,"player":0}]`;
const club = `{"id":"club","label":"club"}`;

// The duels as the site held them before they became tournaments, one of each shape a deploy could leave: running with
// a game played on each side, one the drain cut and its replay live; rated and finished; cut short naming a bot; stopped
// by an owner with a game playing on; a single game drawn to the second bot; a test at a level with a version, stopped by
// its starter; a third running for a starter who runs a round robin beside the first; and a rated one still running.
// Beside them a round robin running with a game at a level, a challenge's game, their moves, ratings, and a reading.
const seedSql = `
    insert into name_reservations (name_key) values ('ann'), ('bob'), ('cid'), ('alpha'), ('aster'), ('beta'), ('gamma'), ('delta');
    insert into users (id, discord_id, name, name_key, created_at) values ('u1', 'd1', 'ann', 'ann', 1), ('u2', 'd2', 'bob', 'bob', 1), ('u3', 'd3', 'cid', 'cid', 1);
    insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at)
        values ('b1', 'u1', 'alpha', 'alpha', 'h1', 'bot:play', 1), ('b2', 'u1', 'aster', 'aster', 'h2', 'bot:play', 1), ('b3', 'u2', 'beta', 'beta', 'h3', 'bot:play', 1),
               ('b4', 'u3', 'gamma', 'gamma', 'h4', 'bot:play', 1), ('b5', 'u2', 'delta', 'delta', 'h5', 'bot:play', 1);
    insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at, started_at, ended_at, origin, created_by, rated, games_per_pair, live_slot)
        values ('t_annrobin0001', null, 'running', 900, '${turn}', 5, 3, 900, 900, null, 'person', 'u1', 0, 2, 1);
    insert into tournament_entries (tournament_id, bot_id, owner_id, state, rating_at_start, entered_at, origin, seat)
        values ('t_annrobin0001', 'b1', 'u1', 'playing', 1500, 900, 'person', 1), ('t_annrobin0001', 'b3', 'u2', 'playing', 1480, 900, 'person', 2), ('t_annrobin0001', 'b4', 'u3', 'playing', 1520, 900, 'person', 3);
    insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, opening_cells, game1, game1_seat, game2, game2_seat, leg, games_per_pair)
        values ('p_rr1', 't_annrobin0001', 1, 'b1', 'b3', '${five}', 'played', 'first', 'live', null, 1, 2);
    insert into duels (id, started_by, bot_a_id, bot_b_id, a_first, a_x, test, games, time_control, opening_plies, a_level, b_level, a_rating, b_rating, a_version, b_version, rated, status, end_reason, end_bot, created_at, ended_at) values
        ('d_runningduel1', 'u1', 'b1', 'b3', 0, 1, 0, 6, '${turn}', 5, null, null, 1500, 1480, null, null, 0, 'running', null, null, 1000, null),
        ('d_ratedfinish1', 'u3', 'b1', 'b4', 0, 0, 0, 2, '${turn}', 5, null, null, 1500, 1520, null, null, 1, 'finished', null, null, 2000, 2100),
        ('d_cutshortduel', 'u2', 'b2', 'b3', 1, 1, 0, 4, '${turn}', 3, null, null, 1500, 1480, null, null, 0, 'cut_short', 'offline', 'b', 3000, 3200),
        ('d_ownerstopped', 'u3', 'b3', 'b4', 0, 0, 0, 4, '${turn}', 5, null, null, 1480, 1520, null, null, 0, 'stopped', 'owner', 'a', 4000, 4300),
        ('d_singlegame01', 'u2', 'b2', 'b5', 1, 0, 0, 1, '${turn}', 1, null, null, 1500, 1450, null, null, 0, 'finished', null, null, 5000, 5100),
        ('d_testduel0001', 'u1', 'b1', 'b2', 1, 1, 1, 20, '${turn}', 5, '${club}', null, 1500, 1500, '1.2.0', null, 0, 'stopped', 'starter', null, 6000, 6200),
        ('d_thirdrunning', 'u1', 'b2', 'b4', 1, 1, 0, 2, '${turn}', 5, null, null, 1500, 1520, null, null, 0, 'running', null, null, 7000, null),
        ('d_ratedrunning', 'u2', 'b4', 'b5', 0, 1, 0, 2, '${turn}', 5, null, null, 1520, 1450, null, null, 1, 'running', null, null, 8000, null);
    insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, unrated_by_choice, test, x_level, o_level, pairing_id, pairing_game, duel_id, duel_game, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq) values
        ('g_rr1', 'b1', 'b3', 'x', 1, 0, '${club}', null, 'p_rr1', 1, null, null, '${turn}', '${five}', 'x', 'six-in-a-row', 901, 910, 1),
        ('g_rr2', 'b3', 'b1', 'x', 1, 0, null, '${club}', 'p_rr1', 2, null, null, '${turn}', '${five}', null, null, 911, null, null),
        ('g11', 'b1', 'b3', 'x', 1, 0, null, null, null, null, 'd_runningduel1', 1, '${turn}', '${five}', 'x', 'six-in-a-row', 1001, 1010, 2),
        ('g12', 'b3', 'b1', 'x', 1, 0, null, null, null, null, 'd_runningduel1', 2, '${turn}', '${five}', 'o', 'surrender', 1011, 1020, 3),
        ('g13a', 'b1', 'b3', 'x', 1, 0, null, null, null, null, 'd_runningduel1', 3, '${turn}', '${five}', null, 'aborted', 1021, 1022, 4),
        ('g13b', 'b1', 'b3', 'x', 1, 0, null, null, null, null, 'd_runningduel1', 3, '${turn}', '${five}', null, null, 1030, null, null),
        ('g21', 'b4', 'b1', 'x', 0, 0, null, null, null, null, 'd_ratedfinish1', 1, '${turn}', '${five}', 'o', 'surrender', 2001, 2010, 5),
        ('g22', 'b1', 'b4', 'x', 0, 0, null, null, null, null, 'd_ratedfinish1', 2, '${turn}', '${five}', 'x', 'six-in-a-row', 2011, 2020, 6),
        ('g31', 'b2', 'b3', 'x', 1, 0, null, null, null, null, 'd_cutshortduel', 1, '${turn}', '${three}', 'x', 'surrender', 3001, 3010, 7),
        ('g32', 'b3', 'b2', 'x', 1, 0, null, null, null, null, 'd_cutshortduel', 2, '${turn}', '${three}', null, 'terminated', 3011, 3020, 8),
        ('g41', 'b4', 'b3', 'x', 1, 0, null, null, null, null, 'd_ownerstopped', 1, '${turn}', '${five}', 'x', 'surrender', 4001, 4010, 9),
        ('g42', 'b3', 'b4', 'x', 1, 0, null, null, null, null, 'd_ownerstopped', 2, '${turn}', '${five}', 'x', 'timeout', 4011, 4020, 10),
        ('g43', 'b4', 'b3', 'x', 1, 0, null, null, null, null, 'd_ownerstopped', 3, '${turn}', '${five}', null, null, 4030, null, null),
        ('g51', 'b5', 'b2', 'x', 1, 0, null, null, null, null, 'd_singlegame01', 1, '${turn}', '${one}', 'o', 'surrender', 5001, 5010, 11),
        ('g61', 'b1', 'b2', 'x', 1, 1, '${club}', null, null, null, 'd_testduel0001', 1, '${turn}', '${five}', 'x', 'surrender', 6001, 6010, 12),
        ('g62', 'b2', 'b1', 'x', 1, 1, null, '${club}', null, null, 'd_testduel0001', 2, '${turn}', '${five}', 'x', 'surrender', 6011, 6020, 13),
        ('g81', 'b4', 'b5', 'x', 0, 0, null, null, null, null, 'd_ratedrunning', 1, '${turn}', '${five}', 'o', 'surrender', 8001, 8010, 14),
        ('g_free', 'b1', 'b5', 'x', 0, 0, null, null, null, null, null, null, '${turn}', '${five}', 'x', 'surrender', 8100, 8110, 15);
    insert into moves (game_id, seq, side, first_x, first_y, second_x, second_y, created_at)
        values ('g11', 1, 'o', 2, 0, 2, -1, 1002), ('g11', 2, 'x', -2, 0, -2, 1, 1003), ('g21', 1, 'o', 2, 0, 2, -1, 2002), ('g13b', 1, 'o', 2, 0, 2, -1, 1031);
    insert into game_ratings (game_id, side, rating_before, rating_after, deviation_after)
        values ('g21', 'x', 1520, 1505, 300), ('g21', 'o', 1500, 1515, 300), ('g22', 'x', 1515, 1530, 290), ('g22', 'o', 1505, 1490, 290),
               ('g81', 'x', 1520, 1500, 300), ('g81', 'o', 1450, 1470, 300), ('g_free', 'x', 1530, 1540, 280), ('g_free', 'o', 1470, 1460, 280);
    insert into analyses (id, game_id, status, seconds, created_at) values ('a1', 'g21', 'queued', 10, 2030), ('a2', 'g61', 'queued', 10, 6030);
    insert into admin_actions (actor, action, target, reason, at) values ('operator', 'duel-stop', 'd_testduel0001', 'farming', 6200);
`;

const duelIds = [`d_runningduel1`, `d_ratedfinish1`, `d_cutshortduel`, `d_ownerstopped`, `d_singlegame01`, `d_testduel0001`, `d_thirdrunning`, `d_ratedrunning`];

// The rows every reader of a game points at, counted on both sides of the migration.
const countedTables = [`games`, `moves`, `game_ratings`, `analyses`, `admin_actions`, `users`, `bots`];

function counts(sqlite: Sqlite): Record<string, number> {
    return Object.fromEntries(countedTables.map((table) => [table, (sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n]));
}

// A database at the schema just before duels became tournaments, seeded as above.
function seeded(): { sqlite: Sqlite; before: Record<string, number> } {
    const sqlite = openDatabase(`:memory:`);
    const folder = migrationsUpTo(32);
    try {
        migrate(drizzle(sqlite), { migrationsFolder: folder });
    } finally {
        rmSync(folder, { recursive: true, force: true });
    }
    sqlite.exec(seedSql);
    return { sqlite, before: counts(sqlite) };
}

const rows = (sqlite: Sqlite, sql: string): unknown[] => sqlite.prepare(sql).all();

describe('duels becoming tournaments of two', () => {
    let sqlite: Sqlite | null = null;

    afterEach(() => {
        sqlite?.close();
        sqlite = null;
    });

    it('keeps every game, move, rating, reading, and audit row, each duel game pointing at its duel under the same id', () => {
        const seed = seeded();
        sqlite = seed.sqlite;
        runMigrations(sqlite);
        expect(counts(sqlite)).toEqual(seed.before);
        expect(sqlite.pragma(`foreign_key_check`)).toEqual([]);
        expect(sqlite.pragma(`integrity_check`)).toEqual([{ integrity_check: `ok` }]);
        expect(rows(sqlite, `select name from sqlite_master where name = 'duels' or sql like '%duel_id%' or sql like '%duel_game%'`)).toEqual([]);
        expect(rows(sqlite, `select id, pairing_id as pairing, pairing_game as game from games order by created_at`)).toEqual([
            { id: `g_rr1`, pairing: `p_rr1`, game: 1 },
            { id: `g_rr2`, pairing: `p_rr1`, game: 2 },
            { id: `g11`, pairing: `p_d_runningduel1_1`, game: 1 },
            { id: `g12`, pairing: `p_d_runningduel1_1`, game: 2 },
            { id: `g13a`, pairing: `p_d_runningduel1_2`, game: 1 },
            { id: `g13b`, pairing: `p_d_runningduel1_2`, game: 1 },
            { id: `g21`, pairing: `p_d_ratedfinish1_1`, game: 1 },
            { id: `g22`, pairing: `p_d_ratedfinish1_1`, game: 2 },
            { id: `g31`, pairing: `p_d_cutshortduel_1`, game: 1 },
            { id: `g32`, pairing: `p_d_cutshortduel_1`, game: 2 },
            { id: `g41`, pairing: `p_d_ownerstopped_1`, game: 1 },
            { id: `g42`, pairing: `p_d_ownerstopped_1`, game: 2 },
            { id: `g43`, pairing: `p_d_ownerstopped_2`, game: 1 },
            { id: `g51`, pairing: `p_d_singlegame01_1`, game: 1 },
            { id: `g61`, pairing: `p_d_testduel0001_1`, game: 1 },
            { id: `g62`, pairing: `p_d_testduel0001_1`, game: 2 },
            { id: `g81`, pairing: `p_d_ratedrunning_1`, game: 1 },
            { id: `g_free`, pairing: null, game: null },
        ]);
        // Each game keeps its marks, levels, and result as it was played.
        expect(rows(sqlite, `select id, unrated_by_choice as unrated, test, x_level as x, o_level as o, winner, finish_reason as reason, finish_seq as seq from games where id in ('g_rr1', 'g21', 'g61', 'g62', 'g13b')  order by id`)).toEqual([
            { id: `g13b`, unrated: 1, test: 0, x: null, o: null, winner: null, reason: null, seq: null },
            { id: `g21`, unrated: 0, test: 0, x: null, o: null, winner: `o`, reason: `surrender`, seq: 5 },
            { id: `g61`, unrated: 1, test: 1, x: club, o: null, winner: `x`, reason: `surrender`, seq: 12 },
            { id: `g62`, unrated: 1, test: 1, x: null, o: club, winner: `x`, reason: `surrender`, seq: 13 },
            { id: `g_rr1`, unrated: 1, test: 0, x: club, o: null, winner: `x`, reason: `six-in-a-row`, seq: 1 },
        ]);
        expect(rows(sqlite, `select action, target from admin_actions`)).toEqual([{ action: `duel-stop`, target: `d_testduel0001` }]);
    });

    it('turns each duel into a person\'s tournament of two with its terms, its end, and the bot it names, a running one in a free live slot', () => {
        const seed = seeded();
        sqlite = seed.sqlite;
        runMigrations(sqlite);
        expect(
            rows(
                sqlite,
                `select id, origin, created_by as creator, status, max_entrants as bots, games_per_pair as games, opening_plies as opening, rated, test, end_reason as reason, end_bot_id as bot, live_slot as slot, starts_at as startsAt, started_at as startedAt, created_at as createdAt from tournaments order by created_at`,
            ),
        ).toEqual([
            { id: `t_annrobin0001`, origin: `person`, creator: `u1`, status: `running`, bots: 3, games: 2, opening: 5, rated: 0, test: 0, reason: null, bot: null, slot: 1, startsAt: 900, startedAt: 900, createdAt: 900 },
            { id: `d_runningduel1`, origin: `person`, creator: `u1`, status: `running`, bots: 2, games: 6, opening: 5, rated: 0, test: 0, reason: null, bot: null, slot: 2, startsAt: 1000, startedAt: 1000, createdAt: 1000 },
            { id: `d_ratedfinish1`, origin: `person`, creator: `u3`, status: `finished`, bots: 2, games: 2, opening: 5, rated: 1, test: 0, reason: null, bot: null, slot: 1, startsAt: 2000, startedAt: 2000, createdAt: 2000 },
            { id: `d_cutshortduel`, origin: `person`, creator: `u2`, status: `cut_short`, bots: 2, games: 4, opening: 3, rated: 0, test: 0, reason: `offline`, bot: `b3`, slot: 1, startsAt: 3000, startedAt: 3000, createdAt: 3000 },
            { id: `d_ownerstopped`, origin: `person`, creator: `u3`, status: `cut_short`, bots: 2, games: 4, opening: 5, rated: 0, test: 0, reason: `owner`, bot: `b3`, slot: 1, startsAt: 4000, startedAt: 4000, createdAt: 4000 },
            { id: `d_singlegame01`, origin: `person`, creator: `u2`, status: `finished`, bots: 2, games: 1, opening: 1, rated: 0, test: 0, reason: null, bot: null, slot: 1, startsAt: 5000, startedAt: 5000, createdAt: 5000 },
            { id: `d_testduel0001`, origin: `person`, creator: `u1`, status: `stopped`, bots: 2, games: 20, opening: 5, rated: 0, test: 1, reason: `creator`, bot: null, slot: 1, startsAt: 6000, startedAt: 6000, createdAt: 6000 },
            { id: `d_thirdrunning`, origin: `person`, creator: `u1`, status: `stopped`, bots: 2, games: 2, opening: 5, rated: 0, test: 0, reason: `operator`, bot: null, slot: 1, startsAt: 7000, startedAt: 7000, createdAt: 7000 },
            { id: `d_ratedrunning`, origin: `person`, creator: `u2`, status: `stopped`, bots: 2, games: 2, opening: 5, rated: 1, test: 0, reason: `operator`, bot: null, slot: 1, startsAt: 8000, startedAt: 8000, createdAt: 8000 },
        ]);
        const ended = rows(sqlite, `select id, ended_at as endedAt from tournaments where id like 'd_%' order by created_at`) as { id: string; endedAt: number | null }[];
        expect(ended.slice(0, 6)).toEqual([
            { id: `d_runningduel1`, endedAt: null },
            { id: `d_ratedfinish1`, endedAt: 2100 },
            { id: `d_cutshortduel`, endedAt: 3200 },
            { id: `d_ownerstopped`, endedAt: 4300 },
            { id: `d_singlegame01`, endedAt: 5100 },
            { id: `d_testduel0001`, endedAt: 6200 },
        ]);
        // A running duel stopped on the way ends as the migration ran.
        for (const stopped of ended.slice(6)) expect(stopped.endedAt).toBeGreaterThan(1_700_000_000);
        expect(
            rows(
                sqlite,
                `select tournament_id as id, seat, bot_id as bot, owner_id as owner, state, reason, rating_at_start as rating, level, version, entered_at as enteredAt from tournament_entries where tournament_id like 'd_%' order by tournament_id, seat`,
            ),
        ).toEqual([
            { id: `d_cutshortduel`, seat: 1, bot: `b2`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 3000 },
            { id: `d_cutshortduel`, seat: 2, bot: `b3`, owner: `u2`, state: `playing`, reason: null, rating: 1480, level: null, version: null, enteredAt: 3000 },
            { id: `d_ownerstopped`, seat: 1, bot: `b4`, owner: `u3`, state: `playing`, reason: null, rating: 1520, level: null, version: null, enteredAt: 4000 },
            { id: `d_ownerstopped`, seat: 2, bot: `b3`, owner: `u2`, state: `withdrawn`, reason: `owner`, rating: 1480, level: null, version: null, enteredAt: 4000 },
            { id: `d_ratedfinish1`, seat: 1, bot: `b4`, owner: `u3`, state: `playing`, reason: null, rating: 1520, level: null, version: null, enteredAt: 2000 },
            { id: `d_ratedfinish1`, seat: 2, bot: `b1`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 2000 },
            { id: `d_ratedrunning`, seat: 1, bot: `b5`, owner: `u2`, state: `playing`, reason: null, rating: 1450, level: null, version: null, enteredAt: 8000 },
            { id: `d_ratedrunning`, seat: 2, bot: `b4`, owner: `u3`, state: `playing`, reason: null, rating: 1520, level: null, version: null, enteredAt: 8000 },
            { id: `d_runningduel1`, seat: 1, bot: `b3`, owner: `u2`, state: `playing`, reason: null, rating: 1480, level: null, version: null, enteredAt: 1000 },
            { id: `d_runningduel1`, seat: 2, bot: `b1`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 1000 },
            { id: `d_singlegame01`, seat: 1, bot: `b2`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 5000 },
            { id: `d_singlegame01`, seat: 2, bot: `b5`, owner: `u2`, state: `playing`, reason: null, rating: 1450, level: null, version: null, enteredAt: 5000 },
            { id: `d_testduel0001`, seat: 1, bot: `b1`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: club, version: `1.2.0`, enteredAt: 6000 },
            { id: `d_testduel0001`, seat: 2, bot: `b2`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 6000 },
            { id: `d_thirdrunning`, seat: 1, bot: `b2`, owner: `u1`, state: `playing`, reason: null, rating: 1500, level: null, version: null, enteredAt: 7000 },
            { id: `d_thirdrunning`, seat: 2, bot: `b4`, owner: `u3`, state: `playing`, reason: null, rating: 1520, level: null, version: null, enteredAt: 7000 },
        ]);
        expect(rows(sqlite, `select tournament_id as id, bot_id as bot, seat, state from tournament_entries where tournament_id = 't_annrobin0001' order by seat`)).toEqual([
            { id: `t_annrobin0001`, bot: `b1`, seat: 1, state: `playing` },
            { id: `t_annrobin0001`, bot: `b3`, seat: 2, state: `playing` },
            { id: `t_annrobin0001`, bot: `b4`, seat: 3, state: `playing` },
        ]);
    });

    it('plays each opening as a pairing of round 1, its first bot on x in its first game, each game as its latest row left it', () => {
        const seed = seeded();
        sqlite = seed.sqlite;
        runMigrations(sqlite);
        const pairings = rows(
            sqlite,
            `select id, round, leg, first_bot_id as first, second_bot_id as second, game1, game1_seat as seat1, game2, game2_seat as seat2, games_per_pair as games, opening_cells is not null as opened from tournament_pairings where tournament_id like 'd_%' and leg <= 3 order by tournament_id, leg`,
        );
        expect(pairings).toEqual([
            { id: `p_d_cutshortduel_1`, round: 1, leg: 1, first: `b2`, second: `b3`, game1: `played`, seat1: `first`, game2: `played`, seat2: null, games: 4, opened: 1 },
            { id: `p_d_cutshortduel_2`, round: 1, leg: 2, first: `b2`, second: `b3`, game1: `not_played`, seat1: null, game2: `not_played`, seat2: null, games: 4, opened: 0 },
            { id: `p_d_ownerstopped_1`, round: 1, leg: 1, first: `b4`, second: `b3`, game1: `played`, seat1: `first`, game2: `played`, seat2: `second`, games: 4, opened: 1 },
            { id: `p_d_ownerstopped_2`, round: 1, leg: 2, first: `b4`, second: `b3`, game1: `live`, seat1: null, game2: `pending`, seat2: null, games: 4, opened: 1 },
            { id: `p_d_ratedfinish1_1`, round: 1, leg: 1, first: `b4`, second: `b1`, game1: `played`, seat1: `second`, game2: `played`, seat2: `second`, games: 2, opened: 1 },
            { id: `p_d_ratedrunning_1`, round: 1, leg: 1, first: `b4`, second: `b5`, game1: `played`, seat1: `second`, game2: `not_played`, seat2: null, games: 2, opened: 1 },
            { id: `p_d_runningduel1_1`, round: 1, leg: 1, first: `b1`, second: `b3`, game1: `played`, seat1: `first`, game2: `played`, seat2: `first`, games: 6, opened: 1 },
            { id: `p_d_runningduel1_2`, round: 1, leg: 2, first: `b1`, second: `b3`, game1: `live`, seat1: null, game2: `pending`, seat2: null, games: 6, opened: 1 },
            { id: `p_d_runningduel1_3`, round: 1, leg: 3, first: `b1`, second: `b3`, game1: `pending`, seat1: null, game2: `pending`, seat2: null, games: 6, opened: 0 },
            { id: `p_d_singlegame01_1`, round: 1, leg: 1, first: `b5`, second: `b2`, game1: `played`, seat1: `second`, game2: `none`, seat2: null, games: 1, opened: 1 },
            { id: `p_d_testduel0001_1`, round: 1, leg: 1, first: `b1`, second: `b2`, game1: `played`, seat1: `first`, game2: `played`, seat2: `second`, games: 20, opened: 1 },
            { id: `p_d_testduel0001_2`, round: 1, leg: 2, first: `b1`, second: `b2`, game1: `not_played`, seat1: null, game2: `not_played`, seat2: null, games: 20, opened: 0 },
            { id: `p_d_testduel0001_3`, round: 1, leg: 3, first: `b1`, second: `b2`, game1: `not_played`, seat1: null, game2: `not_played`, seat2: null, games: 20, opened: 0 },
            { id: `p_d_thirdrunning_1`, round: 1, leg: 1, first: `b2`, second: `b4`, game1: `not_played`, seat1: null, game2: `not_played`, seat2: null, games: 2, opened: 0 },
        ]);
        expect(rows(sqlite, `select tournament_id as id, count(*) as legs from tournament_pairings group by tournament_id order by tournament_id`)).toEqual([
            { id: `d_cutshortduel`, legs: 2 },
            { id: `d_ownerstopped`, legs: 2 },
            { id: `d_ratedfinish1`, legs: 1 },
            { id: `d_ratedrunning`, legs: 1 },
            { id: `d_runningduel1`, legs: 3 },
            { id: `d_singlegame01`, legs: 1 },
            { id: `d_testduel0001`, legs: 10 },
            { id: `d_thirdrunning`, legs: 1 },
            { id: `t_annrobin0001`, legs: 1 },
        ]);
        expect(rows(sqlite, `select distinct game1, game2 from tournament_pairings where tournament_id = 'd_testduel0001' and leg > 1`)).toEqual([{ game1: `not_played`, game2: `not_played` }]);
        // A pairing's opening is the one its first game drew.
        expect(rows(sqlite, `select opening_cells as opening from tournament_pairings where id = 'p_d_singlegame01_1'`)).toEqual([{ opening: one }]);
        expect(rows(sqlite, `select id, game1, game1_seat as seat1, game2 from tournament_pairings where id = 'p_rr1'`)).toEqual([{ id: `p_rr1`, game1: `played`, seat1: `first`, game2: `live` }]);
    });

    it('holds the new ends to two-bot tournaments, a rated person\'s one to a duel over, and a game to a pairing alone', () => {
        const seed = seeded();
        sqlite = seed.sqlite;
        runMigrations(sqlite);
        const insert = (id: string, extra: Record<string, unknown>) => {
            const row = {
                id,
                name: null,
                status: `cut_short`,
                starts_at: 10,
                time_control: turn,
                opening_plies: 5,
                max_entrants: 2,
                created_at: 10,
                started_at: 10,
                ended_at: 20,
                origin: `person`,
                created_by: `u3`,
                rated: 0,
                test: 0,
                games_per_pair: 2,
                end_reason: `offline`,
                live_slot: 1,
                ...extra,
            };
            const columns = Object.keys(row);
            return sqlite?.prepare(`insert into tournaments (${columns.join(`, `)}) values (${columns.map((column) => `@${column}`).join(`, `)})`).run(row).changes;
        };
        expect(() => insert(`t1`, {})).not.toThrow();
        expect(() => insert(`t2`, { max_entrants: 3 })).toThrow(/CHECK/);
        expect(() => insert(`t3`, { status: `stopped`, end_reason: `operator` })).not.toThrow();
        expect(() => insert(`t4`, { status: `stopped`, end_reason: `starter` })).toThrow(/CHECK/);
        expect(() => insert(`t5`, { status: `finished`, end_reason: null, rated: 1 })).not.toThrow();
        expect(() => insert(`t6`, { status: `running`, end_reason: null, ended_at: null, rated: 1 })).toThrow(/CHECK/);
        expect(() => insert(`t7`, { status: `finished`, end_reason: null, rated: 1, max_entrants: 3 })).toThrow(/CHECK/);
        expect(() => insert(`t8`, { status: `cut_short`, end_reason: `aborted`, end_bot_id: `b3` })).not.toThrow();
        expect(() => sqlite?.prepare(`insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, unrated_by_choice, x_level, time_control, opening_cells, created_at) values ('x1', 'b1', 'b3', 'x', 1, '${club}', '{}', '[]', 5)`).run()).toThrow(/CHECK/);
    });
});

describe('a duel kept as a tournament, read through the site', () => {
    let test: TestApp | null = null;
    let shellDir: string | null = null;

    afterEach(async () => {
        await test?.app.close();
        test = null;
        if (shellDir !== null) rmSync(shellDir, { recursive: true, force: true });
        shellDir = null;
    });

    async function booted(): Promise<TestApp> {
        const seed = seeded();
        shellDir = mkdtempSync(join(tmpdir(), `hexo-arena-shell-`));
        const indexPath = join(shellDir, `index.html`);
        writeFileSync(
            indexPath,
            `<!doctype html><html><head><title>x</title><meta name="description" content="x" /><meta property="og:title" content="x" /><meta property="og:description" content="x" /><meta property="og:image" content="/og.png" /></head><body></body></html>`,
        );
        test = await createTestApp({ sqlite: seed.sqlite, webIndexPath: indexPath });
        return test;
    }

    async function detail(app: TestApp, id: string): Promise<TournamentDetail> {
        const response = await app.app.inject({ method: `GET`, url: `/api/tournaments/${id}` });
        expect(response.statusCode, id).toBe(200);
        return tournamentDetailSchema.parse(response.json());
    }

    // Each game of the duel's one pairing as the page reads it: how it stands, and the seat it scored for.
    const outcomes = (read: TournamentDetail) => read.rounds.flatMap((round) => round.pairings.flatMap((pairing) => pairing.games.map((game) => [game.outcome, game.point])));

    it('answers every duel under its own id as a duel of its two bots, the first named first, game by game', async () => {
        const app = await booted();
        const running = await detail(app, `d_runningduel1`);
        expect([running.format, running.status, running.gamesPerPair, running.rated]).toEqual([`duel`, `running`, 6, false]);
        expect(running.entries.map((entry) => [entry.key, entry.bot, entry.state])).toEqual([
            [1, `beta`, `playing`],
            [2, `alpha`, `playing`],
        ]);
        // The boot sweep aborted the replay the drain left live, so the opening it replayed counts for no one and play goes on.
        expect(outcomes(running)).toEqual([
            [`played`, 2],
            [`played`, 2],
            [`aborted`, null],
            [`pending`, null],
            [`pending`, null],
            [`pending`, null],
        ]);
        expect(running.standings.map((line) => [line.bot, line.points])).toEqual([
            [`alpha`, 2],
            [`beta`, 0],
        ]);

        const rated = await detail(app, `d_ratedfinish1`);
        expect([rated.status, rated.rated, rated.entries.map((entry) => entry.bot)]).toEqual([`finished`, true, [`gamma`, `alpha`]]);
        expect(outcomes(rated)).toEqual([
            [`played`, 2],
            [`played`, 2],
        ]);
        expect(rated.rounds[0]?.pairings[0]?.games.map((game) => [game.gameId, game.reason, game.turns])).toEqual([
            [`g21`, `surrender`, 3],
            [`g22`, `six-in-a-row`, 2],
        ]);

        const cut = await detail(app, `d_cutshortduel`);
        expect([cut.status, cut.end]).toEqual([`cut_short`, { reason: `offline`, round: 1, bot: { key: 2, name: `beta` } }]);
        expect(outcomes(cut)).toEqual([
            [`played`, 1],
            [`played`, null],
            [`not_played`, null],
            [`not_played`, null],
        ]);

        const owner = await detail(app, `d_ownerstopped`);
        expect([owner.status, owner.end?.reason, owner.end?.bot?.name]).toEqual([`cut_short`, `owner`, `beta`]);
        expect(owner.entries.map((entry) => [entry.bot, entry.state, entry.reason])).toEqual([
            [`gamma`, `playing`, undefined],
            [`beta`, `withdrawn`, `owner`],
        ]);
        // The game a stop let play on was cut by the boot sweep, and nothing follows it.
        expect(outcomes(owner)).toEqual([
            [`played`, 1],
            [`played`, 2],
            [`not_played`, null],
            [`not_played`, null],
        ]);

        const single = await detail(app, `d_singlegame01`);
        expect([single.gamesPerPair, single.entries.map((entry) => entry.bot)]).toEqual([1, [`aster`, `delta`]]);
        expect(single.rounds[0]?.pairings[0]?.games.map((game) => [game.x, game.outcome, game.point])).toEqual([[2, `played`, 1]]);

        const tested = await detail(app, `d_testduel0001`);
        expect([tested.test, tested.status, tested.end?.reason]).toEqual([true, `stopped`, `creator`]);
        expect(tested.entries.map((entry) => [entry.bot, entry.level?.id, entry.version])).toEqual([
            [`alpha`, `club`, `1.2.0`],
            [`aster`, undefined, undefined],
        ]);
        expect(outcomes(tested).slice(0, 3)).toEqual([
            [`played`, 1],
            [`played`, 2],
            [`not_played`, null],
        ]);
        expect(outcomes(tested)).toHaveLength(20);
        expect(tested.estimates?.map((each) => [each.key, each.estimate.games])).toEqual([
            [1, 2],
            [2, 2],
        ]);

        for (const stopped of [`d_thirdrunning`, `d_ratedrunning`]) expect((await detail(app, stopped)).end?.reason, stopped).toBe(`operator`);
    });

    it('lists every duel with its pair, links each old address and game to it, and exports its games', async () => {
        const app = await booted();
        const list = tournamentListSchema.parse((await app.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
        const listed = [...list.running, ...list.past].map((tournament) => tournament.id);
        // Tests stay in the list as the API answers it; the pages leave them out.
        for (const id of duelIds) expect(listed, id).toContain(id);
        const rated = list.past.find((tournament) => tournament.id === `d_ratedfinish1`);
        expect(rated?.pair?.first.name).toBe(`gamma`);
        expect([rated?.pair?.first.points, rated?.pair?.second.points]).toEqual([0, 2]);

        for (const [from, to] of [
            [`/duels/d_ratedfinish1`, `/tournaments/d_ratedfinish1`],
            [`/play/duels/d_ratedfinish1`, `/tournaments/d_ratedfinish1`],
            [`/games/duels?list=yours`, `/games/tournaments?list=yours`],
            [`/play/duels?first=gamma&second=alpha&games=2`, `/play/tournament?bots=gamma%2Calpha&games=2`],
        ] as const) {
            const moved = await app.app.inject({ method: `GET`, url: from });
            expect([moved.statusCode, moved.headers.location], from).toEqual([301, to]);
        }
        const page = await app.app.inject({ method: `GET`, url: `/tournaments/d_ratedfinish1` });
        expect(page.statusCode).toBe(200);
        expect(page.body).toContain(`<title>gamma vs alpha - HeXO Arena</title>`);

        const history = finishedGamesPageSchema.parse((await app.app.inject({ method: `GET`, url: `/api/games/finished?tournament=d_ratedfinish1` })).json());
        expect(history.games.map((game) => [game.gameId, game.tournament?.game, game.tournament?.of, game.tournament?.format, game.rated])).toEqual([
            [`g22`, 2, 2, `duel`, true],
            [`g21`, 1, 2, `duel`, true],
        ]);
        // A test named asks for its games, tests or not.
        const tests = finishedGamesPageSchema.parse((await app.app.inject({ method: `GET`, url: `/api/games/finished?tournament=d_testduel0001` })).json());
        expect(tests.games.map((game) => game.gameId)).toEqual([`g62`, `g61`]);
        const events = finishedGamesPageSchema.parse((await app.app.inject({ method: `GET`, url: `/api/games/finished?event=none` })).json());
        expect(events.games.map((game) => game.gameId)).toEqual([`g_free`]);

        const snapshot = gameSnapshotSchema.parse((await app.app.inject({ method: `GET`, url: `/api/games/g42` })).json());
        expect(snapshot.tournament).toEqual({ id: `d_ownerstopped`, name: `Duel by cid`, format: `duel`, round: 1, game: 2, of: 4, createdBy: `cid` });

        const exported = await app.app.inject({ method: `GET`, url: `/api/tournaments/d_testduel0001/export` });
        expect(exported.statusCode).toBe(200);
        const files = readZip(exported.rawPayload);
        expect(files.map((file) => file.name).filter((name) => name.endsWith(`.htttx`))).toHaveLength(2);
        const csv = files.find((file) => file.name === `games.csv`)?.text.trim().split(`\n`) ?? [];
        expect(csv).toHaveLength(3);
        expect(csv[0]).toMatch(/^number,round,pair,opening,game,x,o,winner,reason,/u);
        expect(csv[1]).toMatch(/^1,1,alpha vs aster,1,1,alpha,aster,x,surrender,2,false,true,.*,1\.2\.0,\r?$/u);
        expect(csv[2]).toMatch(/^2,1,alpha vs aster,1,2,aster,alpha,x,surrender,2,false,true,.*,,1\.2\.0\r?$/u);
        expect(files.some((file) => file.name === `standings.csv`)).toBe(true);
    });
});
