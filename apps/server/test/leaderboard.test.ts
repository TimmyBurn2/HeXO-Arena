import { botsPath, devLoginPath, leaderboardPath } from '@hexarena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

describe('GET /api/leaderboard', () => {
    let world: TestApp;

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
            cookies: { hexarena_session: session },
        });
    }

    function rate(table: `users` | `bots`, name: string, rating: number, deviation: number): void {
        const column = table === `users` ? `user_id` : `bot_id`;
        world.sqlite
            .prepare(`insert into ratings (${column}, rating, deviation, volatility) select id, ?, ?, 0.06 from ${table} where name = ?`)
            .run(rating, deviation, name);
    }

    // Zed and alpha are settled, Beta sits exactly on the threshold, Ann
    // is still provisional, and gamma never played a rated game.
    beforeEach(async () => {
        world = await createTestApp();
        const zed = await login(`Zed`);
        await login(`Ann`);
        await createBot(zed, `alpha`);
        await createBot(zed, `Beta`);
        await createBot(zed, `gamma`);
        rate(`users`, `Zed`, 1200.4, 70);
        rate(`users`, `Ann`, 1800, 76);
        rate(`bots`, `alpha`, 1650, 50);
        rate(`bots`, `Beta`, 1650, 75);
    });

    afterEach(async () => {
        await world.app.close();
    });

    it('ranks every rankable player by rating, ties by name fold, and leaves provisional players off', async () => {
        const response = await world.app.inject({ method: 'GET', url: leaderboardPath });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual([
            { rank: 1, name: `alpha`, kind: `bot`, rating: 1650 },
            { rank: 2, name: `Beta`, kind: `bot`, rating: 1650 },
            { rank: 3, name: `Zed`, kind: `human`, rating: 1200 },
        ]);
    });

    it('narrows the board to bots or humans and ranks within the narrowed board', async () => {
        const botsOnly = await world.app.inject({ method: 'GET', url: `${leaderboardPath}?kind=bots` });
        expect(botsOnly.json()).toEqual([
            { rank: 1, name: `alpha`, kind: `bot`, rating: 1650 },
            { rank: 2, name: `Beta`, kind: `bot`, rating: 1650 },
        ]);
        const humansOnly = await world.app.inject({ method: 'GET', url: `${leaderboardPath}?kind=humans` });
        expect(humansOnly.json()).toEqual([{ rank: 1, name: `Zed`, kind: `human`, rating: 1200 }]);
    });

    it('rejects an unknown kind', async () => {
        const response = await world.app.inject({ method: 'GET', url: `${leaderboardPath}?kind=robots` });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ code: `bad_request` });
    });
});
