import {
    accountExportSchema,
    duelBotStatesSchema,
    duelDetailMemoMs,
    duelDetailSchema,
    duelListSchema,
    finishedGamesPageSchema,
    gameSnapshotSchema,
    liveGameEntrySchema,
    presenceGraceMs,
    type DuelDetail,
} from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { countBotBotGamesSince, countPairBotGamesSince } from '../src/game-store';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const turn = { mode: `turn`, turnTimeMs: 30_000 } as const;
const accepts = { turnMs: [5_000, 60_000], match: true, unlimited: true };
const bots = [`alpha`, `aster`, `beta`, `gamma`] as const;
type BotName = (typeof bots)[number];
const ownerOf: Record<BotName, string> = { alpha: `ann`, aster: `ann`, beta: `bob`, gamma: `cid` };

interface GameRow {
    id: string;
    game: number;
    x: string;
    o: string;
    opening: string;
    winner: string | null;
    reason: string | null;
    unrated: number;
}

describe('duels', () => {
    let world: TestApp;
    let clock: number;
    const sessions = new Map<string, string>();
    const tokens = new Map<BotName, string>();
    const streams = new Map<BotName, FakeStreamSocket>();

    async function setUp(sqlite?: TestApp[`sqlite`]): Promise<void> {
        world = await createTestApp({ now: () => clock, ...(sqlite === undefined ? {} : { sqlite }) });
    }

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 3, 12);
        await setUp();
        for (const person of [`ann`, `bob`, `cid`, `dee`, `eve`]) sessions.set(person, await loginAs(world.app, person));
        for (const name of bots) {
            const token = await mintBot(world.app, session(ownerOf[name]), name);
            tokens.set(name, token);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts } });
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

    function create(person: string | null, body: Record<string, unknown>) {
        return world.app.inject({
            method: `POST`,
            url: `/api/duels`,
            ...(person === null ? {} : { cookies: { hexo_arena_session: session(person) } }),
            payload: { timeControl: turn, ...body },
        });
    }

    async function started(person: string, body: Record<string, unknown>): Promise<DuelDetail> {
        const answer = await create(person, body);
        if (answer.statusCode !== 201) throw new Error(`no duel: ${answer.body}`);
        return duelDetailSchema.parse(answer.json());
    }

    // Past the memo window, so each read sees the duel as it stands.
    async function read(id: string): Promise<DuelDetail> {
        clock += duelDetailMemoMs;
        const answer = await world.app.inject({ method: `GET`, url: `/api/duels/${id}` });
        expect(answer.statusCode).toBe(200);
        return duelDetailSchema.parse(answer.json());
    }

    function stop(person: string, id: string) {
        return world.app.inject({ method: `POST`, url: `/api/duels/${id}/stop`, cookies: { hexo_arena_session: session(person) } });
    }

    function tick(at?: number): void {
        if (at !== undefined) clock = at;
        world.duels.tick();
    }

    function stored(id: string): { status: string; reason: string | null; bot: string | null } {
        const row = world.sqlite.prepare(`select status, end_reason as reason, end_bot as bot, bot_a_id as a, bot_b_id as b from duels where id = ?`).get(id) as {
            status: string;
            reason: string | null;
            bot: string | null;
            a: string;
            b: string;
        };
        return { status: row.status, reason: row.reason, bot: row.bot === null ? null : nameOf(row.bot === `a` ? row.a : row.b) };
    }

    function gameRows(id: string): GameRow[] {
        return (
            world.sqlite
                .prepare(
                    `select id, duel_game as game, challenger_bot_id as x, dest_bot_id as o, opening_cells as opening, winner, finish_reason as reason, unrated_by_choice as unrated from games where duel_id = ? order by rowid`,
                )
                .all(id) as GameRow[]
        ).map((row) => ({ ...row, x: nameOf(row.x), o: nameOf(row.o) }));
    }

    function liveRow(id: string): GameRow {
        const live = gameRows(id).filter((row) => row.reason === null);
        expect(live).toHaveLength(1);
        const [row] = live;
        if (row === undefined) throw new Error(`no live game`);
        return row;
    }

    function gameStart(name: BotName, gameId: string): { rated: boolean; token: string; side: string } {
        const line = (streams.get(name)?.writes ?? []).filter((each) => each.includes(`"gameStart"`) && each.includes(gameId)).at(-1);
        if (line === undefined) throw new Error(`${name} heard no gameStart for ${gameId}`);
        const event = JSON.parse(line) as { rated: boolean; side: string; engine: { token: string } };
        return { rated: event.rated, side: event.side, token: event.engine.token };
    }

    // The x bot resigns, so the o bot wins.
    async function resignX(id: string): Promise<GameRow> {
        const row = liveRow(id);
        const answer = await world.app.inject({
            method: `POST`,
            url: `/api/bot/game/${row.id}/resign`,
            headers: { authorization: `Bearer ${gameStart(row.x as BotName, row.id).token}` },
        });
        expect(answer.statusCode).toBe(200);
        return row;
    }

    // Finished bot games between two bots today, rated, as the caps count them.
    function playedToday(one: BotName, two: BotName, count: number): void {
        const insert = world.sqlite.prepare(
            `insert into games (id, challenger_bot_id, dest_bot_id, challenger_side, time_control, opening_cells, winner, finish_reason, created_at, finished_at, finish_seq) values (?, ?, ?, 'x', '{"mode":"turn","turnTimeMs":10000}', '[{"x":0,"y":0,"player":0}]', 'x', 'surrender', ?, ?, (select coalesce(max(finish_seq), 0) + 1 from games))`,
        );
        const now = Math.floor(Date.now() / 1000);
        for (let index = 0; index < count; index++) insert.run(`g_00000000-0000-4000-8000-${String(index).padStart(6, `0`)}${one.slice(0, 3)}${two.slice(0, 3)}`, botId(one), botId(two), now, now);
    }

    describe('starting one', () => {
        it('starts an unrated duel between two ready bots and its first game at once, announced on both streams with no challenge and rated false', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            expect(duel).toMatchObject({
                status: `running`,
                startedBy: `dee`,
                first: { name: `alpha`, ownerName: `ann`, ratingAtStart: 1500 },
                second: { name: `beta`, ownerName: `bob`, ratingAtStart: 1500 },
                terms: { games: 2, openingPlies: 5, timeControl: turn, rated: false },
                score: { first: 0, second: 0 },
                endedAt: null,
            });
            expect(duel.games.map((game) => game.state)).toEqual([`live`, `pending`]);
            expect(duel.games[0]?.x).not.toBe(duel.games[1]?.x);
            expect(duel.live).toHaveLength(1);
            expect(duel.live[0]?.duel).toEqual({ id: duel.id, game: 1, of: 2 });
            const [game] = gameRows(duel.id);
            expect(game).toMatchObject({ game: 1, unrated: 1 });
            expect(game?.x).toBe(duel.games[0]?.x === `first` ? `alpha` : `beta`);
            for (const name of [`alpha`, `beta`] as const) {
                expect(gameStart(name, game?.id ?? ``).rated).toBe(false);
                expect(streams.get(name)?.writes.some((line) => line.includes(`"challenge"`))).toBe(false);
            }
        });

        it('refuses a caller with no account, signed out or a guest', async () => {
            expect((await create(null, { first: `alpha`, second: `beta` })).statusCode).toBe(401);
            const guest = await world.app.inject({ method: `POST`, url: `/api/auth/guest` });
            const cookie = guest.cookies.find((entry) => entry.name === `hexo_arena_session`)?.value ?? ``;
            const answer = await world.app.inject({ method: `POST`, url: `/api/duels`, cookies: { hexo_arena_session: cookie }, payload: { first: `alpha`, second: `beta`, timeControl: turn } });
            expect(answer.statusCode).toBe(401);
        });

        it('refuses one bot named twice, a 1-ply opening for more than one pair, and a clock outside the bounds', async () => {
            for (const body of [
                { first: `alpha`, second: `ALPHA` },
                { first: `alpha`, second: `beta`, openingPlies: 1, games: 4 },
                { first: `alpha`, second: `beta`, timeControl: { mode: `unlimited` } },
                { first: `alpha`, second: `beta`, timeControl: { mode: `turn`, turnTimeMs: 90_000 } },
            ]) {
                const answer = await create(`dee`, body);
                expect(answer.statusCode, JSON.stringify(body)).toBe(400);
                expect(answer.json()).toMatchObject({ code: `bad_request` });
            }
        });

        it('answers paused while the site is paused, and not_found for a bot no one holds', async () => {
            world.admin({ op: `pause`, reason: `incident` });
            const paused = await create(`dee`, { first: `alpha`, second: `beta` });
            expect(paused.statusCode).toBe(503);
            expect(paused.json()).toMatchObject({ code: `paused` });
            world.admin({ op: `resume`, reason: `over` });
            const missing = await create(`dee`, { first: `alpha`, second: `nobody` });
            expect(missing.statusCode).toBe(404);
        });

        it('refuses a delisted bot and a banned owner\'s bot, naming it', async () => {
            world.admin({ op: `delist-bot`, name: `beta`, reason: `name` });
            expect((await create(`dee`, { first: `alpha`, second: `beta` })).json()).toMatchObject({ code: `delisted`, bot: `beta` });
            world.admin({ op: `ban-user`, name: `cid`, reason: `abuse` });
            const banned = await create(`dee`, { first: `alpha`, second: `gamma` });
            expect(banned.statusCode).toBe(403);
            expect(banned.json()).toMatchObject({ code: `banned`, bot: `gamma` });
        });

        it('refuses a bot not open, one whose owner takes no duels from others, one outside its clocks, and a level it does not declare, naming it', async () => {
            world.presence.attach(botId(`gamma`), new FakeStreamSocket(), false);
            expect((await create(`dee`, { first: `alpha`, second: `gamma` })).json()).toMatchObject({ code: `not_open`, bot: `gamma` });
            online(`gamma`);
            const off = await world.app.inject({ method: `PATCH`, url: `/api/bots/beta/settings`, cookies: { hexo_arena_session: session(`bob`) }, payload: { duelsByOthers: false } });
            expect(off.json()).toEqual({ name: `beta`, duelsByOthers: false });
            expect((await create(`dee`, { first: `alpha`, second: `beta` })).json()).toMatchObject({ code: `duel_refused`, bot: `beta` });
            // The switch binds others: its owner still starts one.
            expect((await create(`bob`, { first: `beta`, second: `alpha` })).statusCode).toBe(201);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${tokens.get(`aster`) ?? ``}` }, payload: { accepts: { turnMs: [5_000, 20_000], match: false, unlimited: false } } });
            expect((await create(`dee`, { first: `aster`, second: `alpha` })).json()).toMatchObject({ code: `clock_not_accepted`, bot: `aster` });
            expect((await create(`cid`, { first: `alpha`, second: `gamma`, levels: { second: `easy` } })).json()).toMatchObject({ code: `unknown_level`, bot: `gamma` });
        });

        it('refuses a bot in a running tournament or already in two duels, and a pair already playing one', async () => {
            await started(`dee`, { first: `alpha`, second: `beta` });
            expect((await create(`eve`, { first: `beta`, second: `alpha` })).json()).toMatchObject({ code: `duel_live` });
            await started(`dee`, { first: `alpha`, second: `gamma` });
            expect((await create(`eve`, { first: `alpha`, second: `aster` })).json()).toMatchObject({ code: `bot_busy`, bot: `alpha` });
            const created = world.admin({ op: `tournament-create`, name: `Autumn round robin`, startsAt: new Date(clock + 120_000).toISOString(), timeControl: turn, openingPlies: 5, maxEntrants: 12, reason: `test` });
            expect(created.kind).toBe(`done`);
            for (const person of [`bob`, `cid`]) {
                const name = person === `bob` ? `beta` : `gamma`;
                const tournament = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
                const entry = await world.app.inject({ method: `PUT`, url: `/api/tournaments/${tournament}/entry`, cookies: { hexo_arena_session: session(person) }, payload: { bot: name } });
                expect(entry.statusCode).toBe(200);
            }
            const tournament = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
            await world.app.inject({ method: `PUT`, url: `/api/tournaments/${tournament}/entry`, cookies: { hexo_arena_session: session(`ann`) }, payload: { bot: `aster` } });
            clock += 120_000;
            world.tournaments.tick();
            expect(world.sqlite.prepare(`select status from tournaments`).get()).toEqual({ status: `running` });
            expect((await create(`eve`, { first: `aster`, second: `gamma` })).json()).toMatchObject({ code: `bot_busy` });
        });

        it('holds a person to two running duels', async () => {
            await started(`dee`, { first: `alpha`, second: `beta` });
            await started(`dee`, { first: `aster`, second: `gamma` });
            const busy = await create(`dee`, { first: `beta`, second: `gamma` });
            expect(busy.statusCode).toBe(400);
            expect(busy.json()).toMatchObject({ code: `duel_busy` });
        });

        it('rates a duel only for a starter owning exactly one bot, both at their default levels', async () => {
            const rated = await started(`ann`, { first: `alpha`, second: `beta`, rated: true });
            expect(rated.terms.rated).toBe(true);
            const game = liveRow(rated.id);
            expect(game.unrated).toBe(0);
            expect(gameStart(`alpha`, game.id).rated).toBe(true);
            expect((await create(`dee`, { first: `gamma`, second: `aster`, rated: true })).json()).toMatchObject({ code: `unrated_only` });
            // A person's own two bots meet, unrated only.
            expect((await create(`ann`, { first: `aster`, second: `alpha`, rated: true })).json()).toMatchObject({ code: `unrated_only` });
            await world.app.inject({
                method: `PATCH`,
                url: `/api/bot/account`,
                headers: { authorization: `Bearer ${tokens.get(`gamma`) ?? ``}` },
                payload: { levels: { default: `full`, list: [{ id: `easy`, label: `Easy` }, { id: `full`, label: `Full` }] } },
            });
            expect((await create(`cid`, { first: `gamma`, second: `aster`, levels: { first: `easy` }, rated: true })).json()).toMatchObject({ code: `unrated_only` });
            const practice = await started(`cid`, { first: `gamma`, second: `aster`, levels: { first: `easy` } });
            expect(practice.first).toMatchObject({ ratingAtStart: null, level: { id: `easy`, label: `Easy` } });
            const own = await started(`ann`, { first: `aster`, second: `beta` });
            expect(own.terms.rated).toBe(false);
        });

        it('holds a person to ten duels a UTC day, refused until midnight', async () => {
            const insert = world.sqlite.prepare(
                `insert into duels (id, started_by, bot_a_id, bot_b_id, a_first, a_x, test, games, time_control, opening_plies, a_rating, b_rating, rated, status, created_at, ended_at) values (?, (select id from users where name = 'dee'), ?, ?, 1, 1, 0, 2, '{}', 5, 1500, 1500, 0, 'finished', ?, ?)`,
            );
            const [a, b] = [botId(`alpha`), botId(`beta`)].sort();
            const seconds = Math.floor(clock / 1000);
            for (let index = 0; index < 10; index++) insert.run(`d_dailycap${String(index).padStart(4, `0`)}`, a, b, seconds - 60, seconds - 30);
            const capped = await create(`dee`, { first: `alpha`, second: `beta` });
            expect(capped.statusCode).toBe(429);
            expect(capped.json()).toMatchObject({ code: `daily_duel_cap` });
            expect(capped.headers[`retry-after`]).toBe(String(12 * 3600));
        });

        it('checks a rated duel against the pair\'s and each bot\'s daily caps for every game', async () => {
            playedToday(`alpha`, `beta`, 19);
            const pair = await create(`ann`, { first: `alpha`, second: `beta`, rated: true });
            expect(pair.statusCode).toBe(429);
            expect(pair.json()).toMatchObject({ code: `daily_pair_cap` });
            expect(pair.headers[`retry-after`]).toBe(String(12 * 3600));
            // An unrated duel between them is still allowed: it counts toward no cap.
            expect((await create(`ann`, { first: `alpha`, second: `beta` })).statusCode).toBe(201);
            playedToday(`gamma`, `aster`, 99);
            expect((await create(`cid`, { first: `gamma`, second: `beta`, rated: true })).json()).toMatchObject({ code: `daily_bot_cap` });
        });
    });

    describe('playing one', () => {
        it('plays a pair from one opening with the sides swapped, one game at a time, and finishes with the score', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            tick();
            expect(gameRows(duel.id)).toHaveLength(1);
            const first = await resignX(duel.id);
            tick();
            const second = liveRow(duel.id);
            expect(second).toMatchObject({ game: 2, x: first.o, o: first.x, opening: first.opening });
            await resignX(duel.id);
            const over = await read(duel.id);
            expect(over.status).toBe(`finished`);
            expect(over.games.map((game) => [game.state, game.winner === null ? null : game.winner === game.x ? `x` : `o`])).toEqual([
                [`played`, `o`],
                [`played`, `o`],
            ]);
            expect(over.score).toEqual({ first: 1, second: 1 });
            expect(over.games[0]?.opening).toEqual(over.games[1]?.opening);
            expect(over.games[0]?.opening).toHaveLength(5);
            expect(over.live).toEqual([]);
            expect(over.end).toBeUndefined();
            tick();
            expect(gameRows(duel.id)).toHaveLength(2);
        });

        it('draws a fresh opening for each pair and alternates the sides every game', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4, openingPlies: 9 });
            const played: GameRow[] = [];
            for (let game = 1; game <= 4; game++) {
                played.push(await resignX(duel.id));
                tick();
            }
            expect(played.map((row) => row.game)).toEqual([1, 2, 3, 4]);
            expect(played[1]?.opening).toBe(played[0]?.opening);
            expect(played[3]?.opening).toBe(played[2]?.opening);
            expect(played[2]?.opening).not.toBe(played[0]?.opening);
            expect(played.map((row) => row.x)).toEqual([played[0]?.x, played[0]?.o, played[0]?.x, played[0]?.o]);
            expect(stored(duel.id).status).toBe(`finished`);
        });

        it('waits for a bot not ready between games, plays on once it returns within the grace, and cuts the duel short after it', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4 });
            await resignX(duel.id);
            world.presence.close(botId(`beta`));
            const from = clock;
            tick(from);
            tick(from + presenceGraceMs - 1);
            expect(gameRows(duel.id)).toHaveLength(1);
            const waiting = await read(duel.id);
            expect(waiting.waiting).toEqual({ bot: `second`, until: new Date(from + presenceGraceMs).toISOString() });
            online(`beta`);
            tick(clock);
            expect(liveRow(duel.id).game).toBe(2);
            await resignX(duel.id);
            world.presence.close(botId(`alpha`));
            const again = clock;
            tick(again);
            tick(again + presenceGraceMs);
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `offline`, bot: `alpha` });
            const cut = await read(duel.id);
            expect(cut.end).toEqual({ reason: `offline`, bot: `first` });
            expect(cut.games.map((game) => game.state)).toEqual([`played`, `played`, `not_played`, `not_played`]);
            expect(cut.waiting).toBeUndefined();
        });

        it('stops for the starter or an owner, never aborting the live game, and for no one else', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            const outsider = await stop(`eve`, duel.id);
            expect(outsider.statusCode).toBe(403);
            expect(outsider.json()).toMatchObject({ code: `not_yours` });
            const stopped = await stop(`dee`, duel.id);
            expect(stopped.statusCode).toBe(200);
            expect(duelDetailSchema.parse(stopped.json())).toMatchObject({ status: `stopped`, end: { reason: `starter`, bot: null } });
            expect(liveRow(duel.id).game).toBe(1);
            await resignX(duel.id);
            tick();
            const over = await read(duel.id);
            expect(over.games.map((game) => game.state)).toEqual([`played`, `not_played`]);
            expect((await stop(`dee`, duel.id)).statusCode).toBe(409);
            const owned = await started(`dee`, { first: `alpha`, second: `gamma` });
            const byOwner = await stop(`cid`, owned.id);
            expect(duelDetailSchema.parse(byOwner.json()).end).toEqual({ reason: `owner`, bot: `second` });
        });

        it('replays a game the deploy drain cut once at the next boot, from its opening and sides, and cuts the duel short on a second cut', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            const cut = liveRow(duel.id);
            await world.drain(0);
            expect(stored(duel.id).status).toBe(`running`);
            const { sqlite } = world;
            await world.app.close();
            await setUp(sqlite);
            online(...bots);
            tick();
            const replay = liveRow(duel.id);
            expect(replay).toMatchObject({ game: 1, x: cut.x, o: cut.o, opening: cut.opening });
            expect(replay.id).not.toBe(cut.id);
            await world.drain(0);
            const again = world.sqlite;
            await world.app.close();
            await setUp(again);
            online(...bots);
            tick();
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `aborted`, bot: null });
            expect(gameRows(duel.id)).toHaveLength(2);
        });

        it('cuts a duel short when the operator aborts its game', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4 });
            const game = liveRow(duel.id);
            expect(world.admin({ op: `abort-game`, gameId: game.id, reason: `stuck` }).kind).toBe(`done`);
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `aborted`, bot: null });
            tick();
            const cut = await read(duel.id);
            expect(cut.games.map((each) => each.state)).toEqual([`aborted`, `not_played`, `not_played`, `not_played`]);
        });

        it('starts no game while the site is paused, and counts the grace again from the resume', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4 });
            await resignX(duel.id);
            world.admin({ op: `pause`, reason: `incident` });
            tick();
            expect(gameRows(duel.id)).toHaveLength(1);
            world.admin({ op: `resume`, reason: `over` });
            tick();
            expect(liveRow(duel.id).game).toBe(2);
            await resignX(duel.id);
            world.presence.close(botId(`beta`));
            const from = clock;
            tick(from);
            world.admin({ op: `pause`, reason: `incident` });
            tick(from + presenceGraceMs);
            world.admin({ op: `resume`, reason: `over` });
            const resumed = from + presenceGraceMs + 1_000;
            tick(resumed);
            tick(resumed + presenceGraceMs - 1);
            expect(stored(duel.id).status).toBe(`running`);
            tick(resumed + presenceGraceMs);
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `offline`, bot: `beta` });
        });

        it('cuts a duel short when a tournament its bot entered starts', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4 });
            world.admin({ op: `tournament-create`, name: `Autumn round robin`, startsAt: new Date(clock + 120_000).toISOString(), timeControl: turn, openingPlies: 5, maxEntrants: 12, reason: `test` });
            const tournament = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
            for (const [person, bot] of [[`ann`, `alpha`], [`bob`, `beta`], [`cid`, `gamma`]] as const) {
                await world.app.inject({ method: `PUT`, url: `/api/tournaments/${tournament}/entry`, cookies: { hexo_arena_session: session(person) }, payload: { bot } });
            }
            await resignX(duel.id);
            clock += 120_000;
            world.tournaments.tick();
            tick();
            expect(stored(duel.id)).toMatchObject({ status: `cut_short`, reason: `tournament` });
        });

        it('cuts short the duels of a bot delisted, of a banned owner\'s bot, and of a deleted bot, its live game playing on', async () => {
            const delisted = await started(`dee`, { first: `alpha`, second: `beta` });
            world.admin({ op: `delist-bot`, name: `beta`, reason: `name` });
            expect(stored(delisted.id)).toEqual({ status: `cut_short`, reason: `delisted`, bot: `beta` });
            expect(liveRow(delisted.id).game).toBe(1);
            const banned = await started(`eve`, { first: `aster`, second: `gamma` });
            world.admin({ op: `ban-user`, name: `cid`, reason: `abuse` });
            expect(stored(banned.id)).toEqual({ status: `cut_short`, reason: `banned`, bot: `gamma` });
            await resignX(banned.id);
            const deleted = await started(`eve`, { first: `aster`, second: `alpha` });
            await resignX(deleted.id);
            // A rated game keeps the bot on the record, and its duel with it.
            playedToday(`aster`, `alpha`, 1);
            const removed = await world.app.inject({ method: `DELETE`, url: `/api/bots/aster`, cookies: { hexo_arena_session: session(`ann`) } });
            expect(removed.statusCode).toBe(204);
            expect(world.sqlite.prepare(`select status, end_reason as reason from duels where id = ?`).get(deleted.id)).toEqual({ status: `cut_short`, reason: `deleted` });
            expect((await read(deleted.id)).first).toMatchObject({ name: `deleted bot`, deleted: true });
        });

        it('cuts a duel short once its owner turns duels by others off, after the grace', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta`, games: 4 });
            await world.app.inject({ method: `PATCH`, url: `/api/bots/beta/settings`, cookies: { hexo_arena_session: session(`bob`) }, payload: { duelsByOthers: false } });
            await resignX(duel.id);
            const from = clock;
            tick(from);
            expect(gameRows(duel.id)).toHaveLength(1);
            tick(from + presenceGraceMs);
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `refused`, bot: `beta` });
        });

        it('cuts a rated duel short when a game meets a daily cap at its start', async () => {
            const duel = await started(`ann`, { first: `alpha`, second: `beta`, rated: true });
            await resignX(duel.id);
            playedToday(`alpha`, `beta`, 19);
            tick();
            expect(stored(duel.id)).toEqual({ status: `cut_short`, reason: `daily_cap`, bot: null });
        });

        it('counts an unrated duel toward no daily cap, and a rated one toward both', async () => {
            const unrated = await started(`dee`, { first: `alpha`, second: `beta` });
            await resignX(unrated.id);
            tick();
            await resignX(unrated.id);
            const query = createQuery(world.sqlite);
            const day = Math.floor(Date.now() / 86_400_000) * 86_400;
            expect(countPairBotGamesSince(query, { one: botId(`alpha`), two: botId(`beta`) }, day)).toBe(0);
            expect(countBotBotGamesSince(query, botId(`alpha`), day)).toBe(0);
            const rated = await started(`ann`, { first: `alpha`, second: `beta`, rated: true });
            await resignX(rated.id);
            expect(countPairBotGamesSince(query, { one: botId(`alpha`), two: botId(`beta`) }, day)).toBe(1);
            expect(countBotBotGamesSince(query, botId(`beta`), day)).toBe(1);
        });
    });

    describe('a test between one owner\'s bots', () => {
        it('plays two bots of one owner as a test, never rated, up to 50 games, the owner\'s bots kept closed to others', async () => {
            for (const name of [`alpha`, `aster`] as const) world.presence.attach(botId(name), new FakeStreamSocket(), false);
            expect((await create(`dee`, { first: `alpha`, second: `aster` })).json()).toMatchObject({ code: `not_open` });
            for (const name of [`alpha`, `aster`] as const) {
                const stream = new FakeStreamSocket();
                streams.set(name, stream);
                world.presence.attach(botId(name), stream, false);
            }
            expect((await create(`ann`, { first: `alpha`, second: `aster`, games: 50, rated: true })).json()).toMatchObject({ code: `unrated_only` });
            const test = await started(`ann`, { first: `alpha`, second: `aster`, games: 50 });
            expect(test).toMatchObject({ kind: `test`, terms: { games: 50, rated: false } });
            expect(test.games).toHaveLength(50);
            const game = liveRow(test.id);
            expect(game.unrated).toBe(1);
            expect(world.sqlite.prepare(`select test from games where id = ?`).get(game.id)).toEqual({ test: 1 });
            for (const name of [`alpha`, `aster`] as const) expect(gameStart(name, game.id).rated).toBe(false);
            expect(gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${game.id}` })).json())).toMatchObject({ test: true, duel: { id: test.id, game: 1, of: 50 } });
        });

        it('refuses more than ten games outside a test, and counts a test toward the starter\'s duels', async () => {
            const long = await create(`dee`, { first: `alpha`, second: `beta`, games: 20 });
            expect(long.statusCode).toBe(400);
            expect(long.json()).toMatchObject({ code: `test_only` });
            // Someone else's duel between one owner's bots is a test too, and both must be open.
            expect((await started(`dee`, { first: `alpha`, second: `aster`, games: 30 })).kind).toBe(`test`);
            await started(`dee`, { first: `beta`, second: `gamma` });
            expect((await create(`dee`, { first: `gamma`, second: `aster` })).json()).toMatchObject({ code: `duel_busy` });
        });

        it('keeps each bot\'s version as the test began, while the bot declares another', async () => {
            const declare = (name: BotName, version: string) =>
                world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${tokens.get(name) ?? ``}` }, payload: { version } });
            await declare(`alpha`, `0.2.0`);
            const test = await started(`ann`, { first: `aster`, second: `alpha` });
            expect(test.first.version).toBeUndefined();
            expect(test.second.version).toBe(`0.2.0`);
            await declare(`alpha`, `0.3.0`);
            expect((await read(test.id)).second.version).toBe(`0.2.0`);
        });

        it('estimates a test by its pairs once a game is over, and gives a duel no estimate', async () => {
            const test = await started(`ann`, { first: `alpha`, second: `aster`, games: 10 });
            expect(test.estimate).toBeUndefined();
            expect(test.second.now).toEqual({ rating: 1500, provisional: true });
            await resignX(test.id);
            tick();
            const one = await read(test.id);
            expect(one.estimate).toMatchObject({ games: 1, verdict: `too_close` });
            expect((one.estimate?.points.first ?? 0) + (one.estimate?.points.second ?? 0)).toBe(1);
            await resignX(test.id);
            tick();
            const pair = await read(test.id);
            expect(pair.estimate?.games).toBe(2);
            expect((pair.estimate?.points.first ?? 0) + (pair.estimate?.points.second ?? 0)).toBe(2);
            expect(pair.games.slice(0, 2).map((game) => [game.state, game.reason, game.turns])).toEqual([
                [`played`, `surrender`, expect.any(Number)],
                [`played`, `surrender`, expect.any(Number)],
            ]);
            const duel = await started(`dee`, { first: `beta`, second: `gamma` });
            expect(duel.kind).toBe(`duel`);
            await resignX(duel.id);
            expect((await read(duel.id)).estimate).toBeUndefined();
        });

        it('lists a person\'s own duels and tests, and one kind alone', async () => {
            const test = await started(`ann`, { first: `alpha`, second: `aster` });
            const started2 = await started(`dee`, { first: `beta`, second: `gamma` });
            const list = async (query: string, person?: string) =>
                duelListSchema.parse(
                    (await world.app.inject({ method: `GET`, url: `/api/duels${query}`, ...(person === undefined ? {} : { cookies: { hexo_arena_session: session(person) } }) })).json(),
                ).running.map((each) => each.id);
            clock += duelDetailMemoMs;
            expect(await list(`?kind=test`)).toEqual([test.id]);
            expect(await list(`?kind=duel`)).toEqual([started2.id]);
            expect(await list(`?mine=1`, `ann`)).toEqual([test.id]);
            // An owner's bot in a duel someone else started makes it theirs as well.
            expect(await list(`?mine=1`, `bob`)).toEqual([started2.id]);
            expect(await list(`?mine=1`, `dee`)).toEqual([started2.id]);
            expect(await list(`?mine=1`)).toEqual([]);
            const quota = async (person: string) =>
                duelListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/duels?mine=1`, cookies: { hexo_arena_session: session(person) } })).json()).quota;
            clock += duelDetailMemoMs;
            expect(await quota(`ann`)).toEqual({ live: 1, today: 1 });
            expect(await quota(`bob`)).toEqual({ live: 0, today: 0 });
            expect(duelListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/duels` })).json()).quota).toBeUndefined();
            expect((await world.app.inject({ method: `GET`, url: `/api/duels?kind=series` })).statusCode).toBe(400);
        });

        it('reads every listed bot\'s switch for duels by others and the bots it duels now', async () => {
            await world.app.inject({ method: `PATCH`, url: `/api/bots/beta/settings`, cookies: { hexo_arena_session: session(`bob`) }, payload: { duelsByOthers: false } });
            await started(`ann`, { first: `alpha`, second: `aster` });
            const states = duelBotStatesSchema.parse((await world.app.inject({ method: `GET`, url: `/api/duels/bots` })).json());
            expect(states).toEqual([
                { name: `alpha`, duelsByOthers: true, dueling: [`aster`], roundRobins: 0 },
                { name: `aster`, duelsByOthers: true, dueling: [`alpha`], roundRobins: 0 },
                { name: `beta`, duelsByOthers: false, dueling: [], roundRobins: 0 },
                { name: `gamma`, duelsByOthers: true, dueling: [], roundRobins: 0 },
            ]);
        });

        it('keeps a test\'s games off the live list unless asked', async () => {
            const test = await started(`ann`, { first: `alpha`, second: `aster` });
            const game = liveRow(test.id);
            const live = async (query: string) => liveGameEntrySchema.array().parse((await world.app.inject({ method: `GET`, url: `/api/games${query}` })).json()).map((entry) => entry.gameId);
            expect(await live(``)).not.toContain(game.id);
            expect(await live(`?tests=1`)).toContain(game.id);
        });
    });

    describe('reading one', () => {
        it('lists running and recent duels with how each game stands, across the site and for one bot', async () => {
            const running = await started(`dee`, { first: `alpha`, second: `beta` });
            const over = await started(`dee`, { first: `aster`, second: `gamma` });
            await stop(`dee`, over.id);
            clock += duelDetailMemoMs;
            const all = duelListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/duels` })).json());
            expect(all.running.map((each) => each.id)).toEqual([running.id]);
            expect(all.running[0]?.results.map((each) => [each.game, each.state])).toEqual([
                [1, `live`],
                [2, `pending`],
            ]);
            expect(all.past.map((each) => [each.id, each.status, each.played])).toEqual([[over.id, `stopped`, 0]]);
            const forGamma = duelListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/duels?bot=GAMMA` })).json());
            expect(forGamma).toEqual({ running: [], past: [expect.objectContaining({ id: over.id })] });
            expect((await world.app.inject({ method: `GET`, url: `/api/duels?bot=nobody` })).statusCode).toBe(404);
            expect((await world.app.inject({ method: `GET`, url: `/api/duels/d_nonexistent0` })).statusCode).toBe(404);
            expect((await world.app.inject({ method: `GET`, url: `/api/duels/nothing` })).statusCode).toBe(404);
        });

        it('names the duel on its game\'s snapshot, the live list, and the finished history, unrated', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            const game = liveRow(duel.id);
            const line = { id: duel.id, game: 1, of: 2 };
            const live = liveGameEntrySchema.array().parse((await world.app.inject({ method: `GET`, url: `/api/games` })).json());
            expect(live.find((entry) => entry.gameId === game.id)).toMatchObject({ duel: line, rated: false });
            expect(gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${game.id}` })).json())).toMatchObject({ duel: line, unratedByChoice: true });
            await resignX(duel.id);
            expect(gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${game.id}` })).json())).toMatchObject({ duel: line, unratedByChoice: true });
            const history = finishedGamesPageSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/finished?kind=bot-bot` })).json());
            expect(history.games.find((entry) => entry.gameId === game.id)).toMatchObject({ duel: line, unratedByChoice: true, rated: false });
        });

        it('lets an owner read and set a bot\'s duel switch, on until turned off, and no one else', async () => {
            const read = (person: string | null, name: string) =>
                world.app.inject({ method: `GET`, url: `/api/bots/${name}/settings`, ...(person === null ? {} : { cookies: { hexo_arena_session: session(person) } }) });
            expect((await read(`bob`, `beta`)).json()).toEqual({ name: `beta`, duelsByOthers: true });
            expect((await read(`ann`, `beta`)).statusCode).toBe(404);
            expect((await read(null, `beta`)).statusCode).toBe(401);
            const patch = (payload: unknown) => world.app.inject({ method: `PATCH`, url: `/api/bots/beta/settings`, cookies: { hexo_arena_session: session(`bob`) }, payload: payload as Record<string, unknown> });
            expect((await patch({ open: false })).statusCode).toBe(400);
            expect((await patch({ duelsByOthers: false })).json()).toEqual({ name: `beta`, duelsByOthers: false });
            expect((await read(`bob`, `beta`)).json()).toEqual({ name: `beta`, duelsByOthers: false });
            expect((await patch({})).json()).toEqual({ name: `beta`, duelsByOthers: false });
        });

        it('hands the duels a person started over in their data export', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            const exported = accountExportSchema.parse((await world.app.inject({ method: `GET`, url: `/api/me/export`, cookies: { hexo_arena_session: session(`dee`) } })).json());
            expect(exported.duels).toEqual([{ id: duel.id, first: `alpha`, second: `beta`, kind: `duel`, games: 2, rated: false, status: `running`, createdAt: duel.createdAt, endedAt: null }]);
            const owner = accountExportSchema.parse((await world.app.inject({ method: `GET`, url: `/api/me/export`, cookies: { hexo_arena_session: session(`ann`) } })).json());
            expect(owner.duels).toEqual([]);
            expect(owner.games.find((game) => game.id === liveRow(duel.id).id)?.unratedByChoice).toBe(true);
        });

        it('lets the operator stop a duel and counts the running ones', async () => {
            const duel = await started(`dee`, { first: `alpha`, second: `beta` });
            const status = world.admin({ op: `status` });
            expect(status.kind === `status` ? status.status.liveDuels : null).toBe(1);
            expect(world.admin({ op: `duel-stop`, id: duel.id, reason: `farming` })).toMatchObject({ kind: `done` });
            expect(stored(duel.id)).toEqual({ status: `stopped`, reason: `operator`, bot: null });
            expect(world.admin({ op: `duel-stop`, id: duel.id, reason: `farming` })).toMatchObject({ kind: `error`, code: `unchanged` });
            expect(world.admin({ op: `duel-stop`, id: `d_nonexistent0`, reason: `farming` })).toMatchObject({ kind: `error`, code: `not_found` });
            expect(world.sqlite.prepare(`select action, target from admin_actions where action = 'duel-stop'`).all()).toEqual([{ action: `duel-stop`, target: duel.id }]);
        });
    });
});
