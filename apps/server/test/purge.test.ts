import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuery, type Query, type Sqlite } from '../src/db';
import { purgeExpired, schedulePurges } from '../src/purge';
import { createBot, findBot } from '../src/bots';
import { createUserWithExactName } from '../src/users';
import { migratedDatabase } from './helpers';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('the nightly purge', () => {
    let sqlite: Sqlite;
    let query: Query;

    beforeEach(() => {
        sqlite = migratedDatabase();
        query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        for (const name of [`alpha`, `beta`]) createBot(query, owner.id, name);
    });

    afterEach(() => {
        sqlite.close();
        vi.useRealTimers();
    });

    function audit(when: string): void {
        sqlite.prepare(`insert into admin_actions (actor, action, target, reason, at) values ('operator', 'ban-user', 'someone', 'spam', ?)`).run(at(when));
    }

    function challenge(id: string, when: string): void {
        sqlite
            .prepare(
                `insert into challenges (id, challenger_bot_id, dest_bot_id, request_key, time_control, opening_plies, first_player, status, created_at, decided_at)
                 values (?, ?, ?, ?, '{"mode":"unlimited"}', 5, 'random', 'declined', ?, ?)`,
            )
            .run(id, findBot(query, `alpha`)?.id, findBot(query, `beta`)?.id, id, at(when), at(when));
    }

    function report(when: string, closedAt: string | null): void {
        sqlite
            .prepare(`insert into reports (subject, reason, details, good_faith, status, created_at, closed_at, note) values ('/bots/alpha', 'name', 'rude', 1, ?, ?, ?, ?)`)
            .run(closedAt === null ? `open` : `closed`, at(when), closedAt === null ? null : at(closedAt), closedAt === null ? null : `done`);
    }

    const left = (table: string) => sqlite.prepare(`select count(*) as n from ${table}`).get();

    it('removes moderation records once the third calendar year after theirs has ended, and keeps the rest', () => {
        audit(`2026-12-31T23:59:59Z`);
        audit(`2027-01-01T00:00:00Z`);
        expect(purgeExpired(query, new Date(`2029-12-31T23:00:00Z`))).toMatchObject({ moderation: 0 });
        expect(purgeExpired(query, new Date(`2030-01-01T03:00:00Z`))).toMatchObject({ moderation: 1 });
        expect(sqlite.prepare(`select at from admin_actions`).all()).toEqual([{ at: at(`2027-01-01T00:00:00Z`) }]);
    });

    it('removes challenge records 90 days after they were sent', () => {
        challenge(`old`, `2026-07-01T02:00:00Z`);
        challenge(`recent`, `2026-07-05T04:00:00Z`);
        expect(purgeExpired(query, new Date(`2026-10-02T03:00:00Z`))).toMatchObject({ challenges: 1 });
        expect(sqlite.prepare(`select id from challenges`).all()).toEqual([{ id: `recent` }]);
    });

    it('removes a report a year after it was closed, and never an open one', () => {
        report(`2024-01-01T00:00:00Z`, null);
        report(`2025-01-01T00:00:00Z`, `2025-10-01T00:00:00Z`);
        report(`2025-01-01T00:00:00Z`, `2025-10-03T00:00:00Z`);
        expect(purgeExpired(query, new Date(`2026-10-02T03:00:00Z`))).toMatchObject({ reports: 1 });
        expect(left(`reports`)).toEqual({ n: 2 });
        expect(sqlite.prepare(`select status from reports order by id`).all()).toEqual([{ status: `open` }, { status: `closed` }]);
    });

    it('runs every night at its hour, prunes the journal with it, and logs a failed night without throwing', async () => {
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `Date`], now: new Date(`2030-01-01T02:00:00Z`) });
        audit(`2026-06-01T00:00:00Z`);
        const log = { info: vi.fn(), error: vi.fn() };
        const journal = { prune: vi.fn(() => 2) };
        const schedule = schedulePurges({ query, journal, hourUtc: 3, log });
        await vi.advanceTimersByTimeAsync(59 * 60 * 1000);
        expect(left(`admin_actions`)).toEqual({ n: 1 });
        await vi.advanceTimersByTimeAsync(60 * 1000);
        expect(left(`admin_actions`)).toEqual({ n: 0 });
        expect(log.info).toHaveBeenCalledWith({ moderation: 1, challenges: 0, reports: 0, journaled: 2 }, `nightly purge done`);
        journal.prune.mockImplementation(() => {
            throw new Error(`disk gone`);
        });
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(log.error).toHaveBeenCalledTimes(1);
        schedule.stop();
    });
});
