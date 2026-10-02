import { adminResponseSchema, type AdminRequest } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import { createTestApp, type TestApp } from './helpers';

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const turnClock = { mode: `turn` as const, turnTimeMs: 10_000 };

// 2026-10-01 is a Thursday; the rule's first start is the Sunday after.
const thursdayNoon = Date.UTC(2026, 9, 1, 12);
const sunday = Date.UTC(2026, 9, 4, 18);

type AddRule = Extract<AdminRequest, { op: `tournament-schedule-add` }>;

const sundayRule: AddRule = {
    op: `tournament-schedule-add`,
    weekday: `sun`,
    time: `18:00`,
    namePattern: `Sunday cup {date}`,
    timeControl: turnClock,
    openingPlies: 5,
    maxEntrants: 12,
    daysAhead: 3,
    reason: `weekly`,
};

interface Row {
    name: string;
    status: string;
    starts_at: number;
    rule_id: number | null;
}

describe('weekly tournament rules', () => {
    let world: TestApp;
    let clock: number;

    beforeEach(async () => {
        clock = thursdayNoon;
        world = await createTestApp({ logger: false, devLogin: false, now: () => clock });
    });

    afterEach(async () => {
        await world.app.close();
    });

    async function restart(): Promise<void> {
        const { sqlite } = world;
        await world.app.close();
        world = await createTestApp({ logger: false, devLogin: false, now: () => clock, sqlite });
    }

    function tick(at: number): void {
        clock = at;
        world.tournaments.tick();
    }

    function rows(): Row[] {
        return world.sqlite.prepare(`select name, status, starts_at, rule_id from tournaments order by starts_at, name`).all() as Row[];
    }

    function auditRows(): unknown[] {
        return world.sqlite.prepare(`select actor, action, target, reason from admin_actions order by id`).all();
    }

    function addRule(change: Partial<AddRule> = {}) {
        return world.admin({ ...sundayRule, ...change });
    }

    function ruleId(): number {
        return (world.sqlite.prepare(`select id from tournament_rules`).get() as { id: number }).id;
    }

    function listed() {
        const answer = world.admin({ op: `tournament-schedule-list` });
        if (answer.kind !== `tournament-rules`) throw new Error(`the list did not answer`);
        return answer.rules;
    }

    function createOneOff(name: string, startsIn: number) {
        return world.admin({
            op: `tournament-create`,
            name,
            startsAt: new Date(clock + startsIn).toISOString(),
            timeControl: turnClock,
            openingPlies: 5,
            maxEntrants: 12,
            reason: `one-off`,
        });
    }

    it('creates the week\'s tournament once its entry window opens, named for its date and audited under the rule', () => {
        expect(addRule()).toMatchObject({ kind: `done` });
        tick(sunday - 3 * day - minute);
        expect(rows()).toEqual([]);
        tick(sunday - 3 * day);
        expect(rows()).toEqual([{ name: `Sunday cup 2026-10-04`, status: `scheduled`, starts_at: sunday / 1000, rule_id: ruleId() }]);
        expect(auditRows().at(-1)).toEqual({ actor: `operator`, action: `tournament-create`, target: `Sunday cup 2026-10-04`, reason: `weekly rule ${String(ruleId())}` });
        tick(sunday - 3 * day + 1_000);
        tick(sunday - 2 * day);
        expect(rows()).toHaveLength(1);
    });

    it('creates one event per week across restarts, including a boot inside the open window', async () => {
        addRule();
        clock = sunday - 2 * day;
        await restart();
        expect(rows()).toHaveLength(1);
        await restart();
        tick(sunday - 2 * day + 1_000);
        expect(rows()).toHaveLength(1);
        tick(sunday + 4 * day);
        await restart();
        tick(sunday + 4 * day + 1_000);
        expect(rows().map((row) => [row.starts_at, row.status])).toEqual([
            [sunday / 1000, `called_off`],
            [(sunday + 7 * day) / 1000, `scheduled`],
        ]);
    });

    it('makes no second event for a week when the clock steps back or forward across its start', () => {
        addRule();
        tick(sunday - 3 * day);
        tick(sunday - 5 * day);
        tick(sunday - 3 * day + minute);
        tick(sunday - 30 * minute);
        tick(sunday + minute);
        expect(rows().map((row) => row.status)).toEqual([`called_off`]);
        tick(sunday - 2 * hour);
        tick(sunday - 3 * day);
        tick(sunday + minute);
        expect(rows()).toHaveLength(1);
        tick(sunday + 4 * day);
        tick(sunday + 3 * day);
        tick(sunday + 4 * day + minute);
        expect(rows().map((row) => row.starts_at)).toEqual([sunday / 1000, (sunday + 7 * day) / 1000]);
    });

    it('skips a week whose start came inside the lead while nothing ran, and creates the next one on time', () => {
        addRule();
        tick(sunday - 30 * minute);
        tick(sunday + minute);
        expect(rows()).toEqual([]);
        tick(sunday + 4 * day);
        expect(rows().map((row) => row.starts_at)).toEqual([(sunday + 7 * day) / 1000]);
    });

    it('defers the event while three tournaments wait, creates it once a slot frees, and skips it once the start is inside the lead', () => {
        addRule();
        for (const name of [`One`, `Two`, `Three`]) expect(createOneOff(name, 13 * day)).toMatchObject({ kind: `done` });
        tick(sunday - 3 * day);
        expect(rows().filter((row) => row.rule_id !== null)).toEqual([]);
        const [first, second] = world.sqlite.prepare(`select id from tournaments order by name`).all() as { id: string }[];
        world.admin({ op: `tournament-cancel`, id: first?.id ?? ``, reason: `room` });
        tick(sunday - 2 * day);
        expect(rows().filter((row) => row.rule_id !== null).map((row) => row.starts_at)).toEqual([sunday / 1000]);

        // The next week's window opens with the cap full again, and the
        // slot frees only once that start is inside the lead.
        tick(sunday + minute);
        expect(createOneOff(`Four`, 10 * day)).toMatchObject({ kind: `done` });
        tick(sunday + 4 * day);
        expect(rows().filter((row) => row.rule_id !== null)).toHaveLength(1);
        tick(sunday + 7 * day - 30 * minute);
        world.admin({ op: `tournament-cancel`, id: second?.id ?? ``, reason: `room` });
        tick(sunday + 7 * day - 29 * minute);
        expect(rows().filter((row) => row.rule_id !== null)).toHaveLength(1);
    });

    it('opens two weeks at once for a rule whose entries open more than a week ahead', () => {
        addRule({ daysAhead: 14 });
        tick(thursdayNoon + 1_000);
        expect(rows().map((row) => row.starts_at)).toEqual([sunday / 1000, (sunday + 7 * day) / 1000]);
    });

    it('adds a rule, lists it with its next start, shows it in status, and audits it under its id', () => {
        const answer = addRule({ daysAhead: 7 });
        expect(answer).toMatchObject({ kind: `done` });
        const id = ruleId();
        expect(answer.kind === `done` && answer.summary).toContain(`rule ${String(id)}`);
        const rule = {
            id,
            weekday: `sun`,
            time: `18:00`,
            namePattern: `Sunday cup {date}`,
            timeControl: turnClock,
            openingPlies: 5,
            maxEntrants: 12,
            daysAhead: 7,
            nextStartsAt: sunday / 1000,
        };
        expect(listed()).toEqual([rule]);
        const status = world.admin({ op: `status` });
        expect(status.kind === `status` && status.status.tournamentRules).toEqual([rule]);
        expect(adminResponseSchema.safeParse(status).success).toBe(true);
        expect(adminResponseSchema.safeParse(world.admin({ op: `tournament-schedule-list` })).success).toBe(true);
        expect(auditRows()).toEqual([{ actor: `operator`, action: `tournament-schedule-add`, target: String(id), reason: `weekly` }]);
    });

    it('answers unchanged for the same rule again and refuses another rule on a taken slot, writing no audit row', () => {
        addRule();
        expect(addRule()).toMatchObject({ kind: `error`, code: `unchanged` });
        expect(addRule({ namePattern: `Other {date}` })).toMatchObject({ kind: `error`, code: `bad_request` });
        expect(addRule({ time: `18:01` })).toMatchObject({ kind: `done` });
        expect(auditRows()).toHaveLength(2);
    });

    it('lists the start of the waiting event as next, and the week after once that event is canceled', () => {
        addRule();
        tick(sunday - 3 * day);
        expect(listed()[0]?.nextStartsAt).toBe(sunday / 1000);
        const id = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
        world.admin({ op: `tournament-cancel`, id, reason: `rain` });
        expect(listed()[0]?.nextStartsAt).toBe((sunday + 7 * day) / 1000);
        tick(sunday - 2 * day);
        expect(rows()).toHaveLength(1);
    });

    it('removes a rule and keeps the tournaments it created, naming the waiting ones to cancel', () => {
        addRule();
        tick(sunday - 3 * day);
        const id = ruleId();
        const [event] = world.sqlite.prepare(`select id from tournaments`).all() as { id: string }[];
        const answer = world.admin({ op: `tournament-schedule-remove`, id, reason: `ended` });
        expect(answer).toMatchObject({ kind: `done` });
        expect(answer.kind === `done` && answer.summary).toContain(event?.id ?? `no event`);
        expect(answer.kind === `done` && answer.summary).toContain(`tournament-cancel`);
        expect(rows()).toEqual([{ name: `Sunday cup 2026-10-04`, status: `scheduled`, starts_at: sunday / 1000, rule_id: null }]);
        expect(listed()).toEqual([]);
        tick(sunday + 4 * day);
        expect(rows()).toHaveLength(1);
        expect(auditRows().at(-1)).toEqual({ actor: `operator`, action: `tournament-schedule-remove`, target: String(id), reason: `ended` });
        expect(world.admin({ op: `tournament-schedule-remove`, id, reason: `ended` })).toMatchObject({ kind: `error`, code: `not_found` });
    });
});

