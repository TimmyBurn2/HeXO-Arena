import { analysisPositionsPath, botAccountPath, botListingSchema, botsPath, gamesPath, positionReadingSchema, undeclaredValues } from '@hexo-arena/contract';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createQuery } from '../../../apps/server/src/db';
import { games } from '../../../apps/server/src/db/schema';
import { createTestApp, loginAs, mintBot, type TestApp } from '../../../apps/server/test/helpers';
import { devAnalyzer } from '../src/analyzer';
import { devLevels } from '../src/levels';
import { NotADevServer, saveTokens, startDevBots, type DevBots } from '../src/runner';

// mulberry32, so a failing game replays move for move.
function seeded(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
    };
}

async function until(predicate: () => boolean, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error(`condition not reached in ${String(timeoutMs)} ms`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

const tokensSchema = z.record(z.string(), z.string());

describe('the dev bot runner', () => {
    let directory: string;
    let tokenFile: string;
    let seedFile: string;
    let world: TestApp | null;
    let origin: string;
    let running: DevBots[];
    let lines: string[];

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), `hexo-arena-dev-bots-`));
        tokenFile = join(directory, `data`, `dev-bots.json`);
        seedFile = join(directory, `data`, `dev-seed.json`);
        world = null;
        running = [];
        lines = [];
    });

    afterEach(async () => {
        await Promise.all(running.map((bots) => bots.stop()));
        if (world !== null) {
            world.app.server.closeAllConnections();
            await world.app.close();
            world.sqlite.close();
        }
        rmSync(directory, { recursive: true, force: true });
    });

    async function boot(devLogin: boolean): Promise<TestApp> {
        const booted = await createTestApp({ devLogin });
        world = booted;
        await booted.app.listen({ host: `127.0.0.1`, port: 0 });
        const address = booted.app.server.address();
        if (address === null || typeof address === `string`) throw new Error(`no port`);
        origin = `http://127.0.0.1:${String(address.port)}`;
        return booted;
    }

    async function start(): Promise<DevBots> {
        const bots = await startDevBots({
            origin,
            count: 2,
            tokenFile,
            seedFile,
            challengeEveryMs: 60_000,
            thinkMs: () => 0,
            random: seeded(7),
            log: (line) => {
                lines.push(line);
            },
        });
        running.push(bots);
        return bots;
    }

    async function directoryNames(): Promise<string[]> {
        const listing = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}`)).json());
        return listing.map((bot) => bot.name).sort();
    }

    function tokens(): Record<string, string> {
        return tokensSchema.parse(JSON.parse(readFileSync(tokenFile, `utf8`)));
    }

    it('two runner bots complete a bot-vs-bot game through the real routes', async () => {
        const booted = await boot(true);
        await start();
        const finished = () =>
            createQuery(booted.sqlite)
                .select({ winner: games.winner, reason: games.finishReason, challenger: games.challengerBotId })
                .from(games)
                .all()
                .filter((game) => game.reason !== null);
        await until(() => finished().length > 0, 20_000);
        const [game] = finished();
        expect(game?.challenger).not.toBe(null);
        expect(game?.reason).toBe(`six-in-a-row`);
        expect(game?.winner).toMatch(/^[xo]$/);
        const listing = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}`)).json());
        expect(listing.map((bot) => bot.name).sort()).toEqual([`devbot-a`, `devbot-b`]);
        // A decided game moves both ratings off the seed.
        for (const bot of listing) expect(bot.rating).not.toBe(1500);
        expect(lines.some((line) => line.includes(`finished`))).toBe(true);
    }, 30_000);

    it('a rerun keeps its bots and rotates their tokens', async () => {
        await boot(true);
        await (await start()).stop();
        const before = tokens();
        await (await start()).stop();
        const after = tokens();
        expect(Object.keys(after).sort()).toEqual([`devbot-a`, `devbot-b`]);
        expect(await directoryNames()).toEqual([`devbot-a`, `devbot-b`]);
        expect(statSync(tokenFile).mode & 0o777).toBe(0o600);
        for (const name of [`devbot-a`, `devbot-b`]) {
            const account = (token: string | undefined) =>
                fetch(`${origin}${botAccountPath}`, { headers: { authorization: `Bearer ${token ?? ``}` } });
            expect(after[name]).not.toBe(before[name]);
            expect((await account(before[name])).status).toBe(401);
            expect((await account(after[name])).status).toBe(200);
        }
    });

    it('brings the seeded personas\' online bots up beside its own, and never lantern', async () => {
        const booted = await boot(true);
        const ana = await loginAs(booted.app, `ana`);
        saveTokens(
            seedFile,
            new Map([
                [`hextide`, await mintBot(booted.app, ana, `hextide`)],
                [`lantern`, await mintBot(booted.app, ana, `lantern`)],
            ]),
        );
        const bots = await start();
        expect(bots.names).toEqual([`devbot-a`, `devbot-b`, `hextide`]);
        const deadline = Date.now() + 5_000;
        let online: string[] = [];
        while (!online.includes(`hextide`) && Date.now() < deadline) {
            const listing = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}?online=1`)).json());
            online = listing.map((bot) => bot.name);
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(online).toContain(`hextide`);
        expect(online).not.toContain(`lantern`);
    });

    it('declares three strengths, and plays a game at the strength a person picks', async () => {
        const booted = await boot(true);
        await start();
        const listing = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}`)).json());
        for (const bot of listing) expect(bot.levels).toEqual(devLevels);
        const quinn = await loginAs(booted.app, `quinn`);
        let online: string[] = [];
        while (!online.includes(`devbot-a`)) {
            online = botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}?online=1`)).json()).map((bot) => bot.name);
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const created = await booted.app.inject({
            method: `POST`,
            url: gamesPath,
            cookies: { hexo_arena_session: quinn },
            payload: { bot: `devbot-a`, timeControl: { mode: `unlimited` }, level: `quick` },
        });
        expect(created.statusCode).toBe(201);
        await until(() => lines.some((line) => /^devbot-a plays quinn as [xo] in g_\S+ at quick$/u.test(line)), 5_000);
    });

    it('reads a person\'s position on its analyzer bot through the real routes', async () => {
        const booted = await boot(true);
        await start();
        const ready = async () => botListingSchema.array().parse(await (await fetch(`${origin}${botsPath}?analyzer=1`)).json());
        let analyzers = await ready();
        while (analyzers[0]?.analyzer?.ready !== true) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            analyzers = await ready();
        }
        expect(analyzers.map((bot) => [bot.name, bot.analyzer])).toEqual([[`devbot-a`, { ...devAnalyzer, values: undeclaredValues, ready: true }]]);
        const quinn = await loginAs(booted.app, `quinn`);
        const cells = [
            { x: 0, y: 0, side: `x` },
            { x: 1, y: 0, side: `o` },
            { x: 0, y: 1, side: `o` },
        ];
        const read = await booted.app.inject({
            method: `POST`,
            url: analysisPositionsPath,
            cookies: { hexo_arena_session: quinn },
            payload: { cells, toMove: `x`, analyzer: `devbot-a`, lines: 3, seconds: 1 },
        });
        expect(read.statusCode).toBe(200);
        const reading = positionReadingSchema.parse(read.json());
        expect(reading).toMatchObject({ status: `done`, analyzer: { name: `devbot-a` }, seconds: 1, cached: false });
        expect(reading.status === `done` ? reading.lines.length : 0).toBe(3);
    });

    it('refuses a target without the dev login route and creates nothing', async () => {
        await boot(false);
        await expect(start()).rejects.toBeInstanceOf(NotADevServer);
        expect(await directoryNames()).toEqual([]);
        expect(existsSync(tokenFile)).toBe(false);
    });
});
