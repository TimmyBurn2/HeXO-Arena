import { reportGlobalLimit, reportLimit, reportReceiptSchema, reportsPath } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, roomyLimits, type TestApp } from './helpers';

let world: TestApp | null = null;

afterEach(async () => {
    await world?.app.close();
    world = null;
});

async function start(options: Parameters<typeof createTestApp>[0] = {}): Promise<TestApp> {
    const now = 1_000_000;
    world = await createTestApp({ logger: false, trustedProxy: `127.0.0.1`, now: () => now, ...options });
    return world;
}

const report = {
    subject: `/bots/sealbot`,
    reason: `name`,
    details: `The about text insults another player.\nSee the second line.`,
    name: `Quinn`,
    email: `quinn@example.org`,
    goodFaith: true,
};

const from = (address: string) => ({ headers: { 'x-forwarded-for': address } });

function rows(arena: TestApp): unknown[] {
    return arena.sqlite.prepare(`select subject, reason, details, reporter_name as name, reporter_email as email, status from reports order by id`).all();
}

describe('POST /api/reports', () => {
    it('stores a report from a signed-out visitor, open, and answers its number', async () => {
        const arena = await start();
        const sent = await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(`203.0.113.7`) });
        expect(sent.statusCode).toBe(201);
        expect(reportReceiptSchema.parse(sent.json())).toEqual({ id: 1 });
        const anonymous = await arena.app.inject({
            method: `POST`,
            url: reportsPath,
            payload: { subject: `/game/g_1?turn=3`, reason: `cheating`, details: `  two accounts  `, goodFaith: true },
            ...from(`203.0.113.7`),
        });
        expect(anonymous.json()).toEqual({ id: 2 });
        expect(rows(arena)).toEqual([
            { subject: `/bots/sealbot`, reason: `name`, details: report.details, name: `Quinn`, email: `quinn@example.org`, status: `open` },
            { subject: `/game/g_1?turn=3`, reason: `cheating`, details: `two accounts`, name: null, email: null, status: `open` },
        ]);
    });

    it('takes a report from a signed-in person without tying it to the account', async () => {
        const arena = await start();
        const session = await loginAs(arena.app, `quinn`);
        const sent = await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, cookies: { hexo_arena_session: session }, ...from(`203.0.113.7`) });
        expect(sent.statusCode).toBe(201);
        expect(arena.sqlite.prepare(`select * from reports`).get()).not.toHaveProperty(`user_id`);
    });

    it.each([
        [`a subject on another site`, { subject: `https://elsewhere.example/bots/x` }],
        [`a subject naming another host`, { subject: `//elsewhere.example/bots/x` }],
        [`a reason off the list`, { reason: `spam` }],
        [`no details`, { details: `   ` }],
        [`details that move the cursor`, { details: `fine\u001b[2Jcleared` }],
        [`details that reorder the text`, { details: `fine\u202eenif` }],
        [`an email that is no email`, { email: `nobody` }],
        [`an unchecked good-faith box`, { goodFaith: false }],
        [`a key the form never sends`, { phone: `555` }],
    ])('refuses %s with 400, storing nothing', async (_label, change) => {
        const arena = await start();
        const sent = await arena.app.inject({ method: `POST`, url: reportsPath, payload: { ...report, ...change }, ...from(`203.0.113.7`) });
        expect(sent.statusCode).toBe(400);
        expect(sent.json()).toMatchObject({ code: `bad_request` });
        expect(rows(arena)).toEqual([]);
    });

    it(`holds one client to ${String(reportLimit.burst)} reports at once, and another client apart`, async () => {
        const arena = await start();
        for (let n = 0; n < reportLimit.burst; n += 1) {
            expect((await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(`203.0.113.7`) })).statusCode).toBe(201);
        }
        const refused = await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(`203.0.113.7`) });
        expect(refused.statusCode).toBe(429);
        expect(refused.json()).toMatchObject({ code: `rate_limited` });
        expect(Number(refused.headers[`retry-after`])).toBeGreaterThan(0);
        expect((await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(`198.51.100.9`) })).statusCode).toBe(201);
    });

    it(`holds every caller together to ${String(reportGlobalLimit.burst)} reports at once`, async () => {
        const arena = await start({ limits: roomyLimits });
        for (let n = 0; n < reportGlobalLimit.burst; n += 1) {
            const address = `203.0.${String(Math.floor(n / 4))}.${String((n % 4) + 1)}`;
            expect((await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(address) })).statusCode).toBe(201);
        }
        expect((await arena.app.inject({ method: `POST`, url: reportsPath, payload: report, ...from(`198.51.100.9`) })).statusCode).toBe(429);
    });
});

describe('reports on the admin socket', () => {
    it('lists the open reports oldest first in status and closes one by number with a note, audited', async () => {
        const arena = await start();
        for (const subject of [`/bots/sealbot`, `/players/quinn`]) {
            await arena.app.inject({ method: `POST`, url: reportsPath, payload: { ...report, subject }, ...from(`203.0.113.7`) });
        }
        expect(arena.admin({ op: `status` })).toMatchObject({
            status: {
                openReportCount: 2,
                openReports: [
                    { id: 1, subject: `/bots/sealbot`, reason: `name`, details: report.details, name: `Quinn`, email: `quinn@example.org` },
                    { id: 2, subject: `/players/quinn` },
                ],
            },
        });
        expect(arena.admin({ op: `report-close`, id: 1, reason: `about text cleared by the owner` })).toEqual({ kind: `done`, summary: `closed report 1` });
        expect(arena.admin({ op: `report-close`, id: 1, reason: `again` })).toMatchObject({ kind: `error`, code: `unchanged` });
        expect(arena.admin({ op: `report-close`, id: 9, reason: `typo` })).toMatchObject({ kind: `error`, code: `not_found` });
        expect(arena.admin({ op: `status` })).toMatchObject({ status: { openReportCount: 1, openReports: [{ id: 2 }] } });
        expect(arena.sqlite.prepare(`select status, note, closed_at is not null as closed from reports where id = 1`).get()).toEqual({
            status: `closed`,
            note: `about text cleared by the owner`,
            closed: 1,
        });
        expect(arena.sqlite.prepare(`select action, target, reason from admin_actions`).all()).toEqual([
            { action: `report-close`, target: `1`, reason: `about text cleared by the owner` },
        ]);
    });
});
