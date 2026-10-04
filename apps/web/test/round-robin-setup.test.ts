import { describe, expect, it } from 'vitest';
import type { BotListing, DuelBotState } from '@hexo-arena/contract';
import {
    againSetupOf,
    clockClashes,
    gamesPerPairOf,
    isTest,
    joinReason,
    roundRobinSetupFromParams,
    roundRobinSetupPath,
    scheduleOf,
} from '../src/tournaments/round-robin';
import { gameCaption } from '../src/tournaments/words';

const wide = { turnMs: [5_000, 60_000] as [number, number], match: true, unlimited: true };

function bot(name: string, ownerName: string, overrides: Partial<BotListing> = {}): BotListing {
    return { name, ownerName, online: true, openForChallenges: true, rating: 1500, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: wide, ...overrides };
}

const state = (name: string, changes: Partial<DuelBotState> = {}): DuelBotState => ({ name, duelsByOthers: true, dueling: [], roundRobins: 0, ...changes });

const reads = (viewer: string | null, states: readonly DuelBotState[] = [], reserved: readonly string[] = []) => ({ viewer, states, reserved: new Set(reserved) });

describe('a round robin\'s setup', () => {
    it('carries its bots, strengths, games, clock, and opening in a link, and reads them back', () => {
        const setup = { bots: [{ name: `hextide`, level: null }, { name: `Pistol1`, level: `club` }, { name: `cinder`, level: null }], games: 4 as const, clock: { mode: `turn` as const, turnTimeMs: 20_000 }, opening: 3 as const };
        const path = roundRobinSetupPath(setup);
        expect(path).toBe(`/play/tournament?bots=hextide%2CPistol1%2Ccinder&level=Pistol1%3Aclub&games=4&clock=t20&opening=3`);
        expect(roundRobinSetupFromParams(new URLSearchParams(path.split(`?`)[1]))).toEqual(setup);
        expect(roundRobinSetupPath({ bots: [], games: null, clock: null, opening: null })).toBe(`/play/tournament`);
    });

    it('drops a bot named twice and past eight, and falls back to the defaults for what a link names wrongly', () => {
        const names = [`a1`, `A1`, `a2`, `a3`, `a4`, `a5`, `a6`, `a7`, `a8`, `a9`].join(`,`);
        const read = roundRobinSetupFromParams(new URLSearchParams({ bots: names, games: `8`, opening: `2`, clock: `forever` }));
        expect(read.bots.map((entry) => entry.name)).toEqual([`a1`, `a2`, `a3`, `a4`, `a5`, `a6`, `a7`, `a8`]);
        expect([read.games, read.opening, read.clock]).toEqual([null, null, null]);
    });

    it('opens a round robin over again with its bots at their strengths and its terms, a deleted bot left out', () => {
        const again = againSetupOf({
            entries: [
                { key: 1, bot: `hextide`, ownerName: `ana`, online: true, ratingAtStart: 2117, state: `playing` },
                { key: 2, bot: `Pistol1`, ownerName: `bruno`, online: true, ratingAtStart: null, state: `playing`, level: { id: `club`, label: `club` } },
                { key: 3, bot: `deleted bot`, ownerName: `deleted player`, deleted: true, online: false, ratingAtStart: 1500, state: `withdrawn`, reason: `deleted` },
            ],
            gamesPerPair: 2,
            timeControl: { mode: `turn`, turnTimeMs: 10_000 },
            openingPlies: 5,
        });
        expect(again).toEqual({ bots: [{ name: `hextide`, level: null }, { name: `Pistol1`, level: `club` }], games: 2, clock: { mode: `turn`, turnTimeMs: 10_000 }, opening: 5 });
    });
});

