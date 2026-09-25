import type { Side } from '@hexarena/contract';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, openDatabase, runMigrations, type Query, type Sqlite } from '../src/db';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { foldRatings, isProvisional, rateGame, seedRating } from '../src/rating';
import { finishedGameLog, readRating, recomputeRatings, storedRatings } from '../src/rating-store';
import { createUserWithExactName } from '../src/users';

const unlimited = { mode: `unlimited` as const };
const origin = [{ x: 0, y: 0, player: 0 as const }];

// mulberry32: a seeded stream, so a failing log replays exactly.
function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick<T>(random: () => number, items: readonly T[]): T {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error(`pick from an empty list`);
    return item;
}

describe('stored ratings', () => {
    let sqlite: Sqlite;
    let query: Query;
    let humans: string[];
    let bots: string[];

    beforeEach(() => {
        sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        query = createQuery(sqlite);
        humans = [];
        bots = [];
        for (const owner of [`ann`, `bob`, `cat`]) {
            const user = createUserWithExactName(query, `dev:${owner}`, owner);
            if (user === `name_taken`) throw new Error(`seed name taken`);
            humans.push(user.id);
            for (const suffix of [`one`, `two`]) {
                const name = `${owner}-${suffix}`;
                if (createBot(query, user.id, name).kind !== `created`) throw new Error(`seed failed`);
                const bot = findBot(query, name);
                if (bot === undefined) throw new Error(`seed lookup failed`);
                bots.push(bot.id);
            }
        }
    });

    afterEach(() => {
        sqlite.close();
    });

    function humanGame(userId: string, botId: string, userSide: Side): string {
        return insertGame(query, { userId, botId, userSide, timeControl: unlimited, opening: origin });
    }

    it('rates a human game from the seeds, with the human on either side', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `o`), { winner: `o`, reason: `surrender` });
        const expected = rateGame(
            { x: { kind: `bot`, id: botId }, o: { kind: `human`, id: userId }, winner: `o` },
            { x: seedRating(`bot`), o: seedRating(`human`) },
        );
        expect(readRating(query, { kind: `human`, id: userId })).toEqual(expected.o);
        expect(readRating(query, { kind: `bot`, id: botId })).toEqual(expected.x);
        expect(expected.o.rating).toBeGreaterThan(1000);
        expect(expected.x.rating).toBeLessThan(1500);
    });

    it('writes nothing for aborted and wall-time games', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: null, reason: `aborted` });
        recordFinish(query, humanGame(userId, botId, `x`), { winner: null, reason: `terminated` });
        expect(storedRatings(query).size).toBe(0);
    });

    it('reproduces the live table exactly when the whole log is folded', () => {
        const random = seededRandom(20260925);
        const open: string[] = [];
        for (let round = 0; round < 400; round++) {
            if (random() < 0.4) {
                open.push(humanGame(pick(random, humans), pick(random, bots), random() < 0.5 ? `x` : `o`));
            } else {
                const challenger = pick(random, bots);
                const dest = pick(random, bots.filter((id) => id !== challenger));
                open.push(
                    insertBotGame(query, {
                        challengerBotId: challenger,
                        destBotId: dest,
                        challengerSide: random() < 0.5 ? `x` : `o`,
                        timeControl: unlimited,
                        opening: origin,
                    }),
                );
            }
            // Games finish out of creation order, as concurrent games do.
            while (open.length > 0 && random() < 0.6) {
                const [gameId = ``] = open.splice(Math.floor(random() * open.length), 1);
                const roll = random();
                const winner: Side | null = roll < 0.1 ? null : roll < 0.55 ? `x` : `o`;
                recordFinish(query, gameId, { winner, reason: winner === null ? `aborted` : `six-in-a-row` });
            }
        }
        const live = storedRatings(query);
        expect(live.size).toBe(humans.length + bots.length);
        expect([...live.values()].some(({ rating }) => !isProvisional(rating))).toBe(true);
        expect(foldRatings(finishedGameLog(query))).toEqual(live);
    });

    it('recomputes a tampered table back to the fold of the log', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `surrender` });
        recordFinish(query, humanGame(userId, botId, `o`), { winner: `x`, reason: `timeout` });
        const live = storedRatings(query);
        sqlite.prepare(`update ratings set rating = 2000`).run();
        recomputeRatings(query);
        expect(storedRatings(query)).toEqual(live);
    });
});
