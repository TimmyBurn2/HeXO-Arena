// @vitest-environment jsdom
import type { BotListing, DuelDetail, Levels } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
    againPath,
    clockForPair,
    defaultDuelClock,
    duelClocks,
    duelStorageKey,
    gameCountsOf,
    kindOf,
    openingAllowed,
    ratedReason,
    readChoices,
    refusedBy,
    setupFromParams,
    takenByBoth,
    writeChoices,
} from '../src/duels/setup';
import { countdown, estimateRow, rowState, standingText, statusSentence, termsLine } from '../src/duels/words';

const wide = { turnMs: [5000, 300000], match: true, unlimited: true };
const bot = (name: string, ownerName: string, extra: Partial<BotListing> = {}): BotListing => ({
    name,
    ownerName,
    online: true,
    openForChallenges: true,
    rating: 1500,
    provisional: false,
    liveGames: 0,
    levels: null,
    analyzer: null,
    accepts: wide,
    ...extra,
});
const levels: Levels = { default: `steady`, list: [{ id: `easy`, label: `easy` }, { id: `steady`, label: `steady` }] };

describe('a duel setup', () => {
    afterEach(() => {
        window.localStorage.clear();
    });

    it('takes the clocks both bots take inside a duel\'s bounds, in whole 5 s turns', () => {
        const narrow = bot(`a`, `x`, { accepts: { turnMs: [12000, 240000], match: true, unlimited: true } });
        const other = bot(`b`, `y`, { accepts: { turnMs: [3000, 47000], match: false, unlimited: true } });
        expect(duelClocks(narrow, other)).toEqual({ turn: [15, 45], match: false });
        expect(duelClocks(bot(`c`, `x`), null)).toEqual({ turn: [5, 60], match: true });
        expect(takenByBoth({ mode: `unlimited` }, bot(`c`, `x`), bot(`d`, `y`))).toBe(false);
        expect(takenByBoth({ mode: `match`, mainTimeMs: 900_000, incrementMs: 0 }, bot(`c`, `x`), bot(`d`, `y`))).toBe(false);
        expect(refusedBy({ mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 }, narrow, other)?.name).toBe(`b`);
    });

    it('opens on 10 s a turn, else the first preset both take, else the shortest turn both take, and keeps a pick both take', () => {
        expect(defaultDuelClock(bot(`a`, `x`), bot(`b`, `y`), null)).toEqual({ mode: `turn`, turnTimeMs: 10_000 });
        const late = bot(`late`, `x`, { accepts: { turnMs: [15000, 40000], match: false, unlimited: false } });
        expect(defaultDuelClock(late, bot(`b`, `y`), null)).toEqual({ mode: `turn`, turnTimeMs: 20_000 });
        const odd = bot(`odd`, `x`, { accepts: { turnMs: [25000, 40000], match: false, unlimited: false } });
        expect(defaultDuelClock(odd, bot(`b`, `y`), null)).toEqual({ mode: `turn`, turnTimeMs: 25_000 });
        expect(clockForPair(bot(`a`, `x`), bot(`b`, `y`), { mode: `match`, mainTimeMs: 600_000, incrementMs: 5_000 }, null)).toEqual({ mode: `match`, mainTimeMs: 600_000, incrementMs: 5_000 });
        expect(clockForPair(odd, bot(`b`, `y`), { mode: `turn`, turnTimeMs: 10_000 }, null)).toEqual({ mode: `turn`, turnTimeMs: 25_000 });
    });

    it('makes two bots of one owner a test of up to 50 games, any others a duel of up to 10', () => {
        expect(kindOf(bot(`a`, `ana`), bot(`b`, `ana`))).toBe(`test`);
        expect(kindOf(bot(`a`, `ana`), bot(`b`, `bruno`))).toBe(`duel`);
        expect(gameCountsOf(`test`)).toEqual([2, 10, 20, 30, 50]);
        expect(gameCountsOf(`duel`)).toEqual([1, 2, 4, 6, 8, 10]);
        expect(openingAllowed(1, 2)).toBe(true);
        expect(openingAllowed(1, 4)).toBe(false);
    });

    it('rates only a duel its starter owns one side of, both at their rated strength, and never a test', () => {
        const mine = bot(`hextide`, `ana`);
        const theirs = bot(`Pistol1`, `bruno`, { levels });
        const none = { first: null, second: null };
        expect(ratedReason(mine, theirs, none, `ana`)).toEqual({ kind: `may`, own: `hextide` });
        expect(ratedReason(mine, theirs, none, `dee`)).toEqual({ kind: `neither` });
        expect(ratedReason(mine, theirs, { first: null, second: { id: `easy`, label: `easy` } }, `ana`)).toEqual({ kind: `strength`, bot: `Pistol1`, label: `easy` });
        expect(ratedReason(mine, bot(`pebble`, `ana`), none, `ana`)).toEqual({ kind: `both` });
        expect(ratedReason(mine, bot(`pebble`, `ana`), none, `bruno`)).toEqual({ kind: `owner`, owner: `ana` });
    });

    it('remembers the lengths and Rated in this browser, off and two games and twenty until changed', () => {
        expect(readChoices()).toEqual({ duelGames: 2, testGames: 20, rated: false });
        writeChoices({ testGames: 50, rated: true });
        expect(readChoices()).toEqual({ duelGames: 2, testGames: 50, rated: true });
        window.localStorage.setItem(duelStorageKey, JSON.stringify({ duelGames: 3, testGames: `x` }));
        expect(readChoices()).toEqual({ duelGames: 2, testGames: 20, rated: false });
    });
});

