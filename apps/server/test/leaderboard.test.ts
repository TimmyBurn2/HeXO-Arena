import { botsPath, devLoginPath, leaderboardCap, leaderboardPath, leaderboardSchema, type Side } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQuery, type Query } from '../src/db';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { voidGames } from '../src/moderation';
import { createUserWithExactName } from '../src/users';
import { createTestApp, FakeStreamSocket, type TestApp } from './helpers';

const day = 86_400;
const now = Date.UTC(2026, 9, 1, 12);
const nowSeconds = now / 1000;

describe('GET /api/leaderboard', () => {
    let world: TestApp;
    let query: Query;

    async function login(name: string): Promise<string> {
        const response = await world.app.inject({ method: 'POST', url: devLoginPath, payload: { name } });
        const setCookie = response.headers[`set-cookie`];
        return typeof setCookie === `string` ? (setCookie.split(`;`)[0]?.split(`=`)[1] ?? ``) : ``;
    }

    async function createBot(session: string, name: string): Promise<void> {
        await world.app.inject({
            method: 'POST',
            url: botsPath,
            payload: { name },
            cookies: { hexo_arena_session: session },
        });
    }

    function idOf(table: `users` | `bots`, name: string): string {
        const row = world.sqlite.prepare(`select id from ${table} where name = ?`).get(name) as { id: string } | undefined;
        if (row === undefined) throw new Error(`no ${table} row named ${name}`);
        return row.id;
    }

    // Finishing a game rates it, so a test sets the ratings it wants after its games.
    function rate(table: `users` | `bots`, name: string, rating: number, deviation: number): void {
        const column = table === `users` ? `user_id` : `bot_id`;
        world.sqlite.prepare(`delete from ratings where ${column} = ?`).run(idOf(table, name));
        world.sqlite.prepare(`insert into ratings (${column}, rating, deviation, volatility) values (?, ?, ?, 0.06)`).run(idOf(table, name), rating, deviation);
    }

    function settle(): void {
        world.sqlite.prepare(`delete from ratings`).run();
        rate(`users`, `Zed`, 1200.4, 70);
        rate(`users`, `Ann`, 1800, 76);
        rate(`bots`, `alpha`, 1650, 50);
        rate(`bots`, `Beta`, 1650, 75);
        rate(`bots`, `gamma`, 1700, 45);
    }

    // A finished game between two bots, `daysAgo` days before now.
    function botGame(x: string, o: string, winner: Side | null, daysAgo: number): string {
        const gameId = insertBotGame(query, { challengerBotId: idOf(`bots`, x), destBotId: idOf(`bots`, o), challengerSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
        return finish(gameId, winner, daysAgo);
    }

    function humanGame(user: string, bot: string, winner: Side | null, daysAgo: number): string {
        const gameId = insertGame(query, { userId: idOf(`users`, user), botId: idOf(`bots`, bot), userSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
        return finish(gameId, winner, daysAgo);
    }

    function finish(gameId: string, winner: Side | null, daysAgo: number): string {
        recordFinish(query, gameId, { winner, reason: winner === null ? `aborted` : `six-in-a-row` });
        world.sqlite.prepare(`update games set finished_at = ? where id = ?`).run(nowSeconds - daysAgo * day, gameId);
        return gameId;
    }

    async function board(search = ``) {
        const response = await world.app.inject({ method: 'GET', url: `${leaderboardPath}${search}` });
        expect(response.statusCode).toBe(200);
        return leaderboardSchema.parse(response.json());
    }

    // Zed and alpha are settled, Beta sits exactly on the threshold, Ann
    // is still provisional, and gamma never played a rated game; Zed last
    // played 40 days ago, the bots two days ago.
    beforeEach(async () => {
        world = await createTestApp({ now: () => now });
        query = createQuery(world.sqlite);
        const zed = await login(`Zed`);
        await login(`Ann`);
        await createBot(zed, `alpha`);
        await createBot(zed, `Beta`);
        await createBot(zed, `gamma`);
        humanGame(`Zed`, `alpha`, `o`, 40);
        humanGame(`Ann`, `alpha`, `x`, 3);
        botGame(`alpha`, `Beta`, `x`, 2);
        botGame(`Beta`, `gamma`, null, 1);
        settle();
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('ranks the players active in the last 30 days by rating, ties by name fold, with their rated games and the latest', async () => {
        expect(await board()).toEqual([
            { rank: 1, name: `alpha`, kind: `bot`, rating: 1650, games: 3, lastPlayedAt: `2026-09-29T12:00:00Z`, ownerName: `Zed`, online: false },
            { rank: 2, name: `Beta`, kind: `bot`, rating: 1650, games: 1, lastPlayedAt: `2026-09-29T12:00:00Z`, ownerName: `Zed`, online: false },
        ]);
    });

    it('reaches the idle with all, and still leaves provisional players and those without a rated game off', async () => {
        expect((await board(`?active=all`)).map((entry) => [entry.rank, entry.name, entry.games, entry.lastPlayedAt])).toEqual([
            [1, `alpha`, 3, `2026-09-29T12:00:00Z`],
            [2, `Beta`, 1, `2026-09-29T12:00:00Z`],
            [3, `Zed`, 1, `2026-08-22T12:00:00Z`],
        ]);
    });

    it('narrows the board to bots or humans and ranks within the narrowed board', async () => {
        expect((await board(`?kind=bots`)).map((entry) => [entry.rank, entry.name])).toEqual([
            [1, `alpha`],
            [2, `Beta`],
        ]);
        expect(await board(`?kind=humans`)).toEqual([]);
        expect(await board(`?kind=humans&active=all`)).toEqual([{ rank: 1, name: `Zed`, kind: `human`, rating: 1200, games: 1, lastPlayedAt: `2026-08-22T12:00:00Z` }]);
    });

    it('says which bots hold their stream open', async () => {
        world.presence.attach(idOf(`bots`, `Beta`), new FakeStreamSocket(), false);
        expect((await board()).map((entry) => (entry.kind === `bot` ? [entry.name, entry.online] : [entry.name]))).toEqual([
            [`alpha`, false],
            [`Beta`, true],
        ]);
    });

    it('counts a voided game as no game', async () => {
        const voided = botGame(`alpha`, `Beta`, `o`, 0);
        expect(voidGames(query, [voided])).toMatchObject({ kind: `voided`, count: 1 });
        settle();
        expect((await board()).map((entry) => [entry.name, entry.games])).toEqual([
            [`alpha`, 3],
            [`Beta`, 1],
        ]);
    });

    it('lists no more than the cap', async () => {
        world.sqlite.transaction(() => {
            for (let n = 0; n < leaderboardCap + 5; n++) {
                const name = `cap${String(n)}`;
                if (createUserWithExactName(query, `dev:${name}`, name) === `name_taken`) throw new Error(`seed name taken`);
                humanGame(name, `alpha`, `x`, 0);
                rate(`users`, name, 1500, 50);
            }
        })();
        expect(await board(`?active=all`)).toHaveLength(leaderboardCap);
    }, 20_000);

    it('rejects an unknown kind or window', async () => {
        for (const search of [`?kind=robots`, `?active=7d`]) {
            const response = await world.app.inject({ method: 'GET', url: `${leaderboardPath}${search}` });
            expect(response.statusCode).toBe(400);
            expect(response.json()).toMatchObject({ code: `bad_request` });
        }
    });
});
