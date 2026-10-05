import { describe, expect, it } from 'vitest';
import { againSetupOf, countsInReach, gamesPerPairOf, scheduleOf, tournamentSetupFromParams, tournamentSetupPath } from '../src/tournaments/setup';
import { gameCaption } from '../src/tournaments/words';

describe('a duel\'s or round robin\'s setup', () => {
    it('carries its bots, strengths, games, clock, and opening in a link, and reads them back', () => {
        const setup = { bots: [{ name: `hextide`, level: null }, { name: `Pistol1`, level: `club` }, { name: `cinder`, level: null }], games: 4 as const, clock: { mode: `turn` as const, turnTimeMs: 20_000 }, opening: 3 as const };
        const path = tournamentSetupPath(setup);
        expect(path).toBe(`/play/tournament?bots=hextide%2CPistol1%2Ccinder&level=Pistol1%3Aclub&games=4&clock=t20&opening=3`);
        expect(tournamentSetupFromParams(new URLSearchParams(path.split(`?`)[1]))).toEqual(setup);
        expect(tournamentSetupPath({ bots: [], games: null, clock: null, opening: null })).toBe(`/play/tournament`);
    });

    it('drops a bot named twice and past eight, and falls back to the defaults for what a link names wrongly', () => {
        const names = [`a1`, `A1`, `a2`, `a3`, `a4`, `a5`, `a6`, `a7`, `a8`, `a9`].join(`,`);
        const read = tournamentSetupFromParams(new URLSearchParams({ bots: names, games: `12`, opening: `2`, clock: `forever` }));
        expect(read.bots.map((entry) => entry.name)).toEqual([`a1`, `a2`, `a3`, `a4`, `a5`, `a6`, `a7`, `a8`]);
        expect([read.games, read.opening, read.clock]).toEqual([null, null, null]);
    });

    it('opens one over again with its bots in their order at their strengths and its terms, a deleted bot left out', () => {
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

describe('the games a pair plays', () => {
    it('offers a single game or one to five openings, a test up to fifty games, those that would take a bot past its most out of reach', () => {
        expect(gamesPerPairOf(false)).toEqual([1, 2, 4, 6, 8, 10]);
        expect(gamesPerPairOf(true)).toEqual([1, 2, 4, 6, 8, 10, 20, 30, 50]);
        expect(countsInReach(2, false)).toEqual([1, 2, 4, 6, 8, 10]);
        expect(countsInReach(5, false)).toEqual([1, 2, 4, 6]);
        expect(countsInReach(3, true)).toEqual([1, 2, 4, 6, 8, 10, 20, 30]);
        expect(countsInReach(2, true)).toEqual([1, 2, 4, 6, 8, 10, 20, 30, 50]);
    });
});

describe('a round robin\'s schedule', () => {
    it('meets every pair once: N - 1 rounds for an even field, N for an odd one, half the field at a time', () => {
        expect(scheduleOf(6, 2)).toEqual({ pairs: 15, rounds: 5, atOnce: 3, games: 30, gamesPerBot: 10 });
        expect(scheduleOf(3, 10)).toEqual({ pairs: 3, rounds: 3, atOnce: 1, games: 30, gamesPerBot: 20 });
        expect(scheduleOf(8, 4)).toEqual({ pairs: 28, rounds: 7, atOnce: 4, games: 112, gamesPerBot: 28 });
    });

    it('captions a game by its place among its pair\'s games', () => {
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Round robin by bruno`, format: `round_robin`, round: 3, game: 1 })).toBe(`Round robin by bruno, round 3, game 1 of 2`);
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Round robin by ana`, format: `round_robin`, round: 2, game: 1, leg: 4, of: 10, createdBy: `ana` })).toBe(`Round robin by ana, round 2, game 7 of 10`);
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Duel by ana`, format: `duel`, round: 1, game: 2, leg: 2, of: 10, createdBy: `ana` })).toBe(`Duel, game 4 of 10`);
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Duel by ana`, format: `duel`, round: 1, game: 1, leg: 25, of: 50, createdBy: `ana` }, true)).toBe(`Test, game 49 of 50`);
        expect(gameCaption({ id: `t_abcdefghjkmn`, name: `Duel by ana`, format: `duel`, round: 1, game: 1, leg: 1, of: 1, createdBy: `ana` })).toBe(`Duel, game 1 of 1`);
    });
});
