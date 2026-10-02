import { botListingSchema, botsPath, parseClockArg, tournamentListSchema, tournamentsPath } from '@hexo-arena/contract';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createQuery } from '../../../apps/server/src/db';
import { games } from '../../../apps/server/src/db/schema';
import { createTestApp, type TestApp } from '../../../apps/server/test/helpers';
import type { SeedPlan } from '../src/personas';
import { NotADevServer } from '../src/runner';
import { seedDevData, type SeedReport } from '../src/seed';
import { devTournamentLeadMs, devTournamentName, devWeeklyRule, type DevWeeklyRule } from '../src/tournament';

// One game of each kind the full plan holds, so a run takes seconds.
// Eve resigns at the first turn, before hextide can hold the six stones a win needs.
const plan: SeedPlan = {
    humans: {
        bruno: [{ bot: `pebble`, timeControl: { mode: `unlimited` }, openingPlies: 5, ending: { kind: `play` } }],
        dmitri: [{ bot: `pebble`, timeControl: { mode: `turn`, turnTimeMs: 5_000 }, openingPlies: 3, ending: { kind: `idle` } }],
        eve: [{ bot: `hextide`, timeControl: { mode: `turn`, turnTimeMs: 20_000 }, openingPlies: 5, ending: { kind: `resign`, afterTurns: 0 } }],
    },
    series: [{ from: `hextide`, to: `quietlake`, games: [{ timeControl: { mode: `unlimited` }, openingPlies: 1 }] }],
    banned: [`eve`],
};

const tokensSchema = z.record(z.string(), z.string());