describe('which bots join a round robin', () => {
    it('takes a ready bot, and says why it cannot take one offline, closed to others, without a clock, held, busy, in its most events, or refusing others', () => {
        const ana = reads(`ana`, [state(`quietlake`, { duelsByOthers: false }), state(`devbot-b`, { dueling: [`devbot-c`], roundRobins: 1 })], [`sealbot`]);
        expect(joinReason(bot(`hextide`, `ana`), [], ana)).toBeNull();
        expect(joinReason(bot(`lantern`, `ana`, { online: false }), [], ana)).toBe(`offline`);
        expect(joinReason(bot(`pebble`, `bruno`, { openForChallenges: false }), [], ana)).toBe(`closed`);
        expect(joinReason(bot(`pebble`, `ana`, { openForChallenges: false }), [], ana)).toBeNull();
        expect(joinReason(bot(`mute`, `bruno`, { accepts: { turnMs: null, match: false, unlimited: true } }), [], ana)).toBe(`nothing`);
        expect(joinReason(bot(`sealbot`, `bruno`), [], ana)).toBe(`tournament`);
        expect(joinReason(bot(`busy`, `bruno`, { liveGames: 4 }), [], ana)).toBe(`busy`);
        expect(joinReason(bot(`devbot-b`, `devowner-b`), [], ana)).toBe(`events`);
        expect(joinReason(bot(`quietlake`, `dmitri`), [], ana)).toBe(`refused`);
        expect(joinReason(bot(`quietlake`, `dmitri`), [], reads(`dmitri`, [state(`quietlake`, { duelsByOthers: false })]))).toBeNull();
    });

    it('refuses a bot that leaves the field no clock in common, naming the bots it clashes with', () => {
        const slow = bot(`slow`, `ana`, { accepts: { turnMs: [40_000, 60_000], match: false, unlimited: false } });
        const quick = bot(`quick`, `bruno`, { accepts: { turnMs: [5_000, 20_000], match: false, unlimited: false } });
        const field = [bot(`hextide`, `ana`), quick];
        expect(joinReason(slow, field, reads(`ana`))).toBe(`clock`);
        expect(clockClashes(slow, field).map((each) => each.name)).toEqual([`quick`]);
        expect(clockClashes(bot(`any`, `cid`), field)).toEqual([]);
    });

    it('takes no ninth bot, and asks a bot already in the field only against the others', () => {
        const field = Array.from({ length: 8 }, (_, index) => bot(`bot${String(index)}`, `owner${String(index)}`));
        expect(joinReason(bot(`ninth`, `cid`), field, reads(`cid`))).toBe(`full`);
        expect(joinReason(field[0] ?? bot(`none`, `none`), field, reads(`cid`))).toBeNull();
    });

    it('makes a test of one person\'s bots alone, which takes up to ten games a pair', () => {
        expect(isTest([bot(`hextide`, `ana`), bot(`cinder`, `ana`), bot(`pebble`, `ana`)])).toBe(true);
        expect(isTest([bot(`hextide`, `ana`), bot(`cinder`, `ana`), bot(`pebble`, `bruno`)])).toBe(false);
        expect(gamesPerPairOf(false)).toEqual([2, 4]);
        expect(gamesPerPairOf(true)).toEqual([2, 4, 6, 10]);
    });
});

describe('a round robin\'s schedule', () => {
    it('meets every pair once: N - 1 rounds for an even field, N for an odd one, half the field at a time', () => {
        expect(scheduleOf(6, 2)).toEqual({ pairs: 15, rounds: 5, atOnce: 3, games: 30, gamesPerBot: 10 });
        expect(scheduleOf(3, 10)).toEqual({ pairs: 3, rounds: 3, atOnce: 1, games: 30, gamesPerBot: 20 });
        expect(scheduleOf(8, 4)).toEqual({ pairs: 28, rounds: 7, atOnce: 4, games: 112, gamesPerBot: 28 });
    });

    it('captions a game by its place among its pair\'s games', () => {
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Round robin by bruno`, round: 3, game: 1 })).toBe(`Round robin by bruno, round 3, game 1 of 2`);
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Round robin by ana`, round: 2, game: 1, leg: 4, of: 10, createdBy: `ana` })).toBe(`Round robin by ana, round 2, game 7 of 10`);
    });
});
