import { describe, expect, it } from 'vitest';
import {
    createDuelRequestSchema,
    defaultDuelGames,
    defaultOpeningPlies,
    defaultTestGames,
    duelDailyCap,
    duelGameCounts,
    duelGamesMax,
    duelGamesOptions,
    duelIdSchema,
    duelListQuerySchema,
    duelLiveCap,
    duelMeta,
    duelPerBotCap,
    duelPerPairCap,
    gameDuelSchema,
    scheduledClockSchema,
    testGameCounts,
    type DuelSummary,
} from '../src';

const turn = (seconds: number) => ({ mode: `turn`, turnTimeMs: seconds * 1_000 });
const request = { first: `hextide`, second: `quietlake`, timeControl: turn(10) };

describe('createDuelRequestSchema', () => {
    it('plays one pair from a 5-ply opening, unrated, at both default levels unless asked otherwise', () => {
        const parsed = createDuelRequestSchema.parse(request);
        expect(parsed.games).toBe(defaultDuelGames);
        expect(defaultDuelGames).toBe(2);
        expect(parsed.openingPlies).toBe(defaultOpeningPlies);
        expect(parsed.rated).toBe(false);
        expect(parsed.levels).toBeUndefined();
    });

    it('takes a single game, one to five pairs, or a test\'s 10, 15, or 25 pairs, and nothing else', () => {
        for (const games of [1, 2, 4, 6, 8, 10, 20, 30, 50]) expect(createDuelRequestSchema.safeParse({ ...request, games }).success, String(games)).toBe(true);
        for (const games of [0, 3, 5, 12, 40, 52, 2.5]) expect(createDuelRequestSchema.safeParse({ ...request, games }).success, String(games)).toBe(false);
        expect(duelGameCounts).toEqual([1, 2, 4, 6, 8, 10]);
        expect(testGameCounts).toEqual([2, 10, 20, 30, 50]);
        expect([...duelGamesOptions].sort((a, b) => a - b)).toEqual([...new Set([...duelGameCounts, ...testGameCounts])].sort((a, b) => a - b));
        expect(Math.max(...duelGamesOptions)).toBe(duelGamesMax);
        expect([defaultDuelGames, defaultTestGames]).toEqual([2, 20]);
    });

    it('refuses one bot named twice, in any case', () => {
        expect(createDuelRequestSchema.safeParse({ ...request, second: `HexTide` }).success).toBe(false);
    });

    it('allows a 1-ply opening only for a single game or one pair', () => {
        expect(createDuelRequestSchema.safeParse({ ...request, openingPlies: 1, games: 1 }).success).toBe(true);
        expect(createDuelRequestSchema.safeParse({ ...request, openingPlies: 1, games: 2 }).success).toBe(true);
        expect(createDuelRequestSchema.safeParse({ ...request, openingPlies: 1, games: 4 }).success).toBe(false);
        expect(createDuelRequestSchema.safeParse({ ...request, openingPlies: 3, games: 10 }).success).toBe(true);
    });

    it('takes a turn clock of 5 to 60 s or a match clock of 1 to 10 min plus 0 to 10 s, never unlimited', () => {
        const fits = (timeControl: unknown) => createDuelRequestSchema.safeParse({ ...request, timeControl }).success;
        expect(fits(turn(5))).toBe(true);
        expect(fits(turn(60))).toBe(true);
        expect(fits(turn(61))).toBe(false);
        expect(fits({ mode: `match`, mainTimeMs: 600_000, incrementMs: 10_000 })).toBe(true);
        expect(fits({ mode: `match`, mainTimeMs: 660_000, incrementMs: 0 })).toBe(false);
        expect(fits({ mode: `match`, mainTimeMs: 60_000, incrementMs: 11_000 })).toBe(false);
        expect(fits({ mode: `unlimited` })).toBe(false);
        expect(scheduledClockSchema.safeParse({ mode: `unlimited` }).success).toBe(false);
    });

    it('takes a declared level id for either bot and refuses an unknown key', () => {
        expect(createDuelRequestSchema.parse({ ...request, levels: { second: `easy` } }).levels).toEqual({ second: `easy` });
        expect(createDuelRequestSchema.safeParse({ ...request, levels: { second: `Easy!` } }).success).toBe(false);
        expect(createDuelRequestSchema.safeParse({ ...request, side: `x` }).success).toBe(false);
    });
});

describe('the duel limits', () => {
    it('hold a person to 2 running and 10 a day, a pair to one running, and a bot to 2 running', () => {
        expect([duelLiveCap, duelDailyCap, duelPerPairCap, duelPerBotCap]).toEqual([2, 10, 1, 2]);
    });
});

describe('a duel as games and settings carry it', () => {
    it('names a game within the duel by its number and the duel length', () => {
        expect(gameDuelSchema.safeParse({ id: `d_abcdefghjkmn`, game: 2, of: 2 }).success).toBe(true);
        expect(gameDuelSchema.safeParse({ id: `d_abcdefghjkmn`, game: 50, of: 50 }).success).toBe(true);
        expect(gameDuelSchema.safeParse({ id: `d_abcdefghjkmn`, game: 0, of: 2 }).success).toBe(false);
        expect(gameDuelSchema.safeParse({ id: `d_abcdefghjkmn`, game: 51, of: 50 }).success).toBe(false);
        expect(duelIdSchema.safeParse(`d_abcdefghjkmn`).success).toBe(true);
        expect(duelIdSchema.safeParse(`s_abcdefghjkmn`).success).toBe(false);
        expect(duelIdSchema.safeParse(`t_abcdefghjkmn`).success).toBe(false);
    });
});

describe('the duel list query', () => {
    it('narrows to one bot, the caller\'s own, or one kind, and refuses anything else', () => {
        expect(duelListQuerySchema.parse({ bot: `hextide`, mine: `1`, kind: `test` })).toEqual({ bot: `hextide`, mine: `1`, kind: `test` });
        expect(duelListQuerySchema.safeParse({ kind: `series` }).success).toBe(false);
        expect(duelListQuerySchema.safeParse({ mine: `true` }).success).toBe(false);
        expect(duelListQuerySchema.safeParse({ page: `2` }).success).toBe(false);
    });
});

describe('a duel\'s page meta', () => {
    const bot = (name: string) => ({ name, ownerName: `ana`, ratingAtStart: 1500, now: { rating: 1500, provisional: false } });
    const summary = (changes: Partial<DuelSummary>): DuelSummary => ({
        id: `d_abcdefghjkmn`,
        kind: `duel`,
        status: `running`,
        startedBy: `bruno`,
        first: bot(`devbot-b`),
        second: bot(`devbot-c`),
        terms: { games: 10, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, rated: false },
        score: { first: 3, second: 0 },
        createdAt: `2026-10-03T12:00:00Z`,
        endedAt: null,
        played: 3,
        results: [],
        ...changes,
    });

    it('titles the pair and says the kind, the length, the clock, and how it stands', () => {
        expect(duelMeta(summary({}))).toEqual({
            title: `devbot-b vs devbot-c - HeXO Arena`,
            description: `Duel of 10 games between two bots, turn clock 10 s; running; devbot-b leads 3-0`,
        });
        expect(duelMeta(summary({ kind: `test`, status: `finished`, score: { first: 9, second: 11 } })).description).toBe(
            `Test of 10 games between two bots, turn clock 10 s; devbot-c won 9-11`,
        );
        expect(duelMeta(summary({ status: `stopped`, score: { first: 1, second: 1 } })).description).toMatch(/; stopped at 1-1$/u);
    });
});
