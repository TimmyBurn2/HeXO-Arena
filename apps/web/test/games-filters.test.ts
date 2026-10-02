import { describe, expect, it } from 'vitest';
import { activeKeys, gamesPathOf, pagePathOf, searchOf, viewOf, withFilter } from '../src/games/filters';

describe('viewOf', () => {
    it('read every filter and the page from an address', () => {
        expect(viewOf(`?player=hextide&vs=quietlake&result=won&side=x&reason=timeout&clock=turn&kind=bot-bot&opening=5&analyzed=1&before=2026-09-01&page=2`)).toEqual({
            filters: { player: `hextide`, vs: `quietlake`, result: `won`, side: `x`, reason: `timeout`, clock: `turn`, kind: `bot-bot`, opening: `5`, analyzed: `1`, before: `2026-09-01` },
            page: 2,
        });
    });

    it('drop each value its filter does not take, and keep the rest, on the first page', () => {
        expect(viewOf(`?clock=blitz&opening=4&before=yesterday&analyzed=yes&page=11&reason=timeout&utm=x`)).toEqual({ filters: { reason: `timeout` }, page: 1 });
        expect(viewOf(`?cursor=2.40`)).toEqual({ filters: {}, page: 1 });
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
    it('write the filters in a fixed order with the page last, the first page and no filter writing nothing', () => {
        expect(searchOf({ filters: { clock: `match`, player: `ana` }, page: 3 })).toBe(`?player=ana&clock=match&page=3`);
        expect(searchOf({ filters: { clock: `match` }, page: 1 })).toBe(`?clock=match`);
        expect(searchOf({ filters: { before: `2026-09-01`, analyzed: `1`, kind: `bot-bot` }, page: 1 })).toBe(`?kind=bot-bot&analyzed=1&before=2026-09-01`);
        expect(searchOf({ filters: {}, page: 1 })).toBe(``);
    });
});

describe('pagePathOf', () => {
    it('lead to another page of the same filters', () => {
        expect(pagePathOf({ player: `ana` }, 4)).toBe(`/games?player=ana&page=4`);
        expect(pagePathOf({ player: `ana` }, 1)).toBe(`/games?player=ana`);
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
