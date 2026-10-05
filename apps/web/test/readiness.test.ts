import { describe, expect, it } from 'vitest';
import type { BotListing, TournamentBotState } from '@hexo-arena/contract';
import { clockClashes, eventReadiness, isTest } from '../src/play/readiness';

const wide = { turnMs: [5_000, 60_000] as [number, number], match: true, unlimited: true };

function bot(name: string, ownerName: string, overrides: Partial<BotListing> = {}): BotListing {
    return { name, ownerName, online: true, openForChallenges: true, rating: 1500, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: wide, ...overrides };
}

const state = (name: string, changes: Partial<TournamentBotState> = {}): TournamentBotState => ({ name, duelsByOthers: true, running: 0, ...changes });

const reads = (viewer: string | null, states: readonly TournamentBotState[] = [], reserved: readonly string[] = []) => ({ viewer, states, reserved: new Set(reserved) });

describe('which bots join a bot event', () => {
    it('takes a ready bot, and says why it cannot take one offline, closed to others, without a clock, held, busy, in its most events, or refusing others', () => {
        const ana = reads(`ana`, [state(`quietlake`, { duelsByOthers: false }), state(`devbot-b`, { running: 2 }), state(`devbot-c`, { running: 1 })], [`sealbot`]);
        expect(eventReadiness(bot(`hextide`, `ana`), [], ana)).toBeNull();
        expect(eventReadiness(bot(`lantern`, `ana`, { online: false }), [], ana)).toBe(`offline`);
        expect(eventReadiness(bot(`pebble`, `bruno`, { openForChallenges: false }), [], ana)).toBe(`closed`);
        // The viewer's own bot needs no open: an owner may test a bot kept closed to others.
        expect(eventReadiness(bot(`pebble`, `ana`, { openForChallenges: false }), [], ana)).toBeNull();
        expect(eventReadiness(bot(`mute`, `bruno`, { accepts: { turnMs: null, match: false, unlimited: true } }), [], ana)).toBe(`nothing`);
        expect(eventReadiness(bot(`sealbot`, `bruno`), [], ana)).toBe(`tournament`);
        expect(eventReadiness(bot(`busy`, `bruno`, { liveGames: 4 }), [], ana)).toBe(`busy`);
        expect(eventReadiness(bot(`devbot-b`, `devowner-b`), [], ana)).toBe(`events`);
        expect(eventReadiness(bot(`devbot-c`, `devowner-c`), [], ana)).toBeNull();
        expect(eventReadiness(bot(`quietlake`, `dmitri`), [], ana)).toBe(`refused`);
        expect(eventReadiness(bot(`quietlake`, `dmitri`), [], reads(`dmitri`, [state(`quietlake`, { duelsByOthers: false })]))).toBeNull();
    });

    it('refuses a bot that leaves the field no clock in common, naming the bots it clashes with', () => {
        const slow = bot(`slow`, `ana`, { accepts: { turnMs: [40_000, 60_000], match: false, unlimited: false } });
        const quick = bot(`quick`, `bruno`, { accepts: { turnMs: [5_000, 20_000], match: false, unlimited: false } });
        const field = [bot(`hextide`, `ana`), quick];
        expect(eventReadiness(slow, field, reads(`ana`))).toBe(`clock`);
        expect(clockClashes(slow, field).map((each) => each.name)).toEqual([`quick`]);
        expect(clockClashes(bot(`any`, `cid`), field)).toEqual([]);
    });

    it('takes no ninth bot, and asks a bot already in the field only against the others', () => {
        const field = Array.from({ length: 8 }, (_, index) => bot(`bot${String(index)}`, `owner${String(index)}`));
        expect(eventReadiness(bot(`ninth`, `cid`), field, reads(`cid`))).toBe(`full`);
        expect(eventReadiness(field[0] ?? bot(`none`, `none`), field, reads(`cid`))).toBeNull();
    });

    it('makes a test of one person\'s bots alone', () => {
        expect(isTest([bot(`hextide`, `ana`), bot(`cinder`, `ana`)])).toBe(true);
        expect(isTest([bot(`hextide`, `ana`), bot(`cinder`, `ana`), bot(`pebble`, `bruno`)])).toBe(false);
        expect(isTest([])).toBe(false);
    });
});