describe('the weekly rule tables', () => {
    let sqlite: Sqlite;

    beforeEach(() => {
        sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
    });

    afterEach(() => {
        sqlite.close();
    });

    function insertRule(values: { weekday?: number | null; minute?: number; name?: string; plies?: number; max?: number; days?: number } = {}) {
        return () =>
            sqlite
                .prepare(
                    `insert into tournament_rules (weekday, minute_of_day, name_pattern, time_control, opening_plies, max_entrants, days_ahead, created_at) values (?, ?, ?, '{}', ?, ?, ?, 1)`,
                )
                .run(values.weekday === undefined ? 6 : values.weekday, values.minute ?? 1080, values.name ?? `Sunday cup {date}`, values.plies ?? 5, values.max ?? 12, values.days ?? 7);
    }

    function insertTournament(id: string, ruleId: number | null, startsAt: number) {
        return () =>
            sqlite
                .prepare(
                    `insert into tournaments (id, name, status, starts_at, time_control, opening_plies, max_entrants, created_at, rule_id) values (?, 'Cup', 'scheduled', ?, '{}', 5, 12, 1, ?)`,
                )
                .run(id, startsAt, ruleId);
    }

    it('refuse a weekday, minute, opening, cap, or entry window out of range, and a name that expands past the bounds', () => {
        expect(insertRule({ weekday: 7 })).toThrow(/CHECK/);
        expect(insertRule({ weekday: -1 })).toThrow(/CHECK/);
        expect(insertRule({ weekday: null })).toThrow(/NOT NULL/);
        expect(insertRule({ minute: 1440 })).toThrow(/CHECK/);
        expect(insertRule({ plies: 4 })).toThrow(/CHECK/);
        expect(insertRule({ max: 2 })).toThrow(/CHECK/);
        expect(insertRule({ max: 13 })).toThrow(/CHECK/);
        expect(insertRule({ days: 0 })).toThrow(/CHECK/);
        expect(insertRule({ days: 15 })).toThrow(/CHECK/);
        expect(insertRule({ name: `${`x`.repeat(30)} {date}` })).toThrow(/CHECK/);
        expect(insertRule({ name: `Caf\u00e9` })).toThrow(/CHECK/);
        expect(insertRule({ name: `x{date}`, minute: 0 })).not.toThrow();
    });

    it('hold one rule per weekly slot', () => {
        expect(insertRule()).not.toThrow();
        expect(insertRule({ name: `Other` })).toThrow(/UNIQUE/);
        expect(insertRule({ minute: 1081 })).not.toThrow();
    });

    it('refuse a second tournament for one rule\'s start, and let the rule go while its tournaments stay', () => {
        insertRule()();
        expect(insertTournament(`t_aaaaaaaaaaaa`, 1, 100)).not.toThrow();
        expect(insertTournament(`t_bbbbbbbbbbbb`, 1, 100)).toThrow(/UNIQUE/);
        expect(insertTournament(`t_cccccccccccc`, 1, 100 + 7 * 86_400)).not.toThrow();
        expect(insertTournament(`t_dddddddddddd`, null, 100)).not.toThrow();
        expect(insertTournament(`t_eeeeeeeeeeee`, null, 100)).not.toThrow();
        expect(insertTournament(`t_ffffffffffff`, 9, 200)).toThrow(/FOREIGN KEY/);
        sqlite.prepare(`delete from tournament_rules`).run();
        expect(sqlite.prepare(`select count(*) as n from tournaments where rule_id is null`).get()).toEqual({ n: 4 });
    });
});
