import type { Side } from '@hexo-arena/contract';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, openDatabase, runMigrations, type Query, type Sqlite } from '../src/db';
import { gameRatings } from '../src/db/schema';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { voidGames } from '../src/moderation';
import { rateGame, seedRating } from '../src/rating';
import { fillGameRatings, readRating, recomputeRatings } from '../src/rating-store';
import { createUserWithExactName } from '../src/users';
import { createTestApp } from './helpers';

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

describe('the game ratings cache', () => {
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

    function rowsOf(gameId: string) {
        return query
            .select({ side: gameRatings.side, before: gameRatings.ratingBefore, after: gameRatings.ratingAfter, deviation: gameRatings.deviationAfter })
            .from(gameRatings)
            .where(eq(gameRatings.gameId, gameId))
            .orderBy(asc(gameRatings.side))
            .all();
    }

    function allRows() {
        return query.select().from(gameRatings).orderBy(asc(gameRatings.gameId), asc(gameRatings.side)).all();
    }

    // A log of rated, unrated, and out-of-order finishes, human and bot alike.
    function playLog(seed: number, rounds: number): void {
        const random = seededRandom(seed);
        const open: string[] = [];
        for (let round = 0; round < rounds; round++) {
            if (random() < 0.4) {
                open.push(humanGame(pick(random, humans), pick(random, bots), random() < 0.5 ? `x` : `o`));
            } else {
                const challenger = pick(random, bots);
                const dest = pick(random, bots.filter((id) => id !== challenger));
                open.push(insertBotGame(query, { challengerBotId: challenger, destBotId: dest, challengerSide: random() < 0.5 ? `x` : `o`, timeControl: unlimited, opening: origin }));
            }
            while (open.length > 0 && random() < 0.6) {
                const [gameId = ``] = open.splice(Math.floor(random() * open.length), 1);
                const roll = random();
                const winner: Side | null = roll < 0.1 ? null : roll < 0.55 ? `x` : `o`;
                recordFinish(query, gameId, { winner, reason: winner === null ? `aborted` : `six-in-a-row` });
            }
        }
    }

    it('records both sides before and after a rated game in the transaction that finishes it, the bot facing a human unmoved', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        const gameId = humanGame(userId, botId, `o`);
        recordFinish(query, gameId, { winner: `o`, reason: `surrender` });
        const after = rateGame(
            { x: { kind: `bot`, id: botId }, o: { kind: `human`, id: userId }, winner: `o`, startedAt: 0, finishedAt: 0 },
            { x: { rating: seedRating(`bot`), ratedAt: null }, o: { rating: seedRating(`human`), ratedAt: null } },
            seedRating(`bot`),
        );
        expect(rowsOf(gameId)).toEqual([
            { side: `o`, before: seedRating(`human`).rating, after: after.o.rating, deviation: after.o.deviation },
            { side: `x`, before: seedRating(`bot`).rating, after: seedRating(`bot`).rating, deviation: seedRating(`bot`).deviation },
        ]);
        expect(readRating(query, { kind: `human`, id: userId }).rating).toBe(after.o.rating);
    });

    it('records the bot side of every human game with before equal to after, through a log and its recompute', () => {
        playLog(20261002, 200);
        recomputeRatings(query);
        const human = sqlite
            .prepare(
                `select r.rating_before as before, r.rating_after as after from game_ratings r join games g on g.id = r.game_id where g.user_id is not null and r.side <> g.user_side`,
            )
            .all() as { before: number; after: number }[];
        expect(human.length).toBeGreaterThan(50);
        for (const row of human) expect(row.after).toBe(row.before);
    });

    it('carries before equal to after for an unrated game and for one voided while live', () => {
        const [userId = ``] = humans;
        const [botId = ``, otherId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `six-in-a-row` });
        const standing = readRating(query, { kind: `human`, id: userId });
        const aborted = humanGame(userId, botId, `x`);
        recordFinish(query, aborted, { winner: null, reason: `aborted` });
        const voided = insertBotGame(query, { challengerBotId: botId, destBotId: otherId, challengerSide: `x`, timeControl: unlimited, opening: origin });
        sqlite.prepare(`update games set voided_at = 1 where id = ?`).run(voided);
        recordFinish(query, voided, { winner: `x`, reason: `six-in-a-row` });
        for (const gameId of [aborted, voided]) {
            const rows = rowsOf(gameId);
            expect(rows).toHaveLength(2);
            for (const row of rows) expect(row.after).toBe(row.before);
        }
        expect(rowsOf(aborted).find((row) => row.side === `x`)).toEqual({ side: `x`, before: standing.rating, after: standing.rating, deviation: standing.deviation });
        expect(readRating(query, { kind: `bot`, id: otherId })).toEqual(seedRating(`bot`));
    });

    it('rebuilds identical rows on a recompute of a tampered cache', () => {
        playLog(20261001, 300);
        const live = allRows();
        expect(live.length).toBeGreaterThan(200);
        sqlite.prepare(`update game_ratings set rating_after = 2000 where side = 'x'`).run();
        sqlite.prepare(`delete from game_ratings where side = 'o'`).run();
        recomputeRatings(query);
        expect(allRows()).toEqual(live);
    });

    it('rebuilds a voided game as one that rates nobody', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        const first = humanGame(userId, botId, `x`);
        recordFinish(query, first, { winner: `x`, reason: `six-in-a-row` });
        const second = humanGame(userId, botId, `x`);
        recordFinish(query, second, { winner: `x`, reason: `six-in-a-row` });
        expect(voidGames(query, [first])).toEqual({ kind: `voided`, count: 1 });
        recomputeRatings(query);
        for (const row of rowsOf(first)) expect(row.after).toBe(row.before);
        expect(rowsOf(second).find((row) => row.side === `x`)?.before).toBe(seedRating(`human`).rating);
    });

    it('keeps no rows for a guest\'s game, which the fold, a recompute, and the boot fill all pass over', () => {
        const [botId = ``] = bots;
        const standing = readRating(query, { kind: `bot`, id: botId });
        const guestGame = insertGame(query, { guestName: `Guest k3f9`, botId, userSide: `o`, timeControl: unlimited, opening: origin });
        recordFinish(query, guestGame, { winner: `o`, reason: `six-in-a-row` });
        expect(rowsOf(guestGame)).toEqual([]);
        expect(readRating(query, { kind: `bot`, id: botId })).toEqual(standing);
        expect(fillGameRatings(query)).toBe(0);
        expect(recomputeRatings(query)).toBe(0);
        expect(rowsOf(guestGame)).toEqual([]);
    });

    it('fills the rows a database from before the cache lacks, as a recompute would', async () => {
        playLog(7, 60);
        const live = allRows();
        sqlite.prepare(`delete from game_ratings`).run();
        expect(fillGameRatings(query)).toBeGreaterThan(0);
        expect(allRows()).toEqual(live);
        expect(fillGameRatings(query)).toBe(0);
        // The boot also closes the games the log left open, which adds their rows.
        sqlite.prepare(`delete from game_ratings`).run();
        const world = await createTestApp({ sqlite });
        const filled = allRows();
        expect(filled.length).toBeGreaterThan(live.length);
        recomputeRatings(query);
        expect(allRows()).toEqual(filled);
        await world.app.close();
    });
});
