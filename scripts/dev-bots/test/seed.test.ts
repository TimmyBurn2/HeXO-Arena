import { botListingSchema, botsPath } from '@hexo-arena/contract';
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

    function seed(booted: TestApp): Promise<SeedReport> {
        return seedDevData({
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
        expect(byName.get(`ana`)?.bots.map((bot) => bot.name).sort()).toEqual([`hextide`, `lantern`, `pebble`]);
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

    it('refuses a target without the dev routes and creates nothing', async () => {
        const booted = await boot(false);
        await expect(seed(booted)).rejects.toBeInstanceOf(NotADevServer);
        expect(finishes(booted)).toEqual([]);
        expect(existsSync(tokenFile)).toBe(false);
    });
});
