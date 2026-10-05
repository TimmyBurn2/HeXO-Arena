import type { BotListing } from '@hexo-arena/contract';
import { describe, expect, it } from 'vitest';
import { firstSetup, settle, setupReducer, shownBot, type ListFacts, type SetupState } from '../src/play/setup-state';

const bot = (name: string, liveGames = 0): BotListing => ({
    name,
    ownerName: `owner`,
    online: true,
    openForChallenges: true,
    rating: 1500,
    provisional: false,
    liveGames,
    levels: null,
    analyzer: null,
    accepts: { turnMs: [5000, 300000], match: true, unlimited: true },
});

// A list read holding these bots, opening on the address's bot while nothing was lost, else on the first ready one.
function factsOf(bots: readonly BotListing[], asked: string | null = null): ListFacts {
    const find = (name: string) => bots.find((listed) => listed.name === name) ?? null;
    const ready = (listed: BotListing) => listed.liveGames < 4;
    return {
        find,
        ready,
        open: (fromAddress) => (fromAddress && asked !== null ? find(asked) : null) ?? bots.find(ready) ?? null,
    };
}

const start = firstSetup({ bot: null, clock: null, opening: 5, level: null });

describe('a visit to Play', () => {
    it('opens on the bot to open on, then stays on it as the list changes', () => {
        const opened = settle(start, factsOf([bot(`hextide`), bot(`pebble`)]));
        expect(opened.opened).toBe(`hextide`);
        expect(settle(opened, factsOf([bot(`pebble`), bot(`hextide`)]))).toBe(opened);
    });

    it('names a picked bot that leaves the list and opens on another, past the address', () => {
        const picked = setupReducer(settle(start, factsOf([bot(`lantern`), bot(`pebble`)], `lantern`)), { kind: `pick`, bot: `pebble`, from: `pointer` });
        const left = settle(picked, factsOf([bot(`hextide`), bot(`lantern`)], `lantern`));
        expect(left).toMatchObject({ picked: null, opened: `hextide`, lost: `pebble` });
        expect(settle(left, factsOf([bot(`hextide`), bot(`lantern`)], `lantern`))).toBe(left);
    });

    it('gives the card back to a lost bot listed again before the person picks', () => {
        const opened = settle(start, factsOf([bot(`pebble`), bot(`hextide`)]));
        const lost = settle(opened, factsOf([bot(`hextide`)]));
        expect(lost).toMatchObject({ opened: `hextide`, lost: `pebble` });
        expect(settle(lost, factsOf([bot(`hextide`), bot(`pebble`)]))).toMatchObject({ opened: `pebble`, lost: null });
    });

    it('keeps the row of a bot the card showed while it was not ready', () => {
        const busy = settle(start, factsOf([bot(`sealbot`, 4)], `sealbot`));
        expect(busy.shown).toEqual([`sealbot`]);
        expect(shownBot(busy, factsOf([bot(`sealbot`, 4)]))?.name).toBe(`sealbot`);
    });

    it('counts a person\'s picks, and neither a clock the picker adjusts nor the sheet', () => {
        const clock = { mode: `turn`, turnTimeMs: 20_000 } as const;
        const steps: SetupState[] = [];
        let setup = start;
        for (const action of [
            { kind: `sheet`, open: true },
            { kind: `adjust`, clock },
            { kind: `clock`, clock },
            { kind: `opening`, opening: 3 },
            { kind: `level`, level: { bot: `hextide`, id: `quick` } },
            { kind: `rated` },
            { kind: `pick`, bot: `pebble`, from: `keys` },
        ] as const) {
            setup = setupReducer(setup, action);
            steps.push(setup);
        }
        expect(steps.map((step) => step.choices)).toEqual([0, 0, 1, 2, 3, 4, 5]);
        expect(setup).toMatchObject({ picked: `pebble`, strength: null, sheet: true, clock, opening: 3 });
        expect(setupReducer(setup, { kind: `pick`, bot: `hextide`, from: `pointer` }).sheet).toBe(false);
    });
});
