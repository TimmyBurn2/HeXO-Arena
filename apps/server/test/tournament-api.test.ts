import { gameSnapshotSchema, liveGameEntrySchema, tournamentDetailSchema, tournamentEntrySchema, tournamentListSchema } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findBot } from '../src/bots';
import { createQuery } from '../src/db';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

const accepts = { turnMs: [5_000, 60_000], match: true, unlimited: true };
const people = [
    [`ann`, `alpha`],
    [`bob`, `beta`],
    [`cid`, `gamma`],
    [`dee`, `delta`],
] as const;

describe('the tournament reads and entries', () => {
    let world: TestApp;
    let clock: number;
    const sessions = new Map<string, string>();
    const tokens = new Map<string, string>();
    let id: string;

    beforeEach(async () => {
        clock = Date.UTC(2026, 9, 1, 12);
        world = await createTestApp({ now: () => clock });
        for (const [owner, bot] of people) {
            const session = await loginAs(world.app, owner);
            sessions.set(owner, session);
            const token = await mintBot(world.app, session, bot);
            tokens.set(bot, token);
            await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts } });
        }
        world.admin({
            op: `tournament-create`,
            name: `Autumn round robin`,
            startsAt: new Date(clock + 120_000).toISOString(),
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 3,
            maxEntrants: 3,
            reason: `test`,
        });
        id = (world.sqlite.prepare(`select id from tournaments`).get() as { id: string }).id;
    });

    afterEach(async () => {
        await world.app.close();
    });

    function enter(owner: string, bot: string) {
        return world.app.inject({ method: `PUT`, url: `/api/tournaments/${id}/entry`, cookies: { hexo_arena_session: sessions.get(owner) ?? `` }, payload: { bot } });
    }

    async function detail() {
        const answer = await world.app.inject({ method: `GET`, url: `/api/tournaments/${id}` });
        expect(answer.statusCode).toBe(200);
        return tournamentDetailSchema.parse(answer.json());
    }

    function online(...bots: string[]): Map<string, FakeStreamSocket> {
        const streams = new Map<string, FakeStreamSocket>();
        for (const bot of bots) {
            const stream = new FakeStreamSocket();
            streams.set(bot, stream);
            world.presence.attach(findBot(createQuery(world.sqlite), bot)?.id ?? ``, stream, false);
        }
        return streams;
    }

    it('lists a waiting tournament with its entries counted', async () => {
        expect((await enter(`ann`, `alpha`)).statusCode).toBe(200);
        const answer = await world.app.inject({ method: `GET`, url: `/api/tournaments` });
        const list = tournamentListSchema.parse(answer.json());
        expect(list.running).toEqual([]);
        expect(list.past).toEqual([]);
        expect(list.scheduled).toEqual([
            {
                id,
                name: `Autumn round robin`,
                origin: `operator`,
                format: `round_robin`,
                createdBy: null,
                rated: true,
                test: false,
                gamesPerPair: 2,
                status: `scheduled`,
                startsAt: new Date(clock + 120_000).toISOString().replace(`.000`, ``),
                timeControl: { mode: `turn`, turnTimeMs: 10_000 },
                openingPlies: 3,
                entrants: 1,
                maxEntrants: 3,
                winner: null,
                round: null,
            },
        ]);
    });

    it('names the signed-in caller\'s own entry and its place on the list of every bot, and on no one else\'s', async () => {
        const list = async (owner: string | null, search = ``) =>
            tournamentListSchema.parse(
                (await world.app.inject({ method: `GET`, url: `/api/tournaments${search}`, ...(owner === null ? {} : { cookies: { hexo_arena_session: sessions.get(owner) ?? `` } }) })).json(),
            );
        for (const [owner, bot] of people.slice(0, 3)) await enter(owner, bot);
        expect((await list(`ann`)).scheduled[0]?.yours).toEqual({ bot: `alpha`, place: { state: `entered`, rank: null, points: null } });
        expect((await list(`dee`)).scheduled[0]?.yours).toBeUndefined();
        expect((await list(null)).scheduled[0]?.yours).toBeUndefined();
        online(`alpha`, `beta`, `gamma`);
        clock += 120_000;
        world.tournaments.tick();
        clock += 1_000;
        expect((await list(`bob`)).running[0]?.yours).toEqual({ bot: `beta`, place: { state: `playing`, rank: 1, points: 0 } });
        const forBot = (await list(`bob`, `?bot=gamma`)).running[0];
        expect(forBot?.bot).toMatchObject({ state: `playing` });
        expect(forBot?.yours).toBeUndefined();
    });

    it('enters an owner\'s bot, replaces it with another of theirs, and withdraws it', async () => {
        const first = await enter(`ann`, `alpha`);
        expect(tournamentEntrySchema.parse(first.json())).toEqual({
            key: 1,
            bot: `alpha`,
            ownerName: `ann`,
            online: false,
            ratingAtStart: null,
            state: `entered`,
        });
        const token = await mintBot(world.app, sessions.get(`ann`) ?? ``, `alpha2`);
        await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${token}` }, payload: { accepts } });
        expect((await enter(`ann`, `alpha2`)).statusCode).toBe(200);
        expect((await detail()).entries.map((entry) => entry.bot)).toEqual([`alpha2`]);
        const gone = await world.app.inject({ method: `DELETE`, url: `/api/tournaments/${id}/entry`, cookies: { hexo_arena_session: sessions.get(`ann`) ?? `` } });
        expect(gone.statusCode).toBe(204);
        expect((await detail()).entries).toEqual([]);
    });

    it('refuses a guest, another owner\'s bot, a delisted bot, an unknown one, a clock it does not accept, and a full field', async () => {
        const anonymous = await world.app.inject({ method: `PUT`, url: `/api/tournaments/${id}/entry`, payload: { bot: `alpha` } });
        expect(anonymous.statusCode).toBe(401);
        expect((await enter(`ann`, `beta`)).json()).toMatchObject({ code: `not_owner` });
        expect((await enter(`ann`, `nobody`)).statusCode).toBe(404);
        world.admin({ op: `delist-bot`, name: `delta`, reason: `test` });
        expect((await enter(`dee`, `delta`)).json()).toMatchObject({ code: `delisted` });
        await world.app.inject({
            method: `PATCH`,
            url: `/api/bot/account`,
            headers: { authorization: `Bearer ${tokens.get(`gamma`) ?? ``}` },
            payload: { accepts: { turnMs: [30_000, 60_000], match: false, unlimited: false } },
        });
        expect((await enter(`cid`, `gamma`)).json()).toMatchObject({ code: `clock_not_accepted` });
        await world.app.inject({ method: `PATCH`, url: `/api/bot/account`, headers: { authorization: `Bearer ${tokens.get(`gamma`) ?? ``}` }, payload: { accepts } });
        world.admin({ op: `relist-bot`, name: `delta`, reason: `test` });
        for (const [owner, bot] of people.slice(0, 3)) expect((await enter(owner, bot)).statusCode).toBe(200);
        const full = await enter(`dee`, `delta`);
        expect(full.statusCode).toBe(409);
        expect(full.json()).toMatchObject({ code: `full` });
    });

    it('closes entries at the start, and reads the running tournament: entries, rounds, standings, and its live games', async () => {
        for (const [owner, bot] of people.slice(0, 3)) await enter(owner, bot);
        const streams = online(`alpha`, `beta`, `gamma`);
        clock += 120_000;
        world.tournaments.tick();
        expect((await enter(`ann`, `alpha`)).json()).toMatchObject({ code: `closed` });
        clock += 1_000;
        world.tournaments.tick();
        clock += 2_000;
        const read = await detail();
        expect(read).toMatchObject({ status: `running`, maxEntrants: 3, openingPlies: 3 });
        expect(read.entries.map((entry) => [entry.bot, entry.state, entry.online, entry.ratingAtStart])).toEqual([
            [`alpha`, `playing`, true, 1500],
            [`beta`, `playing`, true, 1500],
            [`gamma`, `playing`, true, 1500],
        ]);
        expect(read.rounds).toHaveLength(3);
        const listed = tournamentListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/tournaments` })).json());
        expect(listed.running).toMatchObject([{ id, status: `running`, round: { current: 1, of: 3 } }]);
        const [round] = read.rounds;
        const [pairing] = round?.pairings ?? [];
        expect(round?.rest).not.toBeNull();
        expect(pairing?.games.map((game) => [game.x, game.outcome])).toEqual([
            [pairing?.first.key, `live`],
            [pairing?.second.key, `pending`],
        ]);
        expect(read.entries.map((entry) => [entry.key, entry.bot])).toEqual([
            [1, `alpha`],
            [2, `beta`],
            [3, `gamma`],
        ]);
        expect(pairing?.first.name).toBe(read.entries.find((entry) => entry.key === pairing?.first.key)?.bot);
        const gameId = pairing?.games[0]?.gameId ?? ``;
        expect(read.live.map((game) => game.gameId)).toEqual([gameId]);
        const tag = { id, name: `Autumn round robin`, format: `round_robin`, round: 1, game: 1 };
        expect(read.live[0]?.tournament).toEqual(tag);
        const liveList = liveGameEntrySchema.array().parse((await world.app.inject({ method: `GET`, url: `/api/games` })).json());
        expect(liveList.find((game) => game.gameId === gameId)?.tournament).toEqual(tag);
        expect(read.standings.map((line) => [line.rank, line.points])).toEqual([
            [1, 0],
            [1, 0],
            [1, 0],
        ]);
        const snapshot = gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${gameId}` })).json());
        expect(snapshot.tournament).toEqual(tag);
        // The x bot resigns: the point goes to the second bot, as o.
        const start = (streams.get(pairing?.first.name ?? ``)?.writes ?? []).map((line) => line.trim()).filter((line) => line.includes(`gameStart`));
        const token = (JSON.parse(start.at(-1) ?? `{}`) as { engine: { token: string } }).engine.token;
        await world.app.inject({ method: `POST`, url: `/api/bot/game/${gameId}/resign`, headers: { authorization: `Bearer ${token}` } });
        clock += 2_000;
        const after = await detail();
        expect(after.rounds[0]?.pairings[0]?.games[0]).toMatchObject({ outcome: `played`, point: pairing?.second.key, missing: [] });
        expect(after.standings[0]).toMatchObject({ rank: 1, key: pairing?.second.key, bot: pairing?.second.name, points: 1, asX: 0, asO: 1 });
        const finished = gameSnapshotSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${gameId}` })).json());
        expect(finished.tournament).toEqual(tag);
    });

    it('names every deleted bot and owner by the plain label, told apart by key alone, and never by a placeholder', async () => {
        for (const [owner, bot] of people.slice(0, 3)) await enter(owner, bot);
        online(`alpha`, `beta`, `gamma`);
        clock += 120_000;
        world.tournaments.tick();
        for (const name of [`ann`, `bob`]) expect(world.admin({ op: `delete-user`, name, reason: `test` })).toMatchObject({ kind: `done` });
        clock += 5_000;
        const answer = await world.app.inject({ method: `GET`, url: `/api/tournaments/${id}` });
        expect(answer.body).not.toMatch(/deleted-[0-9]/u);
        const read = tournamentDetailSchema.parse(answer.json());
        expect(read.entries.map((entry) => [entry.key, entry.bot, entry.ownerName, entry.deleted])).toEqual([
            [1, `deleted bot`, `deleted player`, true],
            [2, `deleted bot`, `deleted player`, true],
            [3, `gamma`, `cid`, undefined],
        ]);
        const seats = read.rounds.flatMap((round) => round.pairings.flatMap((pairing) => [pairing.first, pairing.second]));
        expect(new Set(seats.map((seat) => `${String(seat.key)} ${seat.name} ${String(seat.deleted)}`))).toEqual(
            new Set([`1 deleted bot true`, `2 deleted bot true`, `3 gamma undefined`]),
        );
        expect(read.standings.filter((line) => line.deleted === true).map((line) => [line.key, line.bot]).sort()).toEqual([
            [1, `deleted bot`],
            [2, `deleted bot`],
        ]);
    });

    it('answers 404 for an unknown or malformed id', async () => {
        expect((await world.app.inject({ method: `GET`, url: `/api/tournaments/t_aaaaaaaaaaaa` })).statusCode).toBe(404);
        expect((await world.app.inject({ method: `GET`, url: `/api/tournaments/nope` })).statusCode).toBe(404);
    });
});
