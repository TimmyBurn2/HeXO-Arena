import { asc } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, openDatabase, runMigrations, type Query, type Sqlite } from '../src/db';
import { games } from '../src/db/schema';
import { abortUnfinishedGames, insertGame, recordFinish } from '../src/game-store';
import { createUserWithExactName } from '../src/users';

const unlimited = { mode: `unlimited` as const };
const origin = [{ x: 0, y: 0, player: 0 as const }];

describe('finish order', () => {
    let sqlite: Sqlite;
    let query: Query;
    let seat: { userId: string; botId: string };

    beforeEach(() => {
        sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        if (createBot(query, owner.id, `alpha`).kind !== `created`) throw new Error(`seed failed`);
        const bot = findBot(query, `alpha`);
        if (bot === undefined) throw new Error(`seed lookup failed`);
        seat = { userId: owner.id, botId: bot.id };
    });

    afterEach(() => {
        sqlite.close();
    });

    function create(): string {
        return insertGame(query, { ...seat, userSide: `x`, timeControl: unlimited, opening: origin });
    }

    function sequence(): { id: string; finishSeq: number | null }[] {
        return query.select({ id: games.id, finishSeq: games.finishSeq }).from(games).orderBy(asc(games.finishSeq)).all();
    }

    it('numbers finishes in the order they happen, not the order games began', () => {
        const first = create();
        const second = create();
        recordFinish(query, second, { winner: `x`, reason: `surrender` });
        recordFinish(query, first, { winner: `o`, reason: `surrender` });
        expect(sequence()).toEqual([
            { id: second, finishSeq: 1 },
            { id: first, finishSeq: 2 },
        ]);
    });

    it('gives a finish that already happened no second number', () => {
        const only = create();
        recordFinish(query, only, { winner: `x`, reason: `surrender` });
        recordFinish(query, only, { winner: `o`, reason: `timeout` });
        expect(sequence()).toEqual([{ id: only, finishSeq: 1 }]);
    });

    it('numbers every game the boot sweep aborts', () => {
        create();
        create();
        abortUnfinishedGames(query);
        expect(sequence().map((row) => row.finishSeq)).toEqual([1, 2]);
    });
});
