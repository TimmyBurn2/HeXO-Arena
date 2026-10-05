import { describe, expect, it } from 'vitest';
import { activeKeys, gamesPathOf, pagePathOf, searchOf, shownKeys, tournamentGamesPath, viewOf, withFilter } from '../src/games/filters';

describe('viewOf', () => {
    it('read every filter and the page from an address', () => {
        expect(viewOf(`?player=hextide&vs=quietlake&result=won&side=x&reason=timeout&clock=turn&kind=bot-bot&event=none&opening=5&analyzed=1&before=2026-09-01&page=2`)).toEqual({
            filters: { player: `hextide`, vs: `quietlake`, result: `won`, side: `x`, reason: `timeout`, clock: `turn`, kind: `bot-bot`, event: `none`, opening: `5`, analyzed: `1`, before: `2026-09-01` },
            page: 2,
        });
    });

    it('drop each value its filter does not take, and keep the rest, on the first page', () => {
        expect(viewOf(`?clock=blitz&opening=4&before=yesterday&analyzed=yes&event=series&page=11&reason=timeout&utm=x`)).toEqual({ filters: { reason: `timeout` }, page: 1 });
        expect(viewOf(`?cursor=2.40`)).toEqual({ filters: {}, page: 1 });
    });

    it('drop what needs a player while none is named, keeping a game without a winner', () => {
        expect(viewOf(`?vs=quietlake&side=o&result=won`).filters).toEqual({});
        expect(viewOf(`?result=none`).filters).toEqual({ result: `none` });
    });

    it('drop an opponent who is the player, in any case', () => {
        expect(viewOf(`?player=hextide&vs=HexTide`).filters).toEqual({ player: `hextide` });
    });

    it('read one tournament and one of its rounds under the kind of event it is', () => {
        expect(viewOf(`?event=tournament&tournament=t_autumnrobin1&round=2`).filters).toEqual({ event: `tournament`, tournament: `t_autumnrobin1`, round: `2` });
        expect(viewOf(`?event=tournament&tournament=d_abcdefghijkl&player=hextide`).filters).toEqual({ player: `hextide`, event: `tournament`, tournament: `d_abcdefghijkl` });
    });

    it('read an older address\'s duel as the tournament that duel is', () => {
        expect(viewOf(`?event=duel&duel=d_abcdefghijkl&player=hextide`).filters).toEqual({ player: `hextide`, event: `tournament`, tournament: `d_abcdefghijkl` });
        expect(viewOf(`?duel=d_abcdefghijkl`).filters).toEqual({ event: `tournament`, tournament: `d_abcdefghijkl` });
        expect(viewOf(`?event=duel`).filters).toEqual({ event: `tournament` });
        expect(viewOf(`?event=duel&duel=nope&tournament=t_autumnrobin1`).filters).toEqual({ event: `tournament`, tournament: `t_autumnrobin1` });
    });

    it('take the kind of event from the tournament a hand-made address names alone', () => {
        expect(viewOf(`?tournament=t_autumnrobin1&round=3`).filters).toEqual({ event: `tournament`, tournament: `t_autumnrobin1`, round: `3` });
    });

    it('drop a tournament under games of none, a round of no tournament, and an id or a round it cannot be', () => {
        expect(viewOf(`?event=none&tournament=t_autumnrobin1&round=2`).filters).toEqual({ event: `none` });
        expect(viewOf(`?round=2`).filters).toEqual({});
        expect(viewOf(`?event=tournament&tournament=nope`).filters).toEqual({ event: `tournament` });
        expect(viewOf(`?tournament=t_autumnrobin1&round=0`).filters).toEqual({ event: `tournament`, tournament: `t_autumnrobin1` });
    });
});

describe('searchOf', () => {
    it('write the filters in a fixed order with the page last, the first page and no filter writing nothing', () => {
        expect(searchOf({ filters: { clock: `match`, player: `ana` }, page: 3 })).toBe(`?player=ana&clock=match&page=3`);
        expect(searchOf({ filters: { clock: `match` }, page: 1 })).toBe(`?clock=match`);
        expect(searchOf({ filters: { before: `2026-09-01`, analyzed: `1`, event: `none`, kind: `bot-bot` }, page: 1 })).toBe(`?kind=bot-bot&event=none&analyzed=1&before=2026-09-01`);
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

    it('clear the one tournament chosen back to its kind, and with another kind or another tournament, what belonged to the last', () => {
        const duel = { event: `tournament`, tournament: `d_abcdefghijkl`, clock: `turn` } as const;
        expect(withFilter(duel, `tournament`, undefined)).toBe(`/games?clock=turn&event=tournament`);
        expect(withFilter(duel, `event`, `none`)).toBe(`/games?clock=turn&event=none`);
        expect(withFilter(duel, `event`, undefined)).toBe(`/games?clock=turn`);
        const round = { event: `tournament`, tournament: `t_autumnrobin1`, round: `2` } as const;
        expect(withFilter(round, `tournament`, `t_wintercup202`)).toBe(`/games?event=tournament&tournament=t_wintercup202`);
        expect(withFilter(round, `tournament`, undefined)).toBe(`/games?event=tournament`);
        expect(withFilter(round, `round`, `3`)).toBe(`/games?event=tournament&tournament=t_autumnrobin1&round=3`);
    });
});

describe('the games of one event', () => {
    it('lead to a tournament\'s games, a duel\'s among them, or one round\'s', () => {
        expect(tournamentGamesPath(`d_abcdefghijkl`)).toBe(`/games?event=tournament&tournament=d_abcdefghijkl`);
        expect(tournamentGamesPath(`t_autumnrobin1`)).toBe(`/games?event=tournament&tournament=t_autumnrobin1`);
        expect(tournamentGamesPath(`t_autumnrobin1`, 2)).toBe(`/games?event=tournament&tournament=t_autumnrobin1&round=2`);
    });

    it('show the one event chosen in place of its kind', () => {
        expect(shownKeys({ player: `ana`, event: `tournament`, tournament: `d_abcdefghijkl` })).toEqual([`player`, `tournament`]);
        expect(shownKeys({ event: `tournament`, tournament: `t_autumnrobin1`, round: `2` })).toEqual([`tournament`, `round`]);
        expect(shownKeys({ event: `tournament` })).toEqual([`event`]);
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
