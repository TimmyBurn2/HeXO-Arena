// @vitest-environment jsdom
import type { BotListing } from '@hexo-arena/contract';
import { afterEach, describe, expect, it } from 'vitest';
import {
    clockFor,
    clockFromParam,
    clockParam,
    openingFromParam,
    playPath,
    playStorageKey,
    preselect,
    presets,
    readinessOf,
    readPlayed,
    rosterOf,
    turnBounds,
    writePlayed,
} from '../src/play/setup';

const full = { turnMs: [5000, 300000], match: true, unlimited: true };
const bot = (name: string, rating: number, extra: Partial<BotListing> = {}): BotListing => ({
    name,
    ownerName: `owner`,
    online: true,
    openForChallenges: true,
    rating,
    provisional: false,
    liveGames: 0,
    accepts: full,
    ...extra,
});

const bots: BotListing[] = [
    bot(`sealbot`, 1712, { liveGames: 4 }),
    bot(`hextide`, 1690),
    bot(`devbot-c`, 1514),
    bot(`quietlake`, 1420, { accepts: { turnMs: [10000, 60000], match: false, unlimited: false } }),
    bot(`pebble`, 1388, { openForChallenges: false }),
    bot(`lantern`, 1500, { online: false, openForChallenges: false }),
    bot(`mute`, 1450, { accepts: { turnMs: null, match: false, unlimited: false } }),
];

afterEach(() => {
    window.localStorage.clear();
});

describe('readinessOf', () => {
    it('reads a bot as ready only online, open, accepting a clock, and under its game cap', () => {
        expect(bots.map((entry) => [entry.name, readinessOf(entry)])).toEqual([
            [`sealbot`, `busy`],
            [`hextide`, `ready`],
            [`devbot-c`, `ready`],
            [`quietlake`, `ready`],
            [`pebble`, `closed`],
            [`lantern`, `offline`],
            [`mute`, `nothing`],
        ]);
        expect(readinessOf(bot(`blank`, 1500, { accepts: undefined }))).toBe(`nothing`);
    });
});

describe('rosterOf', () => {
    it('lists the ready bots by rating, the busy ones after, and counts the rest', () => {
        const roster = rosterOf(bots, []);
        expect(roster.named).toEqual([]);
        expect(roster.ready.map((entry) => entry.name)).toEqual([`hextide`, `devbot-c`, `quietlake`]);
        expect(roster.busy.map((entry) => entry.name)).toEqual([`sealbot`]);
        expect(roster.others).toBe(3);
    });

    it('pins each named bot that is not ready first, once and in the order named, out of the count', () => {
        const roster = rosterOf(bots, [`PEBBLE`]);
        expect(roster.named.map((entry) => entry.name)).toEqual([`pebble`]);
        expect(roster.others).toBe(2);
        expect(rosterOf(bots, [`hextide`]).named).toEqual([]);
        const both = rosterOf(bots, [`lantern`, `pebble`, `Lantern`]);
        expect(both.named.map((entry) => entry.name)).toEqual([`lantern`, `pebble`]);
        expect(both.others).toBe(1);
    });
});

describe('preselect', () => {
    it('opens on the bot the link names, ready or not', () => {
        expect(preselect(bots, `Pebble`, null, null)?.name).toBe(`pebble`);
        expect(preselect(bots, `sealbot`, null, null)?.name).toBe(`sealbot`);
    });

    it('opens on the last bot played when it is ready, and not when it is not', () => {
        expect(preselect(bots, null, `hextide`, 1000)?.name).toBe(`hextide`);
        expect(preselect(bots, null, `pebble`, 1000)?.name).toBe(`quietlake`);
    });

    it('opens on the ready bot nearest the rating, a visitor counting as new, the higher on a tie', () => {
        expect(preselect(bots, null, null, 1500)?.name).toBe(`devbot-c`);
        expect(preselect(bots, null, null, null)?.name).toBe(`quietlake`);
        expect(preselect([bot(`low`, 1400), bot(`high`, 1600)], null, null, 1500)?.name).toBe(`high`);
    });

    it('falls back to a busy bot, and to nothing when none is ready or busy', () => {
        expect(preselect([bot(`sealbot`, 1712, { liveGames: 4 })], null, null, null)?.name).toBe(`sealbot`);
        expect(preselect([bot(`pebble`, 1388, { openForChallenges: false })], null, null, null)).toBe(null);
        expect(preselect(bots, `nobody`, null, 1500)?.name).toBe(`devbot-c`);
    });
});

