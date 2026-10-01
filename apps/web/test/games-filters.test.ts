import { describe, expect, it } from 'vitest';
import { activeKeys, gamesPathOf, searchOf, viewOf, withFilter } from '../src/games/filters';

describe('viewOf', () => {
    it('read every filter and the cursor from an address', () => {
        expect(viewOf(`?player=hextide&vs=quietlake&result=won&side=x&reason=timeout&clock=turn&kind=bot-bot&opening=5&before=2026-09-01&cursor=2.381`)).toEqual({
            filters: { player: `hextide`, vs: `quietlake`, result: `won`, side: `x`, reason: `timeout`, clock: `turn`, kind: `bot-bot`, opening: `5`, before: `2026-09-01` },
            cursor: `2.381`,
        });
    });

    it('drop each value its filter does not take, and keep the rest', () => {
        expect(viewOf(`?clock=blitz&opening=4&before=yesterday&cursor=11.2&reason=timeout&utm=x`)).toEqual({ filters: { reason: `timeout` }, cursor: null });
    });

    it('drop what needs a player while none is named, keeping a game without a winner', () => {
        expect(viewOf(`?vs=quietlake&side=o&result=won`).filters).toEqual({});
        expect(viewOf(`?result=none`).filters).toEqual({ result: `none` });
    });

    it('drop an opponent who is the player, in any case', () => {
        expect(viewOf(`?player=hextide&vs=HexTide`).filters).toEqual({ player: `hextide` });
    });
});

describe('searchOf', () => {
    it('write the filters in a fixed order with the cursor last, and nothing for none', () => {
        expect(searchOf({ filters: { clock: `match`, player: `ana` }, cursor: `3.9` })).toBe(`?player=ana&clock=match&cursor=3.9`);
        expect(searchOf({ filters: {}, cursor: null })).toBe(``);
    });
});

describe('withFilter', () => {
    it('set one filter and return to the first page', () => {
        expect(withFilter({ player: `ana` }, `clock`, `turn`)).toBe(`/games?player=ana&clock=turn`);
    });

    it('clear a filter, and with the player gone, everything that needed it', () => {
        expect(withFilter({ player: `ana`, vs: `pebble`, side: `x`, result: `lost`, clock: `turn` }, `player`, undefined)).toBe(`/games?clock=turn`);
        expect(withFilter({ player: `ana`, result: `none` }, `player`, undefined)).toBe(`/games?result=none`);
    });
});

describe('activeKeys', () => {
    it('name the filters set, in their order', () => {
        expect(activeKeys({ before: `2026-09-01`, player: `ana`, clock: `turn` })).toEqual([`player`, `clock`, `before`]);
    });
});

describe('gamesPathOf', () => {
    it('lead to one player\'s games, or to two players\' meetings', () => {
        expect(gamesPathOf(`ana`)).toBe(`/games?player=ana`);
        expect(gamesPathOf(`ana`, `pebble`)).toBe(`/games?player=ana&vs=pebble`);
    });
});
