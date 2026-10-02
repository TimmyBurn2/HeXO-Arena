import { describe, expect, it } from 'vitest';
import { adminReasonSchema, adminRequestSchema, adminResponseSchema, expandTournamentName } from '../src';

const turnClock = { mode: `turn`, turnTimeMs: 10_000 };

describe('the weekly tournament rule ops', () => {
    const add = { op: `tournament-schedule-add`, weekday: `sun`, time: `18:00`, namePattern: `Sunday cup {date}`, timeControl: turnClock, reason: `weekly` };

    it('add a rule with a 5-ply opening, 12 entries, and entries opening 7 days ahead by default', () => {
        expect(adminRequestSchema.parse(add)).toEqual({ ...add, openingPlies: 5, maxEntrants: 12, daysAhead: 7 });
        expect(adminRequestSchema.safeParse({ ...add, openingPlies: 3, maxEntrants: 3, daysAhead: 14 }).success).toBe(true);
    });

    it('refuse a weekday, time, clock, or entry window out of bounds, and a missing reason', () => {
        for (const change of [
            { weekday: `sunday` },
            { time: `24:00` },
            { time: `7:30` },
            { time: `18:60` },
            { timeControl: { mode: `unlimited` } },
            { daysAhead: 0 },
            { daysAhead: 15 },
            { maxEntrants: 13 },
            { openingPlies: 4 },
            { reason: undefined },
        ]) {
            expect(adminRequestSchema.safeParse({ ...add, ...change }).success).toBe(false);
        }
    });

    it('take a name pattern only when every expanded name passes the tournament name rules', () => {
        expect(adminRequestSchema.safeParse({ ...add, namePattern: `${`x`.repeat(29)} {date}` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ ...add, namePattern: `${`x`.repeat(30)} {date}` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ ...add, namePattern: `Weekly` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ ...add, namePattern: `{date} ` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ ...add, namePattern: `Caf\u00e9 {date}` }).success).toBe(false);
    });

    it('list with nothing beside the op, and remove a rule by its positive id with a reason', () => {
        expect(adminRequestSchema.parse({ op: `tournament-schedule-list` })).toEqual({ op: `tournament-schedule-list` });
        expect(adminRequestSchema.safeParse({ op: `tournament-schedule-list`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `tournament-schedule-remove`, id: 3, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `tournament-schedule-remove`, id: 0, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `tournament-schedule-remove`, id: 3 }).success).toBe(false);
    });
});

describe('expandTournamentName', () => {
    it('writes the start date in UTC wherever the pattern names it', () => {
        expect(expandTournamentName(`Cup {date}`, Date.UTC(2026, 9, 4, 23, 30))).toBe(`Cup 2026-10-04`);
        expect(expandTournamentName(`{date} to {date}`, Date.UTC(2026, 0, 1))).toBe(`2026-01-01 to 2026-01-01`);
        expect(expandTournamentName(`Weekly`, Date.UTC(2026, 0, 1))).toBe(`Weekly`);
    });
});

describe('adminRequestSchema', () => {
    it('takes a status request and nothing beside it', () => {
        expect(adminRequestSchema.parse({ op: `status` })).toEqual({ op: `status` });
        expect(adminRequestSchema.safeParse({ op: `status`, extra: 1 }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `reset-rating` }).success).toBe(false);
    });

    it('wants a reason on every mutation', () => {
        expect(adminRequestSchema.safeParse({ op: `pause`, reason: `incident` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `pause` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `resume`, reason: `` }).success).toBe(false);
    });

    it('aborts by exactly one of a well-formed game id and a bot name', () => {
        const gameId = `g_0b7a3c1e-2f4d-4a5b-8c6d-7e8f9a0b1c2d`;
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, bot: `alpha`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId, bot: `alpha`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `abort-game`, gameId: `g_nope`, reason: `r` }).success).toBe(false);
    });

    it('excludes game ids and player names from a recompute, none by default', () => {
        expect(adminRequestSchema.parse({ op: `recompute-ratings`, reason: `r` })).toEqual({
            op: `recompute-ratings`,
            exclude: [],
            reason: `r`,
        });
        const exclude = [`g_0b7a3c1e-2f4d-4a5b-8c6d-7e8f9a0b1c2d`, `alpha`];
        expect(adminRequestSchema.safeParse({ op: `recompute-ratings`, exclude, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `recompute-ratings`, exclude: [`g_x y`], reason: `r` }).success).toBe(false);
    });

    it('targets bots by a name that passes the name rules', () => {
        expect(adminRequestSchema.safeParse({ op: `delist-bot`, name: `alpha`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `delete-user`, name: `ann`, reason: `r` }).success).toBe(true);
        expect(adminRequestSchema.safeParse({ op: `relist-bot`, name: `9lives`, reason: `r` }).success).toBe(false);
        expect(adminRequestSchema.safeParse({ op: `delist-bot`, name: `a`.repeat(31), reason: `r` }).success).toBe(false);
    });
});

describe('adminReasonSchema', () => {
    it('wants a reason with content, at most 500 chars', () => {
        expect(adminReasonSchema.parse(`  spam  `)).toBe(`spam`);
        expect(adminReasonSchema.safeParse(`   `).success).toBe(false);
        expect(adminReasonSchema.safeParse(`a`.repeat(501)).success).toBe(false);
    });
});

describe('adminResponseSchema', () => {
    it('closes the error codes', () => {
        expect(adminResponseSchema.safeParse({ kind: `error`, error: `x`, code: `not_found` }).success).toBe(true);
        expect(adminResponseSchema.safeParse({ kind: `error`, error: `x`, code: `teapot` }).success).toBe(false);
    });
});
