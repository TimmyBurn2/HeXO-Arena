import { botListingSchema, botsPath, parseClockArg, tournamentDetailSchema, tournamentListSchema, tournamentsPath } from '@hexo-arena/contract';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createQuery } from '../../../apps/server/src/db';
import { games } from '../../../apps/server/src/db/schema';
import { createTestApp, type TestApp } from '../../../apps/server/test/helpers';
import type { SeedPlan } from '../src/personas';
import { NotADevServer } from '../src/runner';
import type { DevEventPlan } from '../src/events';
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
    runs: [{ from: `hextide`, to: `quietlake`, games: [{ timeControl: { mode: `unlimited` }, openingPlies: 1 }] }],
    banned: [`eve`],
};

const tokensSchema = z.record(z.string(), z.string());

// A dev server under test, listening on a port of its own, and the folder its tokens go to.
interface Booted {
    world: TestApp;
    origin: string;
    directory: string;
    tokenFile: string;
}

const booted: Booted[] = [];

// Round robins pause between rounds; a short gap keeps a played-out one to seconds.
async function boot(devLogin: boolean): Promise<Booted> {
    const directory = mkdtempSync(join(tmpdir(), `hexo-arena-dev-seed-`));
    const world = await createTestApp({ devLogin, roundGapMs: 100 });
    const server: Booted = { world, origin: ``, directory, tokenFile: join(directory, `data`, `dev-seed.json`) };
    booted.push(server);
    await world.app.listen({ host: `127.0.0.1`, port: 0 });
    const address = world.app.server.address();
    if (address === null || typeof address === `string`) throw new Error(`no port`);
    server.origin = `http://127.0.0.1:${String(address.port)}`;
    return server;
}

function seed(server: Booted, extra: Partial<Parameters<typeof seedDevData>[0]> = {}): Promise<SeedReport> {
    return seedDevData({
        ...extra,
        origin: server.origin,
        plan,
        tokenFile: server.tokenFile,
        ban: (name) => {
            const answer = server.world.admin({ op: `ban-user`, name, reason: `dev seed persona` });
            return answer.kind === `error` && answer.code !== `unchanged` ? Promise.reject(new Error(answer.error)) : Promise.resolve();
        },
        thinkMs: () => 0,
        paceMs: 0,
        random: Math.random,
        log: () => undefined,
    });
}

function finishes(server: Booted) {
    return createQuery(server.world.sqlite)
        .select({ reason: games.finishReason, user: games.userId })
        .from(games)
        .all();
}

async function read<T>(server: Booted, schema: z.ZodType<T>, path: string): Promise<T> {
    return schema.parse(await (await fetch(`${server.origin}${path}`)).json());
}

// What a world's first seed and its rerun left.
interface Seeded {
    server: Booted;
    first: SeedReport;
    second: SeedReport;
}

const now = Date.now();

