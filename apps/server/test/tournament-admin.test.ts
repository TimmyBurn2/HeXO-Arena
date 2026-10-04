import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { createBot, findBot } from '../src/bots';
import { createUserWithExactName } from '../src/users';
import { createTestApp, type TestApp } from './helpers';

const hour = 3_600_000;
const turnClock = { mode: `turn` as const, turnTimeMs: 10_000 };

function auditRows(world: TestApp): unknown[] {
    return world.sqlite.prepare(`select action, target, reason from admin_actions order by id`).all();
}

describe('tournament admin ops', () => {
    let world: TestApp;
    let clock: number;

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 1, 12);
        world = await createTestApp({ logger: false, devLogin: false, now: () => clock });
    });

    afterEach(async () => {
        await world.app.close();
    });

    function create(startsIn: number, name = `Autumn round robin`) {
        return world.admin({
            op: `tournament-create`,
            name,
            startsAt: new Date(clock + startsIn).toISOString(),
            timeControl: turnClock,
            openingPlies: 5,
            maxEntrants: 8,
            reason: `weekly`,
        });
    }

    function status() {
        const answer = world.admin({ op: `status` });
        if (answer.kind !== `status`) throw new Error(`status did not answer`);
        return answer.status;
    }

    it('schedules a tournament, lists it in status with no entries, and audits it under its name', () => {
        const answer = create(2 * hour);
        expect(answer).toMatchObject({ kind: `done` });
        const [listed] = status().tournaments;
        expect(listed).toMatchObject({ name: `Autumn round robin`, status: `scheduled`, startsAt: (clock + 2 * hour) / 1000, entrants: 0 });
        expect(listed?.id).toMatch(/^t_[a-z0-9]{12}$/);
        expect(answer.kind === `done` && answer.summary).toContain(listed?.id);
        expect(auditRows(world)).toEqual([{ action: `tournament-create`, target: `Autumn round robin`, reason: `weekly` }]);
    });

    it('refuses a start inside the hour, past fourteen days, or a fourth waiting tournament, writing no audit row', () => {
        expect(create(hour - 1_000)).toMatchObject({ kind: `error`, code: `bad_request` });
        expect(create(14 * 24 * hour + 1_000)).toMatchObject({ kind: `error`, code: `bad_request` });
        for (const name of [`One`, `Two`, `Three`]) expect(create(2 * hour, name)).toMatchObject({ kind: `done` });
        expect(create(2 * hour, `Four`)).toMatchObject({ kind: `error`, code: `bad_request` });
        expect(auditRows(world)).toHaveLength(3);
    });

    it('cancels a waiting tournament once, answering unchanged after and not_found for an unknown id', () => {
        create(2 * hour);
        const id = status().tournaments[0]?.id ?? ``;
        expect(world.admin({ op: `tournament-cancel`, id, reason: `rain` })).toMatchObject({ kind: `done` });
        expect(status().tournaments).toEqual([]);
        expect(world.admin({ op: `tournament-cancel`, id, reason: `rain` })).toMatchObject({ kind: `error`, code: `unchanged` });
        expect(world.admin({ op: `tournament-cancel`, id: `t_aaaaaaaaaaaa`, reason: `rain` })).toMatchObject({ kind: `error`, code: `not_found` });
        expect(world.sqlite.prepare(`select status, ended_at from tournaments where id = ?`).get(id)).toEqual({ status: `canceled`, ended_at: clock / 1000 });
    });

    it('lets a development server schedule one a minute out', async () => {
        const dev = await createTestApp({ logger: false, devLogin: true, now: () => clock });
        const soon = dev.admin({
            op: `tournament-create`,
            name: `Dev round robin`,
            startsAt: new Date(clock + 60_000).toISOString(),
            timeControl: turnClock,
            openingPlies: 1,
            maxEntrants: 12,
            reason: `dev`,
        });
        expect(soon).toMatchObject({ kind: `done` });
        await dev.app.close();
    });
});

