import type { Side } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, openDatabase, runMigrations, type Query, type Sqlite } from '../src/db';
import { insertBotGame, insertGame, recordFinish } from '../src/game-store';
import { foldRatings, isProvisional, rateGame, seedRating } from '../src/rating';
import { explainRatedAtBefore, finishedGameLog, readRating, recomputeRatings, storedRatings } from '../src/rating-store';
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
        vi.useRealTimers();
        sqlite.close();
    });

    function humanGame(userId: string, botId: string, userSide: Side): string {
        return insertGame(query, { userId, botId, userSide, timeControl: unlimited, opening: origin });
    }

    it('rates a human game from the seeds, moving the human alone, with the human on either side', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `o`), { winner: `o`, reason: `surrender` });
        const expected = rateGame(
            { x: { kind: `bot`, id: botId }, o: { kind: `human`, id: userId }, winner: `o`, startedAt: 0, finishedAt: 0 },
            { x: { rating: seedRating(`bot`), ratedAt: null }, o: { rating: seedRating(`human`), ratedAt: null } },
            seedRating(`bot`),
        );
        expect(readRating(query, { kind: `human`, id: userId })).toEqual(expected.o);
        expect(readRating(query, { kind: `bot`, id: botId })).toEqual(seedRating(`bot`));
        expect(expected.o.rating).toBeGreaterThan(1000);
    });

    it('moves only the human when a human beats a bot many times, the bot unmoved and its other games unaffected', () => {
        const [userId = ``] = humans;
        const [botId = ``, otherId = ``] = bots;
        const opener = insertBotGame(query, { challengerBotId: botId, destBotId: otherId, challengerSide: `x`, timeControl: unlimited, opening: origin });
        recordFinish(query, opener, { winner: `o`, reason: `six-in-a-row` });
        const standing = readRating(query, { kind: `bot`, id: botId });
        const climb: number[] = [];
        for (let won = 0; won < 40; won++) {
            recordFinish(query, humanGame(userId, botId, won % 2 === 0 ? `x` : `o`), { winner: won % 2 === 0 ? `x` : `o`, reason: `six-in-a-row` });
            climb.push(readRating(query, { kind: `human`, id: userId }).rating);
        }
        expect(readRating(query, { kind: `bot`, id: botId })).toEqual(standing);
        expect(climb.every((value, index) => index === 0 || value >= (climb[index - 1] ?? 0))).toBe(true);
        expect(climb.at(-1)).toBeGreaterThan(1400);
        expect(foldRatings(finishedGameLog(query))).toEqual(storedRatings(query));
    });

    it('rates a human against the bot as it stood at the start, not after a bot game finished during the human game', () => {
        vi.useFakeTimers({ toFake: [`Date`] });
        vi.setSystemTime(new Date(`2026-10-01T00:00:00Z`));
        const [userId = ``] = humans;
        const [botId = ``, otherId = ``] = bots;
        const played = humanGame(userId, botId, `x`);
        vi.setSystemTime(new Date(`2026-10-01T00:00:05Z`));
        const during = insertBotGame(query, { challengerBotId: otherId, destBotId: botId, challengerSide: `x`, timeControl: unlimited, opening: origin });
        recordFinish(query, during, { winner: `x`, reason: `six-in-a-row` });
        const moved = readRating(query, { kind: `bot`, id: botId });
        expect(moved.rating).toBeLessThan(1500);
        vi.setSystemTime(new Date(`2026-10-01T00:00:09Z`));
        recordFinish(query, played, { winner: `x`, reason: `six-in-a-row` });
        const start = Date.parse(`2026-10-01T00:00:00Z`) / 1000;
        const expected = rateGame(
            { x: { kind: `human`, id: userId }, o: { kind: `bot`, id: botId }, winner: `x`, startedAt: start, finishedAt: start + 9 },
            { x: { rating: seedRating(`human`), ratedAt: null }, o: { rating: moved, ratedAt: start + 5 } },
            seedRating(`bot`),
        );
        expect(readRating(query, { kind: `human`, id: userId })).toEqual(expected.x);
        expect(readRating(query, { kind: `bot`, id: botId })).toEqual(moved);
        expect(foldRatings(finishedGameLog(query))).toEqual(storedRatings(query));
    });

    it('writes nothing for aborted and wall-time games', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: null, reason: `aborted` });
        recordFinish(query, humanGame(userId, botId, `x`), { winner: null, reason: `terminated` });
        expect(storedRatings(query).size).toBe(0);
    });

    it('rates a game at a bot level other than its default for nobody, and widens a deviation from the rated game before it, live as folded', () => {
        vi.useFakeTimers({ toFake: [`Date`] });
        vi.setSystemTime(new Date(`2026-10-01T00:00:00Z`));
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `six-in-a-row` });
        vi.setSystemTime(Date.now() + 10 * 86_400_000);
        const practice = insertGame(query, { userId, botId, userSide: `x`, timeControl: unlimited, opening: origin, level: { id: `quick`, label: `quick` } });
        recordFinish(query, practice, { winner: `x`, reason: `six-in-a-row` });
        const afterPractice = readRating(query, { kind: `human`, id: userId });
        vi.setSystemTime(Date.now() + 10 * 86_400_000);
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `six-in-a-row` });
        expect(finishedGameLog(query).map((game) => game.id)).not.toContain(practice);
        expect(sqlite.prepare(`select count(*) as n from game_ratings where game_id = ?`).get(practice)).toEqual({ n: 0 });
        expect(readRating(query, { kind: `human`, id: userId })).not.toEqual(afterPractice);
        expect(foldRatings(finishedGameLog(query))).toEqual(storedRatings(query));
        expect(recomputeRatings(query)).toBe(2);
    });

    it('rates a game its person started unrated for nobody, and widens a deviation from the rated game before it, live as folded', () => {
        vi.useFakeTimers({ toFake: [`Date`] });
        vi.setSystemTime(new Date(`2026-10-01T00:00:00Z`));
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `six-in-a-row` });
        vi.setSystemTime(Date.now() + 10 * 86_400_000);
        const unrated = insertGame(query, { userId, unratedByChoice: true, botId, userSide: `x`, timeControl: unlimited, opening: origin });
        recordFinish(query, unrated, { winner: `x`, reason: `six-in-a-row` });
        const afterUnrated = readRating(query, { kind: `human`, id: userId });
        vi.setSystemTime(Date.now() + 10 * 86_400_000);
        recordFinish(query, humanGame(userId, botId, `x`), { winner: `x`, reason: `six-in-a-row` });
        expect(finishedGameLog(query).map((game) => game.id)).not.toContain(unrated);
        expect(sqlite.prepare(`select count(*) as n from game_ratings where game_id = ?`).get(unrated)).toEqual({ n: 0 });
        expect(readRating(query, { kind: `human`, id: userId })).not.toEqual(afterUnrated);
        expect(foldRatings(finishedGameLog(query))).toEqual(storedRatings(query));
        expect(recomputeRatings(query)).toBe(2);
    });

    // Games finish out of creation order, as concurrent games do, hours or
    // weeks apart, and some are voided while live; the live path must widen
    // each deviation exactly as the fold does.
    function playRandomLog(seed: number): void {
        vi.useFakeTimers({ toFake: [`Date`] });
        vi.setSystemTime(new Date(`2026-10-01T00:00:00Z`));
        const random = seededRandom(seed);
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
            while (open.length > 0 && random() < 0.6) {
                const [gameId = ``] = open.splice(Math.floor(random() * open.length), 1);
                if (random() < 0.05) sqlite.prepare(`update games set voided_at = 1 where id = ?`).run(gameId);
                const roll = random();
                const winner: Side | null = roll < 0.1 ? null : roll < 0.55 ? `x` : `o`;
                vi.setSystemTime(Date.now() + Math.floor((random() < 0.1 ? 14 * 86_400 : 3_600) * random() * 1000));
                recordFinish(query, gameId, { winner, reason: winner === null ? `aborted` : `six-in-a-row` });
            }
        }
    }

    it('reproduces the live table exactly when the whole log is folded', () => {
        playRandomLog(20260925);
        const live = storedRatings(query);
        expect(live.size).toBe(humans.length + bots.length);
        expect([...live.values()].some(({ rating }) => !isProvisional(rating))).toBe(true);
        expect(foldRatings(finishedGameLog(query))).toEqual(live);
    });

    // Four hundred games played, then folded twice, outlast the default five
    // seconds on a busy machine.
    it('recomputes the same tables from the same log every time, equal to the live ones', () => {
        playRandomLog(20261001);
        const gameRows = () => sqlite.prepare(`select * from game_ratings order by game_id, side`).all();
        const live = { ratings: storedRatings(query), games: gameRows() };
        recomputeRatings(query);
        const first = { ratings: storedRatings(query), games: gameRows() };
        recomputeRatings(query);
        expect({ ratings: storedRatings(query), games: gameRows() }).toEqual(first);
        expect(first).toEqual(live);
    }, 30_000);

    it('finds a player\'s previous rated game through the seat indexes, without sorting, a bot\'s among its bot games alone', () => {
        const [userId = ``] = humans;
        const [botId = ``] = bots;
        const human = explainRatedAtBefore(query, { kind: `human`, id: userId }, 10).join(`\n`);
        const bot = explainRatedAtBefore(query, { kind: `bot`, id: botId }, 10).join(`\n`);
        expect(human).toContain(`USING INDEX games_user_finish_idx`);
        for (const index of [`games_challenger_finish_idx`, `games_dest_finish_idx`]) expect(bot).toContain(`USING INDEX ${index}`);
        expect(bot).not.toContain(`games_bot_finish_idx`);
        for (const plan of [human, bot]) {
            expect(plan).not.toMatch(/SCAN games\b/u);
            expect(plan).not.toContain(`TEMP B-TREE`);
        }
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