describe('the dev seed', () => {
    let directory: string;
    let tokenFile: string;
    let world: TestApp | null;
    let origin: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), `hexo-arena-dev-seed-`));
        tokenFile = join(directory, `data`, `dev-seed.json`);
        world = null;
    });

    afterEach(async () => {
        if (world !== null) {
            world.app.server.closeAllConnections();
            await world.app.close();
            world.sqlite.close();
        }
        rmSync(directory, { recursive: true, force: true });
    });

    async function boot(devLogin: boolean): Promise<TestApp> {
        const booted = await createTestApp({ devLogin, logger: false });
        world = booted;
        await booted.app.listen({ host: `127.0.0.1`, port: 0 });
        const address = booted.app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        origin = `http://127.0.0.1:${String(address.port)}`;
        return booted;
    }

    function seed(booted: TestApp, extra: Partial<Parameters<typeof seedDevData>[0]> = {}): Promise<SeedReport> {
        return seedDevData({
            ...extra,
            origin,
            plan,
            tokenFile,
            ban: (name) => {
                const answer = booted.admin({ op: `ban-user`, name, reason: `dev seed persona` });
                return answer.kind === `error` && answer.code !== `unchanged` ? Promise.reject(new Error(answer.error)) : Promise.resolve();
            },
            thinkMs: () => 0,
            paceMs: 0,
            random: Math.random,
            log: () => undefined,
        });
    }

    function finishes(booted: TestApp) {
        return createQuery(booted.sqlite)
            .select({ reason: games.finishReason, user: games.userId })
            .from(games)
            .all();
    }

    it('builds the personas, their bots, and a history over the real routes', async () => {
        const booted = await boot(true);
        const report = await seed(booted);
        expect(report.accounts.map((account) => account.name)).toEqual([`ana`, `bruno`, `cleo`, `dmitri`, `eve`]);
        const byName = new Map(report.accounts.map((account) => [account.name, account]));
        expect(byName.get(`ana`)?.bots.map((bot) => bot.name).sort()).toEqual([`cinder`, `hextide`, `lantern`, `pebble`, `tarn`]);
        expect(byName.get(`dmitri`)?.bots.map((bot) => bot.name)).toEqual([`quietlake`]);
        expect(byName.get(`cleo`)).toMatchObject({ games: 0, bots: [] });
        expect(byName.get(`eve`)).toMatchObject({ banned: true, games: 1 });
        expect(byName.get(`bruno`)).toMatchObject({ banned: false, games: 1 });
        expect(byName.get(`ana`)?.bots.find((bot) => bot.name === `hextide`)?.vsBots).toBe(1);
        expect(report.played).toBe(4);
        expect(report.ranked).toEqual([]);
        expect(finishes(booted).map((game) => game.reason).sort()).toEqual([`six-in-a-row`, `six-in-a-row`, `surrender`, `timeout`]);

        expect(Object.keys(tokensSchema.parse(JSON.parse(readFileSync(tokenFile, `utf8`)))).sort()).toEqual([`hextide`, `pebble`, `quietlake`]);
        const listing = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}`)).json());
        expect(listing.find((bot) => bot.name === `hextide`)).toMatchObject({ version: `1.4.0`, accepts: { unlimited: false } });
        const lantern = listing.find((bot) => bot.name === `lantern`);
        expect(lantern).toMatchObject({ online: false });
        expect(lantern?.accepts).toBeUndefined();
    }, 60_000);

    it('a rerun plays nothing more and keeps every account as it was', async () => {
        const booted = await boot(true);
        const first = await seed(booted);
        const second = await seed(booted);
        expect(second.played).toBe(0);
        expect(second.accounts.map((account) => [account.name, account.games, account.bots.length, account.banned])).toEqual(
            first.accounts.map((account) => [account.name, account.games, account.bots.length, account.banned]),
        );
        expect(finishes(booted)).toHaveLength(4);
    }, 60_000);

    it('schedules the dev tournament a few minutes out with one bot per owner, and a rerun enters into the same one', async () => {
        const booted = await boot(true);
        const now = Date.now();
        const schedule = (name: string, startsAt: Date) => {
            const answer = booted.admin({
                op: `tournament-create`,
                name,
                startsAt: startsAt.toISOString(),
                timeControl: { mode: `turn`, turnTimeMs: 10_000 },
                openingPlies: 5,
                maxEntrants: 12,
                reason: `dev seed tournament`,
            });
            const id = answer.kind === `done` ? / as (t_[a-z0-9]{12})/.exec(answer.summary)?.[1] : undefined;
            return id === undefined ? Promise.reject(new Error(`not scheduled`)) : Promise.resolve(id);
        };
        const extra = { scheduleTournament: schedule, tournamentCandidates: [{ owner: `devowner-a`, bot: `devbot-a` }], now: () => now };
        const first = await seed(booted, extra);
        expect(first.tournament?.entered).toEqual([`hextide`, `quietlake`]);
        const list = tournamentListSchema.parse(await (await fetch(`${origin}${tournamentsPath}`)).json());
        expect(list.scheduled).toMatchObject([{ id: first.tournament?.id, name: devTournamentName, entrants: 2 }]);
        expect(Date.parse(list.scheduled[0]?.startsAt ?? ``) - now).toBeLessThanOrEqual(devTournamentLeadMs);
        const second = await seed(booted, extra);
        expect(second.tournament).toEqual(first.tournament);
    }, 60_000);

    it('adds the weekly rule once, and a rerun leaves the one rule standing', async () => {
        const booted = await boot(true);
        const addWeeklyRule = (rule: DevWeeklyRule) => {
            const timeControl = parseClockArg(rule.clock);
            if (timeControl === null) return Promise.reject(new Error(`no clock ${rule.clock}`));
            const answer = booted.admin({
                op: `tournament-schedule-add`,
                weekday: rule.weekday,
                time: rule.time,
                namePattern: rule.namePattern,
                timeControl,
                openingPlies: rule.openingPlies,
                maxEntrants: rule.maxEntrants,
                daysAhead: rule.daysAhead,
                reason: `dev seed weekly rule`,
            });
            return answer.kind === `error` && answer.code !== `unchanged` ? Promise.reject(new Error(answer.error)) : Promise.resolve();
        };
        await seed(booted, { addWeeklyRule });
        await seed(booted, { addWeeklyRule });
        const answer = booted.admin({ op: `tournament-schedule-list` });
        expect(answer.kind === `tournament-rules` && answer.rules).toMatchObject([
            { weekday: devWeeklyRule.weekday, time: devWeeklyRule.time, namePattern: devWeeklyRule.namePattern, maxEntrants: devWeeklyRule.maxEntrants },
        ]);
    }, 60_000);

    it('refuses a target without the dev routes and creates nothing', async () => {
        const booted = await boot(false);
        await expect(seed(booted)).rejects.toBeInstanceOf(NotADevServer);
        expect(finishes(booted)).toEqual([]);
        expect(existsSync(tokenFile)).toBe(false);
    });
});