describe('the clock', () => {
    const quietlake = bots[3] as BotListing;

    it('keeps the clock picked while the bot takes it, else the last started, else the first preset it takes', () => {
        const twenty = { mode: `turn`, turnTimeMs: 20_000 } as const;
        const match = { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 } as const;
        expect(clockFor(quietlake, twenty, null)).toEqual(twenty);
        expect(clockFor(quietlake, match, twenty)).toEqual(twenty);
        expect(clockFor(quietlake, match, match)).toEqual({ mode: `turn`, turnTimeMs: 10_000 });
        expect(clockFor(bot(`slow`, 1500, { accepts: { turnMs: [30000, 90000], match: false, unlimited: true } }), null, null)).toEqual({
            mode: `turn`,
            turnTimeMs: 60_000,
        });
    });

    it('sets a turn clock by hand in whole steps inside the window, never under the floor', () => {
        expect(turnBounds({ turnMs: [5000, 300000], match: true, unlimited: true })).toEqual({ min: 5, max: 300 });
        expect(turnBounds({ turnMs: [2000, 12000], match: false, unlimited: false })).toEqual({ min: 5, max: 10 });
        expect(turnBounds({ turnMs: [6000, 9000], match: false, unlimited: false })).toBe(null);
        expect(turnBounds({ turnMs: null, match: true, unlimited: false })).toBe(null);
    });

    it('writes a clock into the address and reads it back, refusing what a hand-set clock cannot be', () => {
        for (const preset of presets) {
            expect(clockParam(preset.clock)).toBe(preset.id);
            expect(clockFromParam(preset.id)).toEqual(preset.clock);
        }
        expect(clockParam({ mode: `turn`, turnTimeMs: 25_000 })).toBe(`turn-25`);
        expect(clockFromParam(`turn-25`)).toEqual({ mode: `turn`, turnTimeMs: 25_000 });
        expect(clockParam({ mode: `match`, mainTimeMs: 420_000, incrementMs: 4_000 })).toBe(`match-7-4`);
        expect(clockFromParam(`match-7-4`)).toEqual({ mode: `match`, mainTimeMs: 420_000, incrementMs: 4_000 });
        for (const bad of [`turn-3`, `turn-12`, `match-0-3`, `match-31-0`, `match-5-31`, `t15`, ``, null]) {
            expect(clockFromParam(bad)).toBe(null);
        }
    });
});

describe('the address', () => {
    it('carries the bot, the clock, and an opening other than the origin alone, the default', () => {
        expect(playPath(`devbot-c`, { mode: `turn`, turnTimeMs: 20_000 }, 1)).toBe(`/play?bot=devbot-c&clock=t20`);
        expect(playPath(`devbot-c`, { mode: `unlimited` }, 9)).toBe(`/play?bot=devbot-c&clock=u&opening=9`);
        expect(playPath(`devbot-c`, null, 5)).toBe(`/play?bot=devbot-c&opening=5`);
        expect(playPath(null, null, 1)).toBe(`/play`);
        expect(openingFromParam(`7`)).toBe(7);
        expect(openingFromParam(`4`)).toBe(1);
        expect(openingFromParam(null)).toBe(1);
    });
});

describe('what this browser remembers', () => {
    it('keeps the last opponent and clock a game started with, and never the opening', () => {
        expect(readPlayed()).toEqual({ opponent: null, clock: null });
        writePlayed(`hextide`, { mode: `turn`, turnTimeMs: 20_000 });
        expect(JSON.parse(window.localStorage.getItem(playStorageKey) ?? ``)).toEqual({ opponent: `hextide`, clock: `t20` });
        expect(readPlayed()).toEqual({ opponent: `hextide`, clock: { mode: `turn`, turnTimeMs: 20_000 } });
        window.localStorage.setItem(playStorageKey, `{not json`);
        expect(readPlayed()).toEqual({ opponent: null, clock: null });
    });
});