// The personas with the dev tournament and the weekly rule.
// The duels and round robins play in a world of their own: their live ones take
// every persona bot but one, which would leave the tournament one owner's bot to enter.
async function seedPersonas() {
    const server = await boot(true);
    const schedule = (name: string, startsAt: Date) => {
        const answer = server.world.admin({
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
    const addWeeklyRule = (rule: DevWeeklyRule) => {
        const timeControl = parseClockArg(rule.clock);
        if (timeControl === null) return Promise.reject(new Error(`no clock ${rule.clock}`));
        const answer = server.world.admin({
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
    const extra = { scheduleTournament: schedule, tournamentCandidates: [{ owner: `devowner-a`, bot: `devbot-a` }], now: () => now, addWeeklyRule };
    const first = await seed(server, extra);
    const firstFinishes = finishes(server);
    const tokens = Object.keys(tokensSchema.parse(JSON.parse(readFileSync(server.tokenFile, `utf8`)))).sort();
    const listing = await read(server, botListingSchema.array(), botsPath);
    const second = await seed(server, extra);
    return { server, first, second, firstFinishes, tokens, listing };
}

// The dev plans at the personas' own bots, shorter, in an order that keeps a person and a bot to two running at once.
const eventPlans: readonly DevEventPlan[] = [
    { name: `finished duel`, creator: `ana`, bots: [`hextide`, `quietlake`], gamesPerPair: 2, left: `played` },
    { name: `test duel`, creator: `ana`, bots: [`hextide`, `pebble`], gamesPerPair: 2, left: `played` },
    { name: `finished round robin`, creator: `bruno`, bots: [`hextide`, `pebble`, `quietlake`], gamesPerPair: 2, left: `played` },
    { name: `test round robin`, creator: `ana`, bots: [`hextide`, `pebble`, `cinder`], gamesPerPair: 2, left: `played` },
    { name: `live duel`, creator: `bruno`, bots: [`pebble`, `quietlake`], gamesPerPair: 10, left: `running` },
    { name: `live round robin`, creator: `dmitri`, bots: [`quietlake`, `cinder`, `pebble`], gamesPerPair: 4, left: `running` },
];

// The app under test leaves its scheduler to the caller, which ticks it as a server does.
async function seedMatches(extra: Partial<Parameters<typeof seedDevData>[0]>): Promise<Seeded> {
    const server = await boot(true);
    server.world.tournaments.start(50);
    const first = await seed(server, extra);
    const second = await seed(server, extra);
    return { server, first, second };
}

function settled<T>(result: PromiseSettledResult<T> | undefined): T {
    if (result === undefined) throw new Error(`not seeded`);
    if (result.status === `rejected`) throw result.reason;
    return result.value;
}

// Each world is seeded once and then once more, both side by side, and the tests read what the runs left;
// a seed takes seconds, so a seed per test made this file the slowest in the repo.
let personas: PromiseSettledResult<Awaited<ReturnType<typeof seedPersonas>>> | undefined;
let events: PromiseSettledResult<Seeded> | undefined;

beforeAll(async () => {
    [personas, events] = await Promise.allSettled([seedPersonas(), seedMatches({ events: eventPlans })]);
}, 60_000);

afterAll(async () => {
    for (const server of booted) {
        server.world.app.server.closeAllConnections();
        await server.world.app.close();
        server.world.sqlite.close();
        rmSync(server.directory, { recursive: true, force: true });
    }
});

describe('the dev seed', () => {
    it('builds the personas, their bots, and a history over the real routes', () => {
        const { first, firstFinishes, tokens, listing } = settled(personas);
        expect(first.accounts.map((account) => account.name)).toEqual([`ana`, `bruno`, `cleo`, `dmitri`, `eve`]);
        const byName = new Map(first.accounts.map((account) => [account.name, account]));
        expect(byName.get(`ana`)?.bots.map((bot) => bot.name).sort()).toEqual([`cinder`, `hextide`, `lantern`, `pebble`, `tarn`]);
        expect(byName.get(`dmitri`)?.bots.map((bot) => bot.name)).toEqual([`quietlake`]);
        expect(byName.get(`cleo`)).toMatchObject({ games: 0, bots: [] });
        expect(byName.get(`eve`)).toMatchObject({ banned: true, games: 1 });
        expect(byName.get(`bruno`)).toMatchObject({ banned: false, games: 1 });
        expect(byName.get(`ana`)?.bots.find((bot) => bot.name === `hextide`)?.vsBots).toBe(1);
        expect(first.played).toBe(4);
        expect(first.ranked).toEqual([]);
        expect(firstFinishes.map((game) => game.reason).sort()).toEqual([`six-in-a-row`, `six-in-a-row`, `surrender`, `timeout`]);

        expect(tokens).toEqual([`cinder`, `hextide`, `pebble`, `quietlake`]);
        expect(listing.find((bot) => bot.name === `hextide`)).toMatchObject({ version: `1.4.0`, accepts: { unlimited: false } });
        const lantern = listing.find((bot) => bot.name === `lantern`);
        expect(lantern).toMatchObject({ online: false });
        expect(lantern?.accepts).toBeUndefined();
    });

    it('a rerun plays nothing more and keeps every account as it was', () => {
        const { server, first, second } = settled(personas);
        expect(second.played).toBe(0);
        expect(second.accounts.map((account) => [account.name, account.games, account.bots.length, account.banned])).toEqual(
            first.accounts.map((account) => [account.name, account.games, account.bots.length, account.banned]),
        );
        expect(finishes(server)).toHaveLength(4);
    });

    it('schedules the dev tournament a few minutes out with one bot per owner, and a rerun enters into the same one', async () => {
        const { server, first, second } = settled(personas);
        expect(first.tournament?.entered).toEqual([`hextide`, `quietlake`]);
        const list = await read(server, tournamentListSchema, tournamentsPath);
        expect(list.scheduled.filter((entry) => entry.name === devTournamentName)).toMatchObject([{ id: first.tournament?.id, entrants: 2 }]);
        const scheduled = list.scheduled.find((entry) => entry.id === first.tournament?.id);
        expect(Date.parse(scheduled?.startsAt ?? ``) - now).toBeLessThanOrEqual(devTournamentLeadMs);
        expect(second.tournament).toEqual(first.tournament);
    });

    it('adds the weekly rule once, and a rerun leaves the one rule standing', () => {
        const { server } = settled(personas);
        const answer = server.world.admin({ op: `tournament-schedule-list` });
        expect(answer.kind === `tournament-rules` && answer.rules).toMatchObject([
            { weekday: devWeeklyRule.weekday, time: devWeeklyRule.time, namePattern: devWeeklyRule.namePattern, maxEntrants: devWeeklyRule.maxEntrants },
        ]);
    });

    it('plays a duel, a round robin, and a test of each out through the tournaments, leaves a duel and a round robin running, and a rerun sets none up again', async () => {
        const { server, first, second } = settled(events);
        const tournament = (name: string) => read(server, tournamentDetailSchema, `/api/tournaments/${first.events?.[name] ?? ``}`);
        const duel = await tournament(`finished duel`);
        expect(duel).toMatchObject({ format: `duel`, origin: `person`, createdBy: `ana`, rated: false, test: false, status: `finished`, gamesPerPair: 2 });
        expect(duel.rounds[0]?.pairings[0]?.games.map((game) => game.outcome)).toEqual([`played`, `played`]);
        const test = await tournament(`test duel`);
        expect(test).toMatchObject({ format: `duel`, test: true, status: `finished` });
        expect(test.entries.map((entry) => [entry.bot, entry.version])).toEqual([
            [`hextide`, `1.4.0`],
            [`pebble`, `0.3.1`],
        ]);
        expect(test.estimates?.[0]?.estimate.games).toBe(2);
        const field = await tournament(`finished round robin`);
        expect(field).toMatchObject({ format: `round_robin`, createdBy: `bruno`, test: false, status: `finished`, name: `Round robin by bruno` });
        expect(field.standings.reduce((sum, line) => sum + line.points, 0)).toBeGreaterThan(0);
        const fieldTest = await tournament(`test round robin`);
        expect(fieldTest).toMatchObject({ test: true, status: `finished`, createdBy: `ana` });
        expect(fieldTest.estimates).toHaveLength(3);
        expect((await tournament(`live duel`)).status).toBe(`running`);
        expect((await tournament(`live round robin`)).status).toBe(`running`);
        expect(second.events).toEqual(first.events);
    });

    it('refuses a target without the dev routes and creates nothing', async () => {
        const server = await boot(false);
        await expect(seed(server)).rejects.toBeInstanceOf(NotADevServer);
        expect(finishes(server)).toEqual([]);
        expect(existsSync(server.tokenFile)).toBe(false);
    });
});
