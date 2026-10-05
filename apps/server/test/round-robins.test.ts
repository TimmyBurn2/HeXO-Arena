import {
    accountExportSchema,
    finishedGamesPageSchema,
    gameSnapshotSchema,
    presenceGraceMs,
    tournamentBotStatesSchema,
    tournamentDetailMemoMs,
    tournamentDetailSchema,
    tournamentListSchema,
    tournamentRoundGapMs,
    type TournamentDetail,
} from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { readRating } from '../src/rating-store';
import { retireGeneration } from '../src/site-state';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const turn = { mode: `turn`, turnTimeMs: 30_000 } as const;
const accepts = { turnMs: [5_000, 60_000], match: true, unlimited: true };
const bots = [`alpha`, `aster`, `axe`, `beta`, `gamma`, `delta`] as const;
type BotName = (typeof bots)[number];
const ownerOf: Record<BotName, string> = { alpha: `ann`, aster: `ann`, axe: `ann`, beta: `bob`, gamma: `cid`, delta: `dee` };

interface GameRow {
    id: string;
    pairing: string;
    game: number;
    leg: number;
    round: number;
    x: string;
    o: string;
    opening: string;
    reason: string | null;
    unrated: number;
    test: number;
}

describe('round robins people set up', () => {
    let world: TestApp;
    let clock: number;
    const sessions = new Map<string, string>();
    const tokens = new Map<BotName, string>();
    const streams = new Map<BotName, FakeStreamSocket>();

    async function setUp(sqlite?: TestApp[`sqlite`]): Promise<void> {
        world = await createTestApp({ now: () => clock, ...(sqlite === undefined ? {} : { sqlite }) });
    }

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 4, 12);
        await setUp();
        for (const person of [`ann`, `bob`, `cid`, `dee`, `eve`]) sessions.set(person, await loginAs(world.app, person));
        for (const name of bots) {
            const token = await mintBot(world.app, session(ownerOf[name]), name);
            tokens.set(name, token);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts, version: `1.0.${String(bots.indexOf(name))}` } });
        }
        online(...bots);
    });

    afterEach(async () => {
        await world.app.close();
        world.sqlite.close();
        streams.clear();
    });

    function session(person: string): string {
        const cookie = sessions.get(person);
        if (cookie === undefined) throw new Error(`${person} is not signed in`);
        return cookie;
    }

    function botId(name: string): string {
        const bot = findBot(createQuery(world.sqlite), name);
        if (bot === undefined) throw new Error(`no bot ${name}`);
        return bot.id;
    }

    function nameOf(id: string): string {
        return (world.sqlite.prepare(`select name from bots where id = ?`).get(id) as { name: string }).name;
    }

    function online(...names: BotName[]): void {
        for (const name of names) {
            const stream = new FakeStreamSocket();
            streams.set(name, stream);
            world.presence.attach(botId(name), stream, true);
        }
    }

    function closed(name: BotName): void {
        const stream = new FakeStreamSocket();
        streams.set(name, stream);
        world.presence.attach(botId(name), stream, false);
    }

    function token(name: BotName): string {
        const held = tokens.get(name);
        if (held === undefined) throw new Error(`no token for ${name}`);
        return held;
    }

    function offline(...names: BotName[]): void {
        for (const name of names) world.presence.close(botId(name));
    }

    function create(person: string | null, names: readonly string[], extra: Record<string, unknown> = {}) {
        return world.app.inject({
            method: `POST`,
            url: `/api/tournaments`,
            ...(person === null ? {} : { cookies: { hexo_arena_session: session(person) } }),
            payload: { bots: names.map((name) => ({ name })), timeControl: turn, ...extra },
        });
    }

    async function started(person: string, names: readonly string[], extra: Record<string, unknown> = {}): Promise<TournamentDetail> {
        const answer = await create(person, names, extra);
        if (answer.statusCode !== 201) throw new Error(`no round robin: ${answer.body}`);
        return tournamentDetailSchema.parse(answer.json());
    }

    // Past the memo window, so each read sees the round robin as it stands.
    async function read(id: string): Promise<TournamentDetail> {
        clock += tournamentDetailMemoMs;
        const answer = await world.app.inject({ method: `GET`, url: `/api/tournaments/${id}` });
        expect(answer.statusCode).toBe(200);
        return tournamentDetailSchema.parse(answer.json());
    }

    function tick(at?: number): void {
        if (at !== undefined) clock = at;
        world.tournaments.tick();
    }

    function post(person: string, url: string, payload?: Record<string, unknown>) {
        return world.app.inject({ method: `POST`, url, cookies: { hexo_arena_session: session(person) }, ...(payload === undefined ? {} : { payload }) });
    }

    function gameRows(id: string): GameRow[] {
        return (
            world.sqlite
                .prepare(
                    `select g.id, g.pairing_id as pairing, g.pairing_game as game, p.leg, p.round, g.challenger_bot_id as x, g.dest_bot_id as o, g.opening_cells as opening, g.finish_reason as reason, g.unrated_by_choice as unrated, g.test
                     from games g join tournament_pairings p on p.id = g.pairing_id where p.tournament_id = ? order by g.rowid`,
                )
                .all(id) as GameRow[]
        ).map((row) => ({ ...row, x: nameOf(row.x), o: nameOf(row.o) }));
    }

    function liveRows(id: string): GameRow[] {
        return gameRows(id).filter((row) => row.reason === null);
    }

    function entries(id: string): Record<string, { state: string; reason: string | null }> {
        const rows = world.sqlite.prepare(`select bot_id, state, reason from tournament_entries where tournament_id = ?`).all(id) as { bot_id: string; state: string; reason: string | null }[];
        return Object.fromEntries(rows.map((row) => [nameOf(row.bot_id), { state: row.state, reason: row.reason }]));
    }

    function stored(id: string): { status: string; reason: string | null } {
        return world.sqlite.prepare(`select status, end_reason as reason from tournaments where id = ?`).get(id) as { status: string; reason: string | null };
    }

    function gameStart(name: string, gameId: string): { rated: boolean; token: string } {
        const line = (streams.get(name as BotName)?.writes ?? []).filter((each) => each.includes(`"gameStart"`) && each.includes(gameId)).at(-1);
        if (line === undefined) throw new Error(`${name} heard no gameStart for ${gameId}`);
        const event = JSON.parse(line) as { rated: boolean; engine: { token: string } };
        return { rated: event.rated, token: event.engine.token };
    }

    // The x bot resigns, so the o bot wins.
    async function resignX(row: GameRow): Promise<void> {
        const answer = await world.app.inject({
            method: `POST`,
            url: `/api/bot/game/${row.id}/resign`,
            headers: { authorization: `Bearer ${gameStart(row.x, row.id).token}` },
        });
        expect(answer.statusCode).toBe(200);
    }

    // Plays the round robin to its end, x resigning every live game, each pass past a round's gap.
    async function playOut(id: string, passes = 60): Promise<void> {
        for (let pass = 0; pass < passes && stored(id).status === `running`; pass++) {
            for (const row of liveRows(id)) await resignX(row);
            tick(clock + tournamentRoundGapMs);
        }
        expect(stored(id).status).not.toBe(`running`);
    }

    function enterWeekly(...names: BotName[]): string {
        const created = world.admin({
            op: `tournament-create`,
            name: `Autumn weekly`,
            startsAt: new Date(clock + 3_600_000).toISOString(),
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
            maxEntrants: 12,
            reason: `test`,
        });
        if (created.kind !== `done`) throw new Error(`no weekly`);
        const id = (world.sqlite.prepare(`select id from tournaments where origin = 'operator'`).get() as { id: string }).id;
        for (const name of names) {
            world.sqlite.prepare(`insert into tournament_entries (tournament_id, bot_id, owner_id, entered_at) values (?, ?, (select owner_id from bots where id = ?), 1)`).run(id, botId(name), botId(name));
        }
        return id;
    }

    describe('setting one up', () => {
        it('starts a round robin of the picked bots at once, its first round under way, each game announced with no challenge and never rated', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            expect(detail).toMatchObject({
                name: `Round robin by eve`,
                origin: `person`,
                format: `round_robin`,
                createdBy: `eve`,
                rated: false,
                test: false,
                gamesPerPair: 2,
                status: `running`,
                timeControl: turn,
                openingPlies: 5,
                maxEntrants: 4,
                endedAt: null,
            });
            // Seated as named.
            expect(detail.entries.map((entry) => [entry.key, entry.bot, entry.state, entry.ratingAtStart])).toEqual([
                [1, `alpha`, `playing`, 1500],
                [2, `beta`, `playing`, 1500],
                [3, `gamma`, `playing`, 1500],
                [4, `delta`, `playing`, 1500],
            ]);
            expect(detail.entries.map((entry) => entry.version)).toEqual([`1.0.0`, `1.0.3`, `1.0.4`, `1.0.5`]);
            expect(detail.rounds).toHaveLength(3);
            expect(detail.rounds.every((round) => round.pairings.length === 2 && round.rest === null)).toBe(true);
            const live = liveRows(detail.id);
            expect(live.map((row) => [row.round, row.game, row.unrated, row.test])).toEqual([
                [1, 1, 1, 0],
                [1, 1, 1, 0],
            ]);
            expect(new Set(live.flatMap((row) => [row.x, row.o])).size).toBe(4);
            for (const row of live) {
                for (const name of [row.x, row.o]) {
                    expect(gameStart(name, row.id).rated).toBe(false);
                    expect(streams.get(name as BotName)?.writes.some((line) => line.includes(`"challenge"`))).toBe(false);
                }
            }
            expect(detail.live).toHaveLength(2);
            expect(detail.live[0]?.tournament).toMatchObject({ name: `Round robin by eve`, format: `round_robin`, round: 1, game: 1, of: 2, createdBy: `eve` });
        });

        it('refuses a caller with no account, signed out or a guest', async () => {
            expect((await create(null, [`alpha`, `beta`, `gamma`])).statusCode).toBe(401);
            const guest = await world.app.inject({ method: `POST`, url: `/api/auth/guest` });
            const cookie = guest.cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
            const answer = await world.app.inject({ method: `POST`, url: `/api/tournaments`, cookies: { hexo_arena_session: cookie }, payload: { bots: [{ name: `alpha` }, { name: `beta` }, { name: `gamma` }], timeControl: turn } });
            expect(answer.statusCode).toBe(401);
        });

        it('refuses one bot or more than eight, one bot twice, a clock outside the bounds, a count no event plays, and a 1-ply opening for two openings', async () => {
            for (const [names, extra] of [
                [[`alpha`], {}],
                [[`alpha`, `beta`, `gamma`, `delta`, `aster`, `axe`, `one`, `two`, `three`], {}],
                [[`alpha`, `beta`, `ALPHA`], {}],
                [[`alpha`, `beta`, `gamma`], { timeControl: { mode: `unlimited` } }],
                [[`alpha`, `beta`, `gamma`], { openingPlies: 1, gamesPerPair: 4 }],
                [[`alpha`, `beta`, `gamma`], { gamesPerPair: 3 }],
            ] as const) {
                const answer = await create(`eve`, names, extra);
                expect(answer.statusCode, JSON.stringify([names, extra])).toBe(400);
                expect(answer.json()).toMatchObject({ code: `bad_request` });
            }
        });

        it('answers paused while the site is paused, and not_found for a bot no one holds', async () => {
            world.admin({ op: `pause`, reason: `test` });
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`])).json()).toMatchObject({ code: `paused` });
            world.admin({ op: `resume`, reason: `test` });
            expect((await create(`eve`, [`alpha`, `beta`, `nobody`])).statusCode).toBe(404);
        });

        it('refuses a delisted bot and a banned owner\'s bot, naming it', async () => {
            world.admin({ op: `delist-bot`, name: `gamma`, reason: `test` });
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`])).json()).toMatchObject({ code: `delisted`, bot: `gamma` });
            world.admin({ op: `ban-user`, name: `bob`, reason: `test` });
            const answer = await create(`eve`, [`alpha`, `beta`, `delta`]);
            expect(answer.statusCode).toBe(403);
            expect(answer.json()).toMatchObject({ code: `banned`, bot: `beta` });
        });

        it('refuses a bot offline or closed to others, one whose owner takes no duels or round robins from others, one outside its clocks, and a level it does not declare, naming the first', async () => {
            offline(`gamma`);
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`])).json()).toMatchObject({ code: `not_open`, bot: `gamma` });
            online(`gamma`);
            closed(`beta`);
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`])).json()).toMatchObject({ code: `not_open`, bot: `beta` });
            // An owner's own bot plays closed to others.
            expect((await create(`bob`, [`alpha`, `beta`, `gamma`])).statusCode).toBe(201);
            online(`beta`);
            await world.app.inject({ method: `PATCH`, url: `/api/bots/delta/settings`, cookies: { hexo_arena_session: session(`dee`) }, payload: { duelsByOthers: false } });
            const refused = await create(`eve`, [`alpha`, `gamma`, `delta`]);
            expect(refused.statusCode).toBe(400);
            expect(refused.json()).toMatchObject({ code: `duel_refused`, bot: `delta` });
            expect((await create(`eve`, [`alpha`, `gamma`, `beta`], { timeControl: { mode: `turn`, turnTimeMs: 5_000 } })).statusCode).toBe(201);
            expect((await create(`cid`, [`aster`, `axe`, `delta`])).json()).toMatchObject({ code: `duel_refused`, bot: `delta` });
            await world.app.inject({ method: `PATCH`, url: `/api/bots/delta/settings`, cookies: { hexo_arena_session: session(`dee`) }, payload: { duelsByOthers: true } });
            const narrow = { turnMs: [20_000, 30_000], match: false, unlimited: false };
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token(`delta`)}` }, payload: { accepts: narrow } });
            expect((await create(`dee`, [`aster`, `axe`, `delta`], { timeControl: { mode: `turn`, turnTimeMs: 40_000 } })).json()).toMatchObject({ code: `clock_not_accepted`, bot: `delta` });
            const leveled = await world.app.inject({
                method: `POST`,
                url: `/api/tournaments`,
                cookies: { hexo_arena_session: session(`dee`) },
                payload: { bots: [{ name: `aster` }, { name: `axe`, level: `club` }, { name: `delta` }], timeControl: turn },
            });
            expect(leveled.json()).toMatchObject({ code: `unknown_level`, bot: `axe` });
        });

        it('refuses a bot in the running weekly, at its game cap, or in two duels and round robins together', async () => {
            const weekly = enterWeekly(`alpha`, `beta`, `gamma`);
            tick(clock + 3_600_000);
            expect(stored(weekly).status).toBe(`running`);
            expect((await create(`eve`, [`alpha`, `aster`, `delta`])).json()).toMatchObject({ code: `bot_busy`, bot: `alpha` });
            world.admin({ op: `tournament-cancel`, id: weekly, reason: `test` });
            await started(`eve`, [`axe`, `aster`, `delta`]);
            await started(`dee`, [`delta`, `gamma`]);
            expect((await create(`cid`, [`delta`, `beta`, `alpha`])).json()).toMatchObject({ code: `bot_busy`, bot: `delta` });
            expect((await create(`bob`, [`delta`, `beta`])).json()).toMatchObject({ code: `bot_busy`, bot: `delta` });
        });

        it('holds a person to two running at once, of any size, in two live slots', async () => {
            const duel = await started(`eve`, [`alpha`, `beta`]);
            await started(`eve`, [`gamma`, `delta`, `aster`]);
            expect((await create(`eve`, [`axe`, `beta`])).json()).toMatchObject({ code: `tournament_busy` });
            expect((await world.app.inject({ method: `POST`, url: `/api/duels`, cookies: { hexo_arena_session: session(`eve`) }, payload: { first: `axe`, second: `delta`, timeControl: turn } })).statusCode).toBe(404);
            expect((await post(`eve`, `/api/tournaments/${duel.id}/stop`)).statusCode).toBe(200);
            expect((await create(`eve`, [`axe`, `beta`])).statusCode).toBe(201);
            expect(world.sqlite.prepare(`select live_slot as slot from tournaments where created_by = (select id from users where name = 'eve') and status = 'running' order by slot`).all()).toEqual([{ slot: 1 }, { slot: 2 }]);
        });

        it('holds a person to ten a UTC day of any size, refused until midnight', async () => {
            // Ten over already, so the rate limit on requests stays out of it.
            const seconds = Math.floor(clock / 1000);
            const insert = world.sqlite.prepare(
                `insert into tournaments (id, status, starts_at, time_control, opening_plies, max_entrants, created_at, started_at, ended_at, origin, created_by, rated, games_per_pair, live_slot) values (?, 'finished', ?, '{}', 5, ?, ?, ?, ?, 'person', (select id from users where name = 'eve'), 0, 2, 1)`,
            );
            for (let index = 0; index < 10; index++) insert.run(`t_dailycap${String(index).padStart(4, `0`)}`, seconds - 60, index % 2 === 0 ? 2 : 3, seconds - 60, seconds - 60, seconds - 30);
            const answer = await create(`eve`, [`alpha`, `beta`, `gamma`]);
            expect(answer.statusCode).toBe(429);
            expect(answer.json()).toMatchObject({ code: `daily_tournament_cap` });
            expect(answer.headers[`retry-after`]).toBe(String(12 * 3600));
            clock = Date.UTC(2026, 9, 5, 0, 0, 1);
            expect((await create(`eve`, [`alpha`, `beta`])).statusCode).toBe(201);
        });

        it('lets only a test of one person\'s bots play past ten games a pair, and no bot past 30 games, or 70 in a test', async () => {
            const stop = async (id: string, person: string) => {
                expect((await post(person, `/api/tournaments/${id}/stop`)).statusCode).toBe(200);
            };
            expect((await create(`eve`, [`alpha`, `beta`], { gamesPerPair: 20 })).json()).toMatchObject({ code: `test_only` });
            await stop((await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`], { gamesPerPair: 10 })).id, `eve`);
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`, `delta`, `aster`], { gamesPerPair: 10 })).json()).toMatchObject({ code: `too_many_games` });
            await stop((await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`, `aster`], { gamesPerPair: 6 })).id, `eve`);
            const test = await started(`ann`, [`alpha`, `aster`], { gamesPerPair: 50 });
            expect(test).toMatchObject({ test: true, rated: false, gamesPerPair: 50, format: `duel`, name: `Duel by ann` });
            expect(test.rounds[0]?.pairings[0]?.games).toHaveLength(50);
            await stop(test.id, `ann`);
            expect((await create(`ann`, [`alpha`, `aster`, `axe`], { gamesPerPair: 50 })).json()).toMatchObject({ code: `too_many_games` });
            expect((await started(`ann`, [`alpha`, `aster`, `axe`], { gamesPerPair: 30 })).gamesPerPair).toBe(30);
        });
    });

    describe('playing it', () => {
        it('starts a bot\'s next game while people play it, since each person holds one of its slots however many games they start', async () => {
            const detail = await started(`ann`, [`alpha`, `beta`, `gamma`, `delta`]);
            const play = (person: string) =>
                world.app.inject({ method: `POST`, url: `/api/games`, cookies: { hexo_arena_session: session(person) }, payload: { bot: `beta`, timeControl: turn } });
            expect((await play(`eve`)).statusCode).toBe(201);
            for (let more = 0; more < 3; more += 1) expect((await play(`eve`)).json()).toMatchObject({ code: `pair_busy` });
            expect((await play(`dee`)).statusCode).toBe(201);
            for (const row of liveRows(detail.id)) await resignX(row);
            tick(clock + 1_000);
            expect(liveRows(detail.id).filter((row) => row.x === `beta` || row.o === `beta`)).toHaveLength(1);
        });

        it('plays each pair from one opening with the sides swapped, a pair at a time per bot, and the next round once the gap passes', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            const first = liveRows(detail.id);
            for (const row of first) await resignX(row);
            tick(clock + 1_000);
            const second = liveRows(detail.id);
            expect(second.map((row) => row.game)).toEqual([2, 2]);
            for (const row of second) {
                const before = first.find((each) => each.pairing === row.pairing);
                expect(row.opening).toBe(before?.opening);
                expect([row.x, row.o]).toEqual([before?.o, before?.x]);
            }
            for (const row of second) await resignX(row);
            tick(clock + 1_000);
            expect(liveRows(detail.id)).toEqual([]);
            const between = await read(detail.id);
            expect(between.nextRoundAt).not.toBeNull();
            tick(clock + tournamentRoundGapMs - 5_000);
            expect(liveRows(detail.id)).toEqual([]);
            tick(clock + 6_000);
            expect(liveRows(detail.id).map((row) => row.round)).toEqual([2, 2]);
            await playOut(detail.id);
            const over = await read(detail.id);
            expect(over.status).toBe(`finished`);
            expect(over.standings.reduce((sum, line) => sum + line.points, 0)).toBe(12);
            expect(world.sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 0 });
            expect(readRating(createQuery(world.sqlite), { kind: `bot`, id: botId(`alpha`) }).rating).toBe(1500);
        });

        it('plays a pair\'s openings one after another, each from a fresh opening, and counts the game within the pair', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`], { gamesPerPair: 4 });
            expect(detail.rounds[0]?.pairings[0]?.games).toHaveLength(4);
            const pairing = liveRows(detail.id)[0];
            if (pairing === undefined) throw new Error(`no live game`);
            const openings: string[] = [];
            for (let game = 1; game <= 4; game++) {
                const [row] = liveRows(detail.id);
                if (row === undefined) throw new Error(`no game ${String(game)}`);
                expect([row.leg, row.game]).toEqual([Math.ceil(game / 2), ((game - 1) % 2) + 1]);
                const live = (await read(detail.id)).live[0]?.tournament;
                expect(live).toMatchObject({ of: 4, game });
                openings.push(row.opening);
                await resignX(row);
                tick(clock + 1_000);
            }
            expect(openings[0]).toBe(openings[1]);
            expect(openings[2]).toBe(openings[3]);
            expect(openings[0]).not.toBe(openings[2]);
            const done = await read(detail.id);
            expect(done.rounds[0]?.pairings[0]?.games.map((game) => game.outcome)).toEqual([`played`, `played`, `played`, `played`]);
        });

        it('tags a game between two bots of one owner a test, and every game of a test, which estimates each bot against the rest', async () => {
            const mixed = await started(`eve`, [`alpha`, `aster`, `beta`]);
            await playOut(mixed.id);
            const tagged = gameRows(mixed.id).map((row) => [[row.x, row.o].sort().join(` `), row.test]);
            expect(tagged.filter(([, test]) => test === 1).every(([pair]) => pair === `alpha aster`)).toBe(true);
            expect(tagged.some(([, test]) => test === 1)).toBe(true);
            expect((await read(mixed.id)).estimates).toBeUndefined();

            const test = await started(`ann`, [`alpha`, `aster`, `axe`]);
            expect(liveRows(test.id).every((row) => row.test === 1)).toBe(true);
            await playOut(test.id);
            const over = await read(test.id);
            expect(over.estimates?.map((each) => each.key).sort()).toEqual(over.entries.map((entry) => entry.key).sort());
            for (const each of over.estimates ?? []) {
                const line = over.standings.find((standing) => standing.key === each.key);
                expect(each.estimate.games).toBe(4);
                expect(each.estimate.points.first).toBe(line?.points);
            }
            const top = over.standings[0];
            const listed = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json()).past;
            expect(listed.find((each) => each.id === test.id)?.lead).toEqual({ bot: top?.bot, estimate: over.estimates?.find((each) => each.key === top?.key)?.estimate });
            expect(listed.find((each) => each.id === mixed.id)?.lead).toBeUndefined();
        });

        it('plays a bot at the strength picked for it, and shows no rating at the start for it', async () => {
            await world.app.inject({
                method: `PATCH`,
                url: `/api/bot/account`,
                headers: { authorization: `Bearer ${token(`gamma`)}` },
                payload: { levels: { default: `full`, list: [{ id: `full`, label: `full` }, { id: `club`, label: `club` }] } },
            });
            const answer = await world.app.inject({
                method: `POST`,
                url: `/api/tournaments`,
                cookies: { hexo_arena_session: session(`eve`) },
                payload: { bots: [{ name: `alpha` }, { name: `beta` }, { name: `gamma`, level: `club` }], timeControl: turn },
            });
            const detail = tournamentDetailSchema.parse(answer.json());
            const gamma = detail.entries.find((entry) => entry.bot === `gamma`);
            expect(gamma).toMatchObject({ level: { id: `club`, label: `club` }, ratingAtStart: null });
            await playOut(detail.id);
            const levels = world.sqlite
                .prepare(`select challenger_bot_id as x, x_level as xl, o_level as ol from games g join tournament_pairings p on p.id = g.pairing_id where p.tournament_id = ?`)
                .all(detail.id) as { x: string; xl: string | null; ol: string | null }[];
            expect(levels.filter((row) => row.xl !== null || row.ol !== null)).toHaveLength(4);
        });
    });

    describe('misses and withdrawals', () => {
        it('waits out the grace for a bot not ready, scores a no-show for the bot that came, and withdraws a bot that missed two pairings in a row', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            const row = liveRows(detail.id)[0];
            if (row === undefined) throw new Error(`no live game`);
            const gone = row.x as BotName;
            await resignX(row);
            offline(gone);
            tick(clock + 1_000);
            const waiting = await read(detail.id);
            const goneKey = waiting.entries.find((entry) => entry.bot === gone)?.key;
            expect(waiting.waiting).toEqual([{ key: goneKey, until: new Date(clock - tournamentDetailMemoMs + presenceGraceMs).toISOString() }]);
            for (let pass = 0; pass < 20 && entries(detail.id)[gone]?.state === `playing`; pass++) {
                for (const each of liveRows(detail.id)) await resignX(each);
                tick(clock + presenceGraceMs);
            }
            expect(entries(detail.id)[gone]).toEqual({ state: `withdrawn`, reason: `missed` });
            const after = await read(detail.id);
            const games = after.rounds.flatMap((round) => round.pairings.filter((pairing) => pairing.first.name === gone || pairing.second.name === gone).map((pairing) => pairing.games.map((game) => game.outcome)));
            expect(games).toEqual([
                [`played`, `no_show`],
                [`no_show`, `no_show`],
                [`no_show`, `no_show`],
            ]);
        });

        it('withdraws at once a bot delisted, of a banned owner, deleted, or whose owner turns duels by others off, its live game playing on', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            const live = liveRows(detail.id);
            world.admin({ op: `delist-bot`, name: `alpha`, reason: `test` });
            world.admin({ op: `ban-user`, name: `bob`, reason: `test` });
            await world.app.inject({ method: `PATCH`, url: `/api/bots/gamma/settings`, cookies: { hexo_arena_session: session(`cid`) }, payload: { duelsByOthers: false } });
            expect(entries(detail.id)).toMatchObject({ alpha: { state: `withdrawn`, reason: `delisted` }, beta: { state: `withdrawn`, reason: `banned` } });
            expect(liveRows(detail.id).map((row) => row.id)).toEqual(live.map((row) => row.id));
            for (const row of liveRows(detail.id)) if (row.x !== `beta` && row.o !== `beta`) await resignX(row);
            tick(clock + 1_000);
            expect(entries(detail.id).gamma).toEqual({ state: `withdrawn`, reason: `refused` });
        });

        it('withdraws at once a bot its owner deletes, its games to come scoring for its opponents', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`, `axe`]);
            const resting = detail.rounds[0]?.rest?.name;
            if (resting === undefined) throw new Error(`no bot rests`);
            const owner = ownerOf[resting as BotName];
            const id = botId(resting);
            const deleted = await world.app.inject({ method: `DELETE`, url: `/api/bots/${resting}`, cookies: { hexo_arena_session: session(owner) } });
            expect(deleted.statusCode).toBe(204);
            // A bot in a tournament is kept under a placeholder, so its entry stays.
            expect(world.sqlite.prepare(`select state, reason from tournament_entries where tournament_id = ? and bot_id = ?`).get(detail.id, id)).toEqual({ state: `withdrawn`, reason: `deleted` });
        });

        it('withdraws a bot from a round robin once the weekly it entered starts', async () => {
            const weekly = enterWeekly(`alpha`, `beta`, `gamma`);
            const detail = await started(`eve`, [`alpha`, `aster`, `delta`]);
            tick(clock + 3_600_000);
            expect(stored(weekly).status).toBe(`running`);
            expect(entries(detail.id).alpha).toEqual({ state: `withdrawn`, reason: `tournament` });
        });

        it('lets a bot\'s owner withdraw it, its live game counting and its games to come scoring for its opponents, and no one else', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`]);
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            const leaving = row.x;
            const owner = ownerOf[leaving as BotName];
            const other = [`ann`, `bob`, `cid`].find((person) => person !== owner) ?? `dee`;
            expect((await post(other, `/api/tournaments/${detail.id}/withdraw`, { bot: leaving })).json()).toMatchObject({ code: `not_owner` });
            expect((await post(owner, `/api/tournaments/${detail.id}/withdraw`, { bot: `delta` })).statusCode).toBe(403);
            const answer = await post(owner, `/api/tournaments/${detail.id}/withdraw`, { bot: leaving });
            expect(answer.statusCode).toBe(200);
            expect(tournamentDetailSchema.parse(answer.json()).entries.find((entry) => entry.bot === leaving)).toMatchObject({ state: `withdrawn`, reason: `owner` });
            expect((await post(owner, `/api/tournaments/${detail.id}/withdraw`, { bot: leaving })).json()).toMatchObject({ code: `not_playing` });
            expect(liveRows(detail.id).map((each) => each.id)).toEqual([row.id]);
            await resignX(row);
            tick(clock + 1_000);
            await playOut(detail.id);
            const over = await read(detail.id);
            const games = over.rounds.flatMap((round) => round.pairings).filter((pairing) => pairing.first.name === leaving || pairing.second.name === leaving).flatMap((pairing) => pairing.games);
            expect(games.map((game) => game.outcome)).toEqual([`played`, `forfeit`, `forfeit`, `forfeit`]);
            expect((await post(owner, `/api/tournaments/${detail.id}/withdraw`, { bot: leaving })).json()).toMatchObject({ code: `over` });
        });
    });

    describe('stopping it', () => {
        it('stops for its creator alone: no further game starts, the live ones finish and count, and the standings stand', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            const live = liveRows(detail.id);
            expect((await post(`ann`, `/api/tournaments/${detail.id}/stop`)).json()).toMatchObject({ code: `not_yours` });
            const answer = await post(`eve`, `/api/tournaments/${detail.id}/stop`);
            expect(answer.statusCode).toBe(200);
            expect(tournamentDetailSchema.parse(answer.json())).toMatchObject({ status: `stopped`, end: { reason: `creator`, round: 1 } });
            expect(stored(detail.id)).toEqual({ status: `stopped`, reason: `creator` });
            expect(liveRows(detail.id)).toHaveLength(2);
            for (const row of live) await resignX(row);
            tick(clock + 60_000);
            expect(liveRows(detail.id)).toEqual([]);
            const over = await read(detail.id);
            expect(over.standings.reduce((sum, line) => sum + line.points, 0)).toBe(2);
            expect(over.rounds[0]?.pairings.flatMap((pairing) => pairing.games.map((game) => game.outcome))).toEqual([`played`, `not_played`, `played`, `not_played`]);
            expect((await post(`eve`, `/api/tournaments/${detail.id}/stop`)).json()).toMatchObject({ code: `over` });
            const listed = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
            expect(listed.past.find((each) => each.id === detail.id)?.end).toEqual({ reason: `creator`, round: 1 });
            expect((await create(`eve`, [`alpha`, `beta`, `gamma`])).statusCode).toBe(201);
        });

        it('refuses to stop the operator\'s weekly', async () => {
            const weekly = enterWeekly(`alpha`, `beta`, `gamma`);
            expect((await post(`eve`, `/api/tournaments/${weekly}/stop`)).json()).toMatchObject({ code: `not_yours` });
            expect((await post(`ann`, `/api/tournaments/${weekly}/withdraw`, { bot: `alpha` })).statusCode).toBe(404);
        });

        it('stops the round robins a banned person set up, and lets the operator cancel one, aborting its live games', async () => {
            const banned = await started(`eve`, [`alpha`, `beta`, `gamma`]);
            world.admin({ op: `ban-user`, name: `eve`, reason: `test` });
            expect(stored(banned.id)).toEqual({ status: `stopped`, reason: `banned` });
            const canceled = await started(`dee`, [`aster`, `axe`, `delta`]);
            const live = liveRows(canceled.id);
            expect(live.length).toBeGreaterThan(0);
            const status = world.admin({ op: `status` });
            expect(status.kind === `status` ? status.status.liveRoundRobins : null).toBe(1);
            world.admin({ op: `tournament-cancel`, id: canceled.id, reason: `test` });
            expect(stored(canceled.id).status).toBe(`canceled`);
            expect(gameRows(canceled.id).map((row) => row.reason)).toEqual(live.map(() => `aborted`));
            expect((await read(canceled.id)).end).toEqual({ reason: `operator`, round: 1 });
        });
    });

    describe('a duel, a tournament of two', () => {
        it('sets two bots up as a duel: one round, the bot named first standing first, never rated', async () => {
            const detail = await started(`eve`, [`beta`, `alpha`]);
            expect(detail).toMatchObject({ name: `Duel by eve`, format: `duel`, origin: `person`, maxEntrants: 2, gamesPerPair: 2, rated: false, test: false, status: `running` });
            expect(detail.entries.map((entry) => [entry.key, entry.bot])).toEqual([
                [1, `beta`],
                [2, `alpha`],
            ]);
            expect(detail.entries.map((entry) => entry.now)).toEqual([
                { rating: 1500, provisional: true },
                { rating: 1500, provisional: true },
            ]);
            expect(detail.rounds).toHaveLength(1);
            expect(detail.rounds[0]?.pairings).toHaveLength(1);
            expect(detail.rounds[0]?.rest).toBeNull();
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            expect(gameStart(row.x, row.id).rated).toBe(false);
            const live = await read(detail.id);
            expect(live.live[0]?.tournament).toMatchObject({ name: `Duel by eve`, format: `duel`, round: 1, game: 1 });
            expect(live.rounds[0]?.pairings[0]?.games[0]?.opening).toHaveLength(5);
            const listed = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
            const summary = listed.running.find((each) => each.id === detail.id);
            expect(summary).toMatchObject({ format: `duel`, pair: { first: { key: 1, name: `beta`, points: 0 }, second: { key: 2, name: `alpha`, points: 0 } } });
            expect(summary?.pair?.games.map((game) => game.outcome)).toEqual([`live`, `pending`]);
        });

        it('plays a single game with its sides drawn by lot, its second slot none, and finishes after it', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`], { gamesPerPair: 1, openingPlies: 1 });
            expect(detail.rounds[0]?.pairings[0]?.games).toHaveLength(1);
            expect(world.sqlite.prepare(`select game2 from tournament_pairings where tournament_id = ?`).all(detail.id)).toEqual([{ game2: `none` }]);
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            expect([row.x, row.o].sort()).toEqual([`alpha`, `beta`]);
            const live = await read(detail.id);
            expect(live.live[0]?.tournament).toMatchObject({ format: `duel`, game: 1, of: 1 });
            await resignX(row);
            tick(clock + 1_000);
            const over = await read(detail.id);
            expect(over.status).toBe(`finished`);
            expect(over.rounds[0]?.pairings[0]?.games.map((game) => [game.outcome, game.reason])).toEqual([[`played`, `surrender`]]);
            expect(over.standings.find((line) => line.bot === row.o)?.points).toBe(1);
        });

        it('plays its openings game after game, each played twice with the sides swapped, its games carrying how they ended', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`], { gamesPerPair: 4 });
            await playOut(detail.id);
            const over = await read(detail.id);
            expect(over.status).toBe(`finished`);
            const games = over.rounds[0]?.pairings[0]?.games ?? [];
            expect(games.map((game) => game.x)).toEqual([1, 2, 1, 2].map((seat) => (seat === 1 ? over.rounds[0]?.pairings[0]?.first.key : over.rounds[0]?.pairings[0]?.second.key)));
            expect(games.every((game) => game.outcome === `played` && game.reason === `surrender` && game.turns !== null)).toBe(true);
            expect(games[0]?.opening).toEqual(games[1]?.opening);
            expect(over.standings.map((line) => line.points)).toEqual([2, 2]);
        });

        it('scores a no-show for the bot that came, and cuts the duel short once a bot misses two openings in a row', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`], { gamesPerPair: 10 });
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            await resignX(row);
            offline(`beta`);
            for (let pass = 0; pass < 20 && stored(detail.id).status === `running`; pass++) tick(clock + presenceGraceMs);
            expect(stored(detail.id)).toEqual({ status: `cut_short`, reason: `missed` });
            const over = await read(detail.id);
            expect(over.end).toEqual({ reason: `missed`, round: 1, bot: { key: 2, name: `beta` } });
            // The first opening was played in part, so the two missed in a row are the next two.
            expect(over.rounds[0]?.pairings[0]?.games.map((game) => game.outcome)).toEqual([`played`, ...Array.from({ length: 5 }, () => `no_show`), ...Array.from({ length: 4 }, () => `not_played`)]);
            expect(entries(detail.id).beta).toEqual({ state: `withdrawn`, reason: `missed` });
            const listed = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
            expect(listed.past.find((each) => each.id === detail.id)).toMatchObject({ status: `cut_short`, end: { reason: `missed`, bot: { name: `beta` } } });
        });

        it('ends when its bot\'s owner withdraws it: cut short, the live game playing on and counting, no further game', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`], { gamesPerPair: 4 });
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            const answer = await post(`bob`, `/api/tournaments/${detail.id}/withdraw`, { bot: `beta` });
            expect(answer.statusCode).toBe(200);
            expect(tournamentDetailSchema.parse(answer.json())).toMatchObject({ status: `cut_short`, end: { reason: `owner`, bot: { name: `beta` } } });
            expect(liveRows(detail.id).map((each) => each.id)).toEqual([row.id]);
            await resignX(row);
            tick(clock + 1_000);
            expect(liveRows(detail.id)).toEqual([]);
            const over = await read(detail.id);
            expect(over.rounds[0]?.pairings[0]?.games.map((game) => game.outcome)).toEqual([`played`, `not_played`, `not_played`, `not_played`]);
            expect(over.standings.reduce((sum, line) => sum + line.points, 0)).toBe(1);
            expect((await post(`eve`, `/api/tournaments/${detail.id}/stop`)).json()).toMatchObject({ code: `over` });
        });

        it('cuts a round robin short once one bot is left to play', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`]);
            expect((await post(`bob`, `/api/tournaments/${detail.id}/withdraw`, { bot: `beta` })).statusCode).toBe(200);
            expect(stored(detail.id).status).toBe(`running`);
            expect((await post(`cid`, `/api/tournaments/${detail.id}/withdraw`, { bot: `gamma` })).statusCode).toBe(200);
            expect(stored(detail.id)).toEqual({ status: `cut_short`, reason: `owner` });
            expect((await read(detail.id)).end).toMatchObject({ reason: `owner`, bot: { name: `gamma` } });
        });

        it('cuts a duel short at once when a bot of it is delisted, and stops one its creator stops', async () => {
            const cut = await started(`eve`, [`alpha`, `beta`]);
            world.admin({ op: `delist-bot`, name: `beta`, reason: `test` });
            expect(stored(cut.id)).toEqual({ status: `cut_short`, reason: `delisted` });
            const stopped = await started(`eve`, [`gamma`, `delta`]);
            expect((await post(`eve`, `/api/tournaments/${stopped.id}/stop`)).json()).toMatchObject({ status: `stopped`, end: { reason: `creator`, round: 1 } });
        });

        it('estimates the first bot of a test of two against the second, counted by openings', async () => {
            const detail = await started(`ann`, [`alpha`, `aster`], { gamesPerPair: 4 });
            await playOut(detail.id);
            const over = await read(detail.id);
            expect(over.test).toBe(true);
            const first = over.estimates?.find((each) => each.key === 1)?.estimate;
            const second = over.estimates?.find((each) => each.key === 2)?.estimate;
            expect(first?.games).toBe(4);
            expect(first?.points.first).toBe(second?.points.second);
        });
    });

    describe('around the site', () => {
        it('lists every running one with the weekly first, the caller\'s own with their quota, and tests alone', async () => {
            const weekly = enterWeekly(`beta`, `gamma`, `delta`);
            tick(clock + 3_600_000);
            const echo = await mintBot(world.app, session(`eve`), `echo`);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${echo}` }, payload: { accepts } });
            world.presence.attach(botId(`echo`), new FakeStreamSocket(), true);
            const mine = await started(`eve`, [`aster`, `echo`, `axe`]);
            clock += 1_000;
            const test = await started(`ann`, [`aster`, `axe`, `alpha`]);
            const list = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
            expect(list.running.map((each) => each.id)).toEqual([weekly, test.id, mine.id]);
            expect(list.running[0]).toMatchObject({ origin: `operator`, rated: true, createdBy: null });
            const own = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments?mine=1`, cookies: { hexo_arena_session: session(`eve`) } })).json());
            expect(own.running.map((each) => each.id)).toEqual([mine.id]);
            expect(own.quota).toEqual({ live: 1, today: 1 });
            expect(own.running[0]?.pair).toBeUndefined();
            const owner = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments?mine=1`, cookies: { hexo_arena_session: session(`ann`) } })).json());
            expect(owner.running.map((each) => each.id)).toEqual([test.id, mine.id]);
            // Level at the start, the first seated stands first.
            expect(owner.running.map((each) => each.yours?.bot)).toEqual([`aster`, `aster`]);
            const tests = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments?kind=test` })).json());
            expect(tests.running.map((each) => each.id)).toEqual([test.id]);
            const signedOut = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments?mine=1` })).json());
            expect(signedOut).toEqual({ running: [], scheduled: [], past: [] });
        });

        it('leads a round robin\'s list row with every bot first in it, their points, and the games each played, and a duel\'s with its pair instead', async () => {
            const field = await started(`eve`, [`alpha`, `beta`, `gamma`, `delta`]);
            const duel = await started(`eve`, [`aster`, `axe`]);
            const listed = async (id: string) => {
                clock += tournamentDetailMemoMs;
                const list = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
                return [...list.running, ...list.past].find((each) => each.id === id);
            };
            expect((await listed(field.id))?.leaders).toBeUndefined();
            for (let game = 1; game <= 2; game++) {
                for (const row of liveRows(field.id)) await resignX(row);
                tick(clock + 1_000);
            }
            // Each pair's bots won one game each, so all four stand first.
            const level = await listed(field.id);
            expect(level?.leaders).toMatchObject({ points: 1, games: 2 });
            expect(level?.leaders?.bots.map((bot) => bot.name).sort()).toEqual([`alpha`, `beta`, `delta`, `gamma`]);
            const pair = await listed(duel.id);
            expect(pair?.leaders).toBeUndefined();
            expect(pair?.pair).toMatchObject({ first: { name: `aster` }, second: { name: `axe` } });
            await playOut(field.id);
            expect((await listed(field.id))?.leaders).toMatchObject({ points: 3, games: 6 });
        });

        it('reads every listed bot\'s switch for duels by others and the duels and round robins it plays now, for the setup', async () => {
            await started(`eve`, [`alpha`, `beta`, `gamma`]);
            await started(`eve`, [`alpha`, `delta`]);
            const read = async () => tournamentBotStatesSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments/bots` })).json());
            const states = await read();
            expect(states.map((state) => state.name).sort()).toEqual([...bots].sort());
            expect(states.find((state) => state.name === `alpha`)).toEqual({ name: `alpha`, duelsByOthers: true, running: 2 });
            expect(states.find((state) => state.name === `delta`)?.running).toBe(1);
            expect(states.find((state) => state.name === `aster`)?.running).toBe(0);
            const switched = await world.app.inject({ method: `PATCH`, url: `/api/bots/aster/settings`, payload: { duelsByOthers: false }, cookies: { hexo_arena_session: session(`ann`) } });
            expect(switched.statusCode).toBe(200);
            // The states are read at most once a memo window, every caller in it getting the same body.
            clock += tournamentDetailMemoMs;
            expect((await read()).find((state) => state.name === `aster`)?.duelsByOthers).toBe(false);
        });

        it('names the round robin on its game\'s snapshot and in the finished history, unrated', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`]);
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            await resignX(row);
            const snapshot = gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${row.id}` })).json());
            expect(snapshot.tournament).toEqual({ id: detail.id, name: `Round robin by eve`, format: `round_robin`, round: 1, game: 1, of: 2, createdBy: `eve` });
            expect(snapshot).toMatchObject({ unratedByChoice: true });
            const history = finishedGamesPageSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/finished?tournament=${detail.id}` })).json());
            expect(history.games.map((game) => [game.gameId, game.rated, game.tournament?.name])).toEqual([[row.id, false, `Round robin by eve`]]);
        });

        it('hands the duels and round robins a person set up over in their data export, each with its format and its bots in the order named', async () => {
            const field = await started(`eve`, [`gamma`, `alpha`, `beta`], { gamesPerPair: 4 });
            const duel = await started(`eve`, [`delta`, `aster`]);
            const answer = await world.app.inject({ method: `GET`, url: `/api/me/export`, cookies: { hexo_arena_session: session(`eve`) } });
            const data = accountExportSchema.parse(answer.json());
            const createdAt = new Date(Math.floor(clock / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/u, `Z`);
            expect(data.tournaments).toEqual([
                { id: field.id, format: `round_robin`, bots: [`gamma`, `alpha`, `beta`], gamesPerPair: 4, test: false, rated: false, status: `running`, createdAt, endedAt: null },
                { id: duel.id, format: `duel`, bots: [`delta`, `aster`], gamesPerPair: 2, test: false, rated: false, status: `running`, createdAt, endedAt: null },
            ].sort((one, two) => one.id.localeCompare(two.id)));
        });

        it('replays a game the deploy drain cut once at the next boot, and starts no game while the site is paused', async () => {
            const detail = await started(`eve`, [`alpha`, `beta`, `gamma`]);
            const [row] = liveRows(detail.id);
            if (row === undefined) throw new Error(`no live game`);
            world.admin({ op: `pause`, reason: `deploy` });
            await world.drain(0);
            retireGeneration(createQuery(world.sqlite), 1);
            const sqlite = world.sqlite;
            await world.app.close();
            await setUp(sqlite);
            online(...bots);
            world.admin({ op: `resume`, reason: `deploy` });
            tick(clock + 1_000);
            const again = liveRows(detail.id);
            expect(again).toHaveLength(1);
            expect(again[0]?.opening).toBe(row.opening);
            expect([again[0]?.x, again[0]?.o]).toEqual([row.x, row.o]);
        });
    });
});