const duelBot = (name: string, ownerName: string) => ({ name, ownerName, ratingAtStart: 1500, now: { rating: 1500, provisional: false } });

function duel(changes: Partial<DuelDetail>): DuelDetail {
    return {
        id: `d_abcdefghjkmn`,
        kind: `duel`,
        status: `running`,
        startedBy: `bruno`,
        first: duelBot(`devbot-b`, `devowner-b`),
        second: duelBot(`devbot-c`, `devowner-c`),
        terms: { games: 4, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, rated: false },
        score: { first: 2, second: 0 },
        createdAt: `2026-10-03T12:00:00Z`,
        endedAt: null,
        games: [1, 2, 3, 4].map((game) => ({ game, x: game % 2 === 1 ? (`first` as const) : (`second` as const), gameId: null, state: game <= 2 ? (`played` as const) : game === 3 ? (`live` as const) : (`pending` as const), winner: game <= 2 ? (`first` as const) : null, reason: null, turns: null, opening: null })),
        live: [],
        ...changes,
    };
}

describe('the words a duel is said in', () => {
    it('says where a duel stands: live with the lead, over with the winner, cut short with why, stopped by whom', () => {
        expect(statusSentence(duel({}), 0, null)).toBe(`Game 3 of 4 is live; devbot-b leads 2-0.`);
        expect(statusSentence(duel({ status: `finished`, score: { first: 1, second: 3 } }), 0, null)).toBe(`devbot-c won the duel 3-1.`);
        const cut = duel({ status: `cut_short`, end: { reason: `offline`, bot: `second` }, games: duel({}).games.map((game) => (game.game > 2 ? { ...game, state: `not_played` as const } : game)) });
        expect(statusSentence(cut, 0, null)).toBe(`Cut short: devbot-c went offline before game 3; 2 games were not played.`);
        expect(statusSentence(duel({ status: `stopped`, end: { reason: `owner`, bot: `first` } }), 0, null)).toBe(`devowner-b stopped the duel after game 2; devbot-b 2, devbot-c 0.`);
        expect(statusSentence(duel({ status: `stopped`, end: { reason: `operator`, bot: null } }), 0, null)).toBe(`The operator stopped the duel after game 2; devbot-b 2, devbot-c 0.`);
    });

    it('says the reader stopped it as you, beside the terms\' Started by you', () => {
        expect(statusSentence(duel({ status: `stopped`, end: { reason: `starter`, bot: null } }), 0, `bruno`)).toBe(`You stopped the duel after game 2; devbot-b 2, devbot-c 0.`);
        expect(statusSentence(duel({ status: `stopped`, end: { reason: `owner`, bot: `first` } }), 0, `devowner-b`)).toBe(`You stopped the duel after game 2; devbot-b 2, devbot-c 0.`);
    });

    it('leaves a test\'s score to its head and estimate once over, and says a stopped one ended without a tally', () => {
        expect(statusSentence(duel({ status: `finished`, kind: `test`, score: { first: 2, second: 2 } }), 0, null)).toBe(`The test is over: all 4 games played.`);
        expect(statusSentence(duel({ status: `stopped`, kind: `test`, end: { reason: `starter`, bot: null } }), 0, null)).toBe(`bruno stopped the test after game 2.`);
    });

    it('names the games without a winner beside any score that leaves them out', () => {
        const games = duel({}).games.map((game) => (game.game === 2 ? { ...game, winner: null } : game));
        const drawn = duel({ games, score: { first: 1, second: 0 } });
        expect(statusSentence(drawn, 0, null)).toBe(`Game 3 of 4 is live; devbot-b leads 1-0, with 1 game without a winner.`);
        expect(standingText(drawn, games)).toBe(`devbot-b leads 1-0, with 1 game without a winner`);
        const level = duel({ status: `finished`, score: { first: 1, second: 1 }, games: games.map((game) => (game.game === 3 ? { ...game, state: `played` as const, winner: `second` as const } : game.game === 4 ? { ...game, state: `played` as const } : game)) });
        expect(statusSentence(level, 0, null)).toBe(`The duel ended level, 1-1, with 2 games without a winner.`);
        expect(rowState({ ...level, played: 4, results: level.games })).toBe(`Level, 1-1, with 2 games without a winner`);
    });

    it('counts a wait down in minutes and seconds, naming what a bot not ready ends', () => {
        expect(countdown(60)).toBe(`1:00`);
        expect(countdown(42)).toBe(`0:42`);
        expect(statusSentence(duel({ waiting: { bot: `second`, until: new Date(42_000).toISOString() } }), 0, null)).toBe(`Waiting for devbot-c to be ready; 0:42 left before the duel is cut short.`);
        expect(statusSentence(duel({ kind: `test`, waiting: { bot: `second`, until: new Date(60_000).toISOString() } }), 0, null)).toBe(`Waiting for devbot-c to be ready; 1:00 left before the test is cut short.`);
    });

    it('states the terms with the strengths, whether rated, and who started it', () => {
        const atLevel = duel({ second: { ...duelBot(`devbot-c`, `devowner-c`), ratingAtStart: null, level: { id: `easy`, label: `easy` } } });
        expect(termsLine(atLevel, `bruno`)).toBe(`4 games: 2 openings, each played twice with sides swapped; turn clock 10 s; 5-stone openings; devbot-c at easy; unrated. Started by you.`);
        expect(termsLine(duel({ kind: `test` }), null)).toBe(`4 games: 2 openings, each played twice with sides swapped; turn clock 10 s; 5-stone openings; a test, never rated. Started by bruno.`);
    });

    it('reads a list row: the live game, or a test\'s estimate, a sweep said as one', () => {
        const summary = { ...duel({}), played: 2, results: duel({}).games };
        expect(rowState(summary)).toBe(`Game 3 of 4 live`);
        const estimate = { games: 20, points: { first: 20, second: 0 }, rating: 417, low: 194, high: null, chance: 1, favored: `first` as const, verdict: `stronger` as const, narrowed: null };
        expect(estimateRow({ first: summary.first, second: summary.second, estimate })).toBe(`devbot-b won all 20; stronger`);
        expect(estimateRow({ first: summary.first, second: summary.second, estimate: { ...estimate, games: 2, points: { first: 2, second: 0 }, verdict: `too_close` } })).toBe(`devbot-b won all 2; too close to call`);
        expect(estimateRow({ first: summary.first, second: summary.second, estimate: { ...estimate, points: { first: 8, second: 12 }, rating: -70, favored: `second`, verdict: `too_close` } })).toBe(`devbot-c about +70, too close to call`);
    });
});

describe('a setup a link carries', () => {
    it('opens Duel again on the same bots, strengths, length, clock, and opening', () => {
        const over = duel({ status: `finished`, terms: { games: 6, openingPlies: 7, timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 }, rated: true } });
        const atLevel = { ...over, second: { ...over.second, level: { id: `easy`, label: `easy` } } };
        const path = againPath(atLevel);
        expect(path.startsWith(`/play/duels?`)).toBe(true);
        expect(setupFromParams(new URL(path, `http://h`).searchParams)).toEqual({
            first: `devbot-b`,
            second: `devbot-c`,
            levels: { first: null, second: `easy` },
            games: 6,
            clock: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 },
            opening: 7,
        });
    });

    it('falls back to the defaults for what a link names wrongly', () => {
        expect(setupFromParams(new URLSearchParams(`first=hextide&games=3&clock=forever&opening=4`))).toEqual({ first: `hextide`, second: null, levels: { first: null, second: null }, games: null, clock: null, opening: null });
    });
});
