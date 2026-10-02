import { tournamentPresenceGraceMs, tournamentRoundGapMs } from '@hexo-arena/contract';
import http from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { retireGeneration } from '../src/site-state';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const owners = [`ann`, `bob`, `cid`, `dee`] as const;
const botNames = [`alpha`, `beta`, `gamma`, `delta`] as const;
type BotName = (typeof botNames)[number];

const accepts = { turnMs: [5_000, 60_000], match: true, unlimited: true };

interface Pairing {
    id: string;
    round: number;
    first: string;
    second: string;
    game1: string;
    game1_seat: string | null;
    game2: string;
    game2_seat: string | null;
    opening_cells: string | null;
}

describe('the tournament scheduler', () => {
    let world: TestApp;
    let clock: number;
    const tokens = new Map<BotName, string>();
    const streams = new Map<BotName, FakeStreamSocket>();
    let tournamentId: string;

    function botId(name: string): string {
        const bot = findBot(createQuery(world.sqlite), name);
        if (bot === undefined) throw new Error(`no bot ${name}`);
        return bot.id;
    }

    function nameOf(id: string): string {
        return (world.sqlite.prepare(`select name from bots where id = ?`).get(id) as { name: string }).name;
    }

    async function setUp(sqlite?: TestApp[`sqlite`]): Promise<void> {
        world = await createTestApp({ logger: false, now: () => clock, ...(sqlite === undefined ? {} : { sqlite }) });
    }

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 1, 12);
        await setUp();
        for (const [index, owner] of owners.entries()) {
            const session = await loginAs(world.app, owner);
            const name = botNames[index] ?? `alpha`;
            const token = await mintBot(world.app, session, name);
            tokens.set(name, token);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts } });
        }
        const created = world.admin({
            op: `tournament-create`,
            name: `Autumn round robin`,
            startsAt: new Date(clock + 120_000).toISOString(),
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            maxEntrants: 12,
            reason: `test`,
        });
        if (created.kind !== `done`) throw new Error(`no tournament`);
        tournamentId = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
    });

    afterEach(async () => {
        await world.app.close();
        streams.clear();
    });

    function enter(...names: BotName[]): void {
        for (const name of names) {
            const id = botId(name);
            const owner = (world.sqlite.prepare(`select owner_id from bots where id = ?`).get(id) as { owner_id: string }).owner_id;
            world.sqlite
                .prepare(`insert into tournament_entries (tournament_id, bot_id, owner_id, entered_at) values (?, ?, ?, 1)`)
                .run(tournamentId, id, owner);
        }
    }

    function online(...names: BotName[]): void {
        for (const name of names) {
            const stream = new FakeStreamSocket();
            streams.set(name, stream);
            world.presence.attach(botId(name), stream, false);
        }
    }

    function offline(name: BotName): void {
        world.presence.close(botId(name));
    }

    function tick(at: number): void {
        clock = at;
        world.tournaments.tick();
    }

    function status(): string {
        return (world.sqlite.prepare(`select status from tournaments where id = ?`).get(tournamentId) as { status: string }).status;
    }

    function entries(): Record<string, { state: string; reason: string | null }> {
        const rows = world.sqlite.prepare(`select bot_id, state, reason from tournament_entries`).all() as { bot_id: string; state: string; reason: string | null }[];
        return Object.fromEntries(rows.map((row) => [nameOf(row.bot_id), { state: row.state, reason: row.reason }]));
    }

    function pairings(): Pairing[] {
        return (
            world.sqlite
                .prepare(`select id, round, first_bot_id as first, second_bot_id as second, game1, game1_seat, game2, game2_seat, opening_cells from tournament_pairings order by round, id`)
                .all() as Pairing[]
        ).map((row) => ({ ...row, first: nameOf(row.first), second: nameOf(row.second) }));
    }

    // The latest gameStart a bot heard for a game, with its token.
    function gameStarts(name: BotName): { gameId: string; side: string; token: string }[] {
        return (streams.get(name)?.writes ?? [])
            .filter((line) => line.includes(`"gameStart"`))
            .map((line) => JSON.parse(line) as { gameId: string; side: string; engine: { token: string } })
            .map((event) => ({ gameId: event.gameId, side: event.side, token: event.engine.token }));
    }

    async function resign(name: BotName): Promise<void> {
        const start = gameStarts(name).at(-1);
        if (start === undefined) throw new Error(`${name} heard no gameStart`);
        const answer = await world.app.inject({ method: `POST`, url: `/api/bot/game/${start.gameId}/resign`, headers: { authorization: `Bearer ${start.token}` } });
        expect(answer.statusCode).toBe(200);
    }

    // Resigns every live tournament game for its x bot, so its o bot wins.
    async function finishLive(): Promise<void> {
        for (const row of pairings()) {
            const live = row.game1 === `live` ? 1 : row.game2 === `live` ? 2 : null;
            if (live !== null) await resign((live === 1 ? row.first : row.second) as BotName);
        }
    }

    function gameRow(gameId: string): { challenger: string; dest: string; side: string; opening: string; rated: number } {
        const row = world.sqlite
            .prepare(`select challenger_bot_id as challenger, dest_bot_id as dest, challenger_side as side, opening_cells as opening from games where id = ?`)
            .get(gameId) as { challenger: string; dest: string; side: string; opening: string };
        return { ...row, challenger: nameOf(row.challenger), dest: nameOf(row.dest), rated: 1 };
    }

    const start = () => Date.UTC(2026, 9, 1, 12) + 120_000;

    it('waits for its start, then plays the connected entrants and marks the rest absent', () => {
        enter(`alpha`, `beta`, `gamma`, `delta`);
        online(`alpha`, `beta`, `gamma`);
        tick(start() - 1_000);
        expect(status()).toBe(`scheduled`);
        tick(start());
        expect(status()).toBe(`running`);
        expect(entries()).toEqual({
            alpha: { state: `playing`, reason: null },
            beta: { state: `playing`, reason: null },
            gamma: { state: `playing`, reason: null },
            delta: { state: `absent`, reason: null },
        });
        // Three bots: three rounds of one pairing, each bot resting once.
        expect(pairings().map((row) => row.round)).toEqual([1, 2, 3]);
        const ratings = world.sqlite.prepare(`select rating_at_start from tournament_entries where state = 'playing'`).all();
        expect(ratings).toEqual([{ rating_at_start: 1500 }, { rating_at_start: 1500 }, { rating_at_start: 1500 }]);
    });

    it('calls the tournament off when fewer than three entrants can play', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`);
        tick(start());
        expect(status()).toBe(`called_off`);
        expect(entries()).toMatchObject({ alpha: { state: `entered` }, beta: { state: `entered` }, gamma: { state: `absent` } });
        expect(pairings()).toEqual([]);
    });

    it('leaves out a bot that does not accept the clock', async () => {
        await world.app.inject({
            method: `PATCH`,
            url: `/api/bot/account`,
            headers: { authorization: `Bearer ${tokens.get(`delta`) ?? ``}` },
            payload: { accepts: { turnMs: [20_000, 60_000], match: false, unlimited: false } },
        });
        enter(`alpha`, `beta`, `gamma`, `delta`);
        online(`alpha`, `beta`, `gamma`, `delta`);
        tick(start());
        expect(entries().delta).toEqual({ state: `left_out`, reason: `clock` });
    });

    it('announces game 1 on both streams with no challenge, rated, and game 2 from the same opening with the sides swapped', async () => {
        enter(`alpha`, `beta`, `gamma`, `delta`);
        online(`alpha`, `beta`, `gamma`, `delta`);
        tick(start());
        expect(pairings()[0]?.game1).toBe(`pending`);
        tick(start() + 1_000);
        const [first] = pairings();
        if (first === undefined) throw new Error(`no pairing`);
        expect(first.game1).toBe(`live`);
        const firstBot = first.first as BotName;
        const secondBot = first.second as BotName;
        const one = gameStarts(firstBot).at(-1);
        expect(one?.side).toBe(`x`);
        expect(gameStarts(secondBot).at(-1)?.side).toBe(`o`);
        expect(streams.get(firstBot)?.writes.some((line) => line.includes(`"challenge"`))).toBe(false);
        expect(streams.get(firstBot)?.writes.join(``)).toContain(`"rated":true`);
        await resign(secondBot);
        expect(pairings()[0]).toMatchObject({ game1: `played`, game1_seat: `first`, game2: `pending` });
        tick(start() + 2_000);
        const two = gameStarts(secondBot).at(-1);
        expect(two?.side).toBe(`x`);
        expect(two?.gameId).not.toBe(one?.gameId);
        const [gameOne, gameTwo] = [gameRow(one?.gameId ?? ``), gameRow(two?.gameId ?? ``)];
        expect(gameTwo.opening).toBe(gameOne.opening);
        expect(gameTwo.challenger).toBe(secondBot);
        expect(gameOne.challenger).toBe(firstBot);
        expect(JSON.parse(first.opening_cells ?? `[]`)).toHaveLength(5);
    });

    it('scores a no-show for the bot that came once the grace runs out, and both missing for nobody', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        const [first, second] = pairings();
        if (first === undefined || second === undefined) throw new Error(`no pairings`);
        offline(first.second as BotName);
        tick(start() + 1_000);
        tick(start() + 1_000 + tournamentPresenceGraceMs - 1);
        expect(pairings()[0]?.game1).toBe(`pending`);
        tick(start() + 1_000 + tournamentPresenceGraceMs);
        expect(pairings()[0]).toMatchObject({ game1: `no_show`, game1_seat: `second`, game2: `pending` });
        offline(first.first as BotName);
        tick(start() + 2_000 + 2 * tournamentPresenceGraceMs);
        expect(pairings()[0]).toMatchObject({ game2: `no_show`, game2_seat: `both` });
    });

    it('withdraws a bot that misses two pairings in a row, its remaining games scoring for its opponents', async () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        offline(`gamma`);
        let at = start();
        for (let step = 0; step < 12; step++) {
            at += tournamentPresenceGraceMs + tournamentRoundGapMs;
            tick(at);
            await finishLive();
            tick(at + 1);
        }
        expect(status()).toBe(`finished`);
        expect(entries().gamma).toEqual({ state: `withdrawn`, reason: `missed` });
        const gammaRows = pairings().filter((row) => row.first === `gamma` || row.second === `gamma`);
        expect(gammaRows.map((row) => [row.game1, row.game2])).toEqual([
            [`no_show`, `no_show`],
            [`no_show`, `no_show`],
        ]);
    });

    it('answers bot_busy to challenges and human games touching a playing bot until the tournament ends', async () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`, `delta`);
        tick(start());
        world.presence.attach(botId(`alpha`), new FakeStreamSocket(), true);
        const challenge = await world.app.inject({
            method: `POST`,
            url: `/api/bot/challenge/alpha`,
            headers: { authorization: `Bearer ${tokens.get(`delta`) ?? ``}` },
            payload: { timeControl: { mode: `unlimited` }, requestId: `r1` },
        });
        expect(challenge.statusCode).toBe(400);
        expect(challenge.json()).toMatchObject({ code: `bot_busy` });
        const human = await world.app.inject({
            method: `POST`,
            url: `/api/games`,
            cookies: { hexo_arena_session: await loginAs(world.app, `eve`) },
            payload: { bot: `alpha`, timeControl: { mode: `unlimited` } },
        });
        expect(human.statusCode).toBe(400);
        expect(human.json()).toMatchObject({ code: `bot_busy` });
        expect(world.tournaments.isReserved(botId(`delta`))).toBe(false);
    });

    it('starts no tournament while the site is paused, and starts it on the first tick after the resume', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        world.admin({ op: `pause`, reason: `incident` });
        tick(start());
        tick(start() + 60_000);
        expect(status()).toBe(`scheduled`);
        expect(Object.values(entries()).map((entry) => entry.state)).toEqual([`entered`, `entered`, `entered`]);
        world.admin({ op: `resume`, reason: `over` });
        tick(start() + 61_000);
        expect(status()).toBe(`running`);
        expect(entries()).toMatchObject({ alpha: { state: `playing` }, beta: { state: `playing` }, gamma: { state: `playing` } });
    });

    it('admits a reserved bot\'s stream while the site is paused', async () => {
        enter(`alpha`, `beta`, `gamma`, `delta`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        world.admin({ op: `pause`, reason: `incident` });
        offline(`alpha`);
        const address = await world.app.listen({ host: `127.0.0.1`, port: 0 });
        const statusOf = (name: BotName) =>
            new Promise<number>((resolve, reject) => {
                const request = http.get(`${address}/api/bot/stream`, { headers: { authorization: `Bearer ${tokens.get(name) ?? ``}` } }, (response) => {
                    resolve(response.statusCode ?? 0);
                    request.destroy();
                });
                request.on(`error`, reject);
            });
        expect(await statusOf(`alpha`)).toBe(200);
        expect(await statusOf(`delta`)).toBe(503);
    });

    it('starts no game while the site is paused, and plays on after the resume', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        world.admin({ op: `pause`, reason: `incident` });
        tick(start() + 1_000);
        expect(pairings()[0]?.game1).toBe(`pending`);
        world.admin({ op: `resume`, reason: `over` });
        tick(start() + 2_000);
        expect(pairings()[0]?.game1).toBe(`live`);
    });

    it('scores an aborted game as no point for either side, with no replay', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        tick(start() + 1_000);
        const first = pairings()[0];
        const gameId = gameStarts(first?.first as BotName).at(-1)?.gameId ?? ``;
        expect(world.admin({ op: `abort-game`, gameId, reason: `bug` })).toMatchObject({ kind: `done` });
        expect(pairings()[0]).toMatchObject({ game1: `aborted`, game1_seat: null });
    });

    it('replays a game the deploy cut once at the next boot, from its opening and sides', async () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        tick(start() + 1_000);
        const first = pairings()[0];
        const cut = gameStarts(first?.first as BotName).at(-1)?.gameId ?? ``;
        // The deploy retires this process, and its drain aborts what is live.
        const generation = (world.sqlite.prepare(`select generation from site_state`).get() as { generation: number }).generation;
        retireGeneration(createQuery(world.sqlite), generation);
        await world.drain(0);
        expect(pairings()[0]?.game1).toBe(`live`);
        const { sqlite } = world;
        await world.app.close();
        await setUp(sqlite);
        expect(pairings()[0]?.game1).toBe(`pending`);
        online(`alpha`, `beta`, `gamma`);
        tick(start() + 5_000);
        const replay = gameStarts(first?.first as BotName).at(-1);
        expect(replay?.gameId).not.toBe(cut);
        expect(gameRow(replay?.gameId ?? ``).opening).toBe(gameRow(cut).opening);
        expect(gameRow(replay?.gameId ?? ``).challenger).toBe(first?.first);
        // A second cut is not replayed: the game scores for no one.
        const again = (world.sqlite.prepare(`select generation from site_state`).get() as { generation: number }).generation;
        retireGeneration(createQuery(world.sqlite), again);
        await world.drain(0);
        const second = world.sqlite;
        await world.app.close();
        await setUp(second);
        expect(pairings()[0]).toMatchObject({ game1: `aborted` });
    });

    it('withdraws the bots of a banned owner, its games still to come scoring for the opponents', async () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        world.admin({ op: `ban-user`, name: `cid`, reason: `abuse` });
        expect(entries().gamma).toEqual({ state: `withdrawn`, reason: `banned` });
        let at = start();
        for (let step = 0; step < 8; step++) {
            at += tournamentRoundGapMs + 1_000;
            tick(at);
            await finishLive();
            tick(at + 1);
        }
        expect(status()).toBe(`finished`);
        const gammaRows = pairings().filter((row) => row.first === `gamma` || row.second === `gamma`);
        expect(gammaRows).toHaveLength(2);
        for (const row of gammaRows) {
            const seat = row.first === `gamma` ? `first` : `second`;
            expect(row).toMatchObject({ game1: `forfeit`, game1_seat: seat, game2: `forfeit`, game2_seat: seat });
        }
    });

    it('cancels a running tournament, aborting its live games unrated', () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        tick(start() + 1_000);
        const answer = world.admin({ op: `tournament-cancel`, id: tournamentId, reason: `storm` });
        expect(answer).toMatchObject({ kind: `done` });
        expect(answer.kind === `done` && answer.summary).toContain(`1 live games aborted`);
        expect(status()).toBe(`canceled`);
        expect(world.sqlite.prepare(`select count(*) as n from games where finish_reason = 'aborted'`).get()).toEqual({ n: 1 });
        expect(pairings()[0]?.game1).toBe(`live`);
    });

    it('finishes once every game is over, waiting the gap between rounds', async () => {
        enter(`alpha`, `beta`, `gamma`);
        online(`alpha`, `beta`, `gamma`);
        tick(start());
        let at = start();
        for (const round of [1, 2, 3]) {
            at += round === 1 ? 1_000 : tournamentRoundGapMs;
            tick(at - 1);
            if (round > 1) expect(pairings().find((row) => row.round === round)?.game1).toBe(`pending`);
            tick(at);
            for (const game of [1, 2]) {
                const row = pairings().find((candidate) => candidate.round === round);
                if (row === undefined) throw new Error(`no round ${String(round)}`);
                expect(game === 1 ? row.game1 : row.game2).toBe(`live`);
                await resign((game === 1 ? row.second : row.first) as BotName);
                at += 1_000;
                tick(at);
            }
        }
        expect(status()).toBe(`finished`);
    });
});
