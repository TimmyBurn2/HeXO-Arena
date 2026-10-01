import { devAccountSchema, devAccountsPath, devPersonas } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { banUser } from '../src/moderation';
import { bots, users } from '../src/db/schema';
import { eq } from 'drizzle-orm';
import { createTestApp, loginAs, mintBot, type TestApp } from './helpers';

async function accounts(world: TestApp) {
    const response = await world.app.inject({ method: `GET`, url: devAccountsPath });
    expect(response.statusCode).toBe(200);
    return devAccountSchema.array().parse(response.json());
}

function idOf(world: TestApp, table: typeof users | typeof bots, name: string): string {
    const row = createQuery(world.sqlite).select({ id: table.id }).from(table).where(eq(table.name, name)).get();
    if (row === undefined) throw new Error(`no row named ${name}`);
    return row.id;
}

const opening = [{ x: 0, y: 0, player: 0 as const }];

describe('GET /api/dev/accounts', () => {
    it('answers an empty list before the seed has made anyone', async () => {
        const world = await createTestApp();
        expect(await accounts(world)).toEqual([]);
        await world.app.close();
    });

    it('lists the personas that exist with rating, bots, and games, and no one else', async () => {
        const world = await createTestApp();
        const ana = await loginAs(world.app, `ana`);
        await mintBot(world.app, ana, `hextide`);
        await mintBot(world.app, ana, `pebble`);
        const dmitri = await loginAs(world.app, `dmitri`);
        await mintBot(world.app, dmitri, `quietlake`);
        await loginAs(world.app, `bystander`);
        const query = createQuery(world.sqlite);
        const human = insertGame(query, {
            userId: idOf(world, users, `ana`),
            botId: idOf(world, bots, `quietlake`),
            userSide: `x`,
            timeControl: { mode: `unlimited` },
            opening,
        });
        recordFinish(query, human, { winner: `x`, reason: `six-in-a-row` });
        const botGame = insertBotGame(query, {
            challengerBotId: idOf(world, bots, `hextide`),
            destBotId: idOf(world, bots, `quietlake`),
            challengerSide: `o`,
            timeControl: { mode: `unlimited` },
            opening,
        });
        recordFinish(query, botGame, { winner: `o`, reason: `six-in-a-row` });

        const listed = await accounts(world);
        expect(listed.map((account) => account.name)).toEqual([`ana`, `dmitri`]);
        const [anaAccount, dmitriAccount] = listed;
        expect(anaAccount).toMatchObject({ purpose: devPersonas[0].purpose, banned: false, games: 1, provisional: true });
        expect(anaAccount?.rating).toBeGreaterThan(1000);
        expect(anaAccount?.bots.map((bot) => [bot.name, bot.vsBots])).toEqual([
            [`hextide`, 1],
            [`pebble`, 0],
        ]);
        expect(dmitriAccount).toMatchObject({ games: 0, rating: 1000 });
        expect(dmitriAccount?.bots.map((bot) => [bot.name, bot.vsBots])).toEqual([[`quietlake`, 1]]);
        await world.app.close();
    });

    it('marks a banned persona', async () => {
        const world = await createTestApp();
        await loginAs(world.app, `eve`);
        banUser(createQuery(world.sqlite), `eve`);
        expect(await accounts(world)).toMatchObject([{ name: `eve`, banned: true }]);
        await world.app.close();
    });

    it('is not registered when the dev login is off', async () => {
        const world = await createTestApp({ devLogin: false });
        const response = await world.app.inject({ method: `GET`, url: devAccountsPath });
        expect(response.statusCode).toBe(404);
        await world.app.close();
    });
});
