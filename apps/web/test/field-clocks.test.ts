import type { BotListing } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { defaultFieldClock, fieldClocks, kindOf, refusersOf, shareClock, takenByAll } from '../src/duels/setup';
import { countdown } from '../src/duels/words';

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

describe('the clocks a field takes', () => {
    it('takes the clocks every bot takes inside a scheduled game\'s bounds, in whole 5 s turns', () => {
        const narrow = bot(`a`, `x`, { accepts: { turnMs: [12000, 240000], match: true, unlimited: true } });
        const other = bot(`b`, `y`, { accepts: { turnMs: [3000, 47000], match: false, unlimited: true } });
        expect(fieldClocks([narrow, other])).toEqual({ turn: [15, 45], match: false });
        expect(fieldClocks([bot(`c`, `x`)])).toEqual({ turn: [5, 60], match: true });
        expect(takenByAll({ mode: `unlimited` }, [bot(`c`, `x`), bot(`d`, `y`)])).toBe(false);
        expect(takenByAll({ mode: `match`, mainTimeMs: 900_000, incrementMs: 0 }, [bot(`c`, `x`), bot(`d`, `y`)])).toBe(false);
        expect(refusersOf({ mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 }, [narrow, other]).map((each) => each.name)).toEqual([`b`]);
        const apart = bot(`e`, `z`, { accepts: { turnMs: [50000, 60000], match: false, unlimited: false } });
        expect(shareClock(other, apart)).toBe(false);
        expect(shareClock(narrow, null)).toBe(true);
    });

    it('opens on 10 s a turn, else the first preset every bot takes, else the shortest turn every bot takes, and keeps a clock they all take', () => {
        expect(defaultFieldClock([bot(`a`, `x`), bot(`b`, `y`)], null)).toEqual({ mode: `turn`, turnTimeMs: 10_000 });
        const late = bot(`late`, `x`, { accepts: { turnMs: [15000, 40000], match: false, unlimited: false } });
        expect(defaultFieldClock([late, bot(`b`, `y`)], null)).toEqual({ mode: `turn`, turnTimeMs: 20_000 });
        const odd = bot(`odd`, `x`, { accepts: { turnMs: [25000, 40000], match: false, unlimited: false } });
        expect(defaultFieldClock([odd, bot(`b`, `y`)], null)).toEqual({ mode: `turn`, turnTimeMs: 25_000 });
        expect(defaultFieldClock([bot(`a`, `x`), bot(`b`, `y`)], { mode: `match`, mainTimeMs: 600_000, incrementMs: 5_000 })).toEqual({ mode: `match`, mainTimeMs: 600_000, incrementMs: 5_000 });
        expect(defaultFieldClock([odd, bot(`b`, `y`)], { mode: `turn`, turnTimeMs: 10_000 })).toEqual({ mode: `turn`, turnTimeMs: 25_000 });
    });

    it('makes two bots of one owner a test, any others a duel', () => {
        expect(kindOf(bot(`a`, `ana`), bot(`b`, `ana`))).toBe(`test`);
        expect(kindOf(bot(`a`, `ana`), bot(`b`, `bruno`))).toBe(`duel`);
    });

    it('counts a wait down in minutes and seconds', () => {
        expect(countdown(60)).toBe(`1:00`);
        expect(countdown(42)).toBe(`0:42`);
        expect(countdown(0)).toBe(`0:00`);
    });
});