describe('the tournament tables', () => {
    let world: TestApp;

    beforeEach(async () => {
        world = await createTestApp({ logger: false });
        const query = createQuery(world.sqlite);
        for (const [owner, bot] of [[`ann`, `alpha`], [`bob`, `beta`]] as const) {
            const user = createUserWithExactName(query, `dev:${owner}`, owner);
            if (user === `name_taken`) throw new Error(`seed name taken`);
            createBot(query, user.id, bot);
        }
        world.sqlite
            .prepare(`insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at) values ('t_aaaaaaaaaaaa', 'Autumn', 'scheduled', 1, '{}', 5, 12, 1)`)
            .run();
    });

    afterEach(async () => {
        await world.app.close();
    });

    function ids(bot: string): { bot: string; owner: string } {
        const row = findBot(createQuery(world.sqlite), bot);
        if (row === undefined) throw new Error(`no bot ${bot}`);
        const owner = world.sqlite.prepare(`select owner_id as owner from bots where id = ?`).get(row.id) as { owner: string };
        return { bot: row.id, owner: owner.owner };
    }

    function enter(bot: string, owner: string, state = `entered`, reason: string | null = null) {
        return () =>
            world.sqlite
                .prepare(`insert into tournament_entries (tournament_id, bot_id, owner_id, state, reason, entered_at) values ('t_aaaaaaaaaaaa', ?, ?, ?, ?, 1)`)
                .run(bot, owner, state, reason);
    }

    it('refuse a name outside printable ASCII or 3 to 40 characters, and an opening or cap out of bounds', () => {
        const insert = (id: string, name: string, plies = 5, max = 12) => () =>
            world.sqlite
                .prepare(`insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at) values (?, ?, 'scheduled', 1, '{}', ?, ?, 1)`)
                .run(id, name, plies, max);
        expect(insert(`t_1`, `Ab`)).toThrow(/CHECK/);
        expect(insert(`t_2`, `Caf\u00e9 cup`)).toThrow(/CHECK/);
        expect(insert(`t_3`, `Spring`, 4)).toThrow(/CHECK/);
        expect(insert(`t_4`, `Spring`, 5, 13)).toThrow(/CHECK/);
        expect(insert(`t_5`, `Spring cup`)).not.toThrow();
    });

    it('take one bot per owner, only with its own owner, and a reason exactly when left out or withdrawn', () => {
        const alpha = ids(`alpha`);
        const beta = ids(`beta`);
        expect(enter(alpha.bot, beta.owner)).toThrow(/FOREIGN KEY/);
        expect(enter(alpha.bot, alpha.owner, `left_out`)).toThrow(/CHECK/);
        expect(enter(alpha.bot, alpha.owner, `playing`, `missed`)).toThrow(/CHECK/);
        expect(enter(alpha.bot, alpha.owner)).not.toThrow();
        expect(enter(alpha.bot, alpha.owner)).toThrow(/UNIQUE|PRIMARY/);
        const second = createBot(createQuery(world.sqlite), alpha.owner, `alpha2`);
        if (second.kind !== `created`) throw new Error(`no second bot`);
        expect(enter(ids(`alpha2`).bot, alpha.owner)).toThrow(/UNIQUE/);
        expect(enter(beta.bot, beta.owner, `withdrawn`, `missed`)).not.toThrow();
    });

    it('hold a pairing to two bots, a winner only for a played game, and game 2 behind game 1', () => {
        const alpha = ids(`alpha`).bot;
        const beta = ids(`beta`).bot;
        const pairing = (id: string, game1: string, seat1: string | null, game2 = `pending`) => () =>
            world.sqlite
                .prepare(`insert into tournament_pairings (id, tournament_id, round, first_bot_id, second_bot_id, game1, game1_seat, game2, leg) values (?, 't_aaaaaaaaaaaa', 1, ?, ?, ?, ?, ?, ?)`)
                .run(id, alpha, beta, game1, seat1, game2, Number(id.slice(1)) % 5 + 1);
        expect(pairing(`p1`, `played`, `both`)).toThrow(/CHECK/);
        expect(pairing(`p2`, `no_show`, null)).toThrow(/CHECK/);
        expect(pairing(`p3`, `live`, null, `live`)).toThrow(/CHECK/);
        expect(pairing(`p4`, `aborted`, `first`)).toThrow(/CHECK/);
        expect(pairing(`p5`, `no_show`, `both`, `live`)).not.toThrow();
        expect(pairing(`p6`, `played`, null)).not.toThrow();
    });
});
