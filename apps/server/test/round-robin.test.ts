import { describe, expect, it } from 'vitest';
import { missedTwoInARow, pointOf, roundRobin, standingsOf, type ScoredPairing, type SlotResult } from '../src/round-robin';

const field = (size: number) => Array.from({ length: size }, (_, index) => `bot${String(index + 1)}`);

const won = (winner: `first` | `second` | null): SlotResult => ({ kind: `played`, winner });
const noShow = (missing: `first` | `second` | `both`): SlotResult => ({ kind: `no_show`, missing });

function pairing(round: number, first: string, second: string, games: readonly [SlotResult, SlotResult]): ScoredPairing {
    return { round, first, second, games };
}

describe('roundRobin', () => {
    it.each([3, 4, 5, 6, 7, 8, 11, 12])('pairs every two of %i bots exactly once, each bot at most once a round', (size) => {
        const bots = field(size);
        const rounds = roundRobin(bots);
        expect(rounds).toHaveLength(size % 2 === 0 ? size - 1 : size);
        expect(rounds.map((round) => round.round)).toEqual(rounds.map((_, index) => index + 1));
        const met = new Set<string>();
        for (const round of rounds) {
            const seated = round.pairings.flatMap((pairing) => [pairing.first, pairing.second]);
            expect(new Set(seated).size).toBe(seated.length);
            expect(round.pairings).toHaveLength(Math.floor(size / 2));
            for (const { first, second } of round.pairings) {
                const key = [first, second].sort().join(` `);
                expect(met.has(key)).toBe(false);
                met.add(key);
            }
        }
        expect(met.size).toBe((size * (size - 1)) / 2);
    });

    it.each([3, 5, 7, 11])('rests each of %i bots exactly once, and nobody in an even field', (size) => {
        const rests = roundRobin(field(size)).map((round) => round.rest);
        expect([...rests].sort()).toEqual([...field(size)].sort());
        expect(roundRobin(field(size + 1)).every((round) => round.rest === null)).toBe(true);
    });

    it('opens no bot with x more than one game in three over a long field', () => {
        const bots = field(12);
        const firsts = new Map(bots.map((bot) => [bot, 0]));
        for (const round of roundRobin(bots)) for (const { first } of round.pairings) firsts.set(first, (firsts.get(first) ?? 0) + 1);
        for (const count of firsts.values()) expect(Math.abs(count - 5.5)).toBeLessThanOrEqual(3);
    });

    it('draws the same schedule from the same field', () => {
        expect(roundRobin(field(9))).toEqual(roundRobin(field(9)));
    });
});

describe('pointOf', () => {
    it.each([
        [won(`first`), `first`],
        [won(null), null],
        [noShow(`first`), `second`],
        [noShow(`both`), null],
        [{ kind: `forfeit`, withdrawn: `second` } as const, `first`],
        [{ kind: `forfeit`, withdrawn: `both` } as const, null],
        [{ kind: `not_played` } as const, null],
        [{ kind: `aborted` } as const, null],
        [{ kind: `pending` } as const, null],
        [{ kind: `live` } as const, null],
    ] as const)('scores %j for %s', (result, seat) => {
        expect(pointOf(result)).toBe(seat);
    });
});

describe('standingsOf', () => {
    it('counts a point per game won, split by the side it was won as', () => {
        // a plays x in game 1 against b and wins; b wins game 2 as x.
        const standings = standingsOf([`a`, `b`, `c`], [
            pairing(1, `a`, `b`, [won(`first`), won(`second`)]),
            pairing(2, `c`, `a`, [won(`second`), won(`second`)]),
            pairing(3, `b`, `c`, [won(null), noShow(`second`)]),
        ]);
        expect(standings).toEqual([
            { rank: 1, bot: `a`, points: 3, asX: 2, asO: 1 },
            { rank: 2, bot: `b`, points: 2, asX: 1, asO: 1 },
            { rank: 3, bot: `c`, points: 0, asX: 0, asO: 0 },
        ]);
    });

    it('breaks a tie on points by the points the tied bots took from each other', () => {
        // a and b both reach 2, a by beating b twice.
        const standings = standingsOf([`a`, `b`, `c`], [
            pairing(1, `a`, `b`, [won(`first`), won(`first`)]),
            pairing(2, `b`, `c`, [won(`first`), won(`first`)]),
            pairing(3, `c`, `a`, [won(null), won(null)]),
        ]);
        expect(standings.map((line) => [line.bot, line.points, line.rank])).toEqual([
            [`a`, 2, 1],
            [`b`, 2, 2],
            [`c`, 0, 3],
        ]);
    });

    it('breaks equal head-to-head points by Sonneborn-Berger', () => {
        // d and e split their pairing and reach 2 each; d took its other point
        // from a, the leader, and e from z, who scored nothing.
        const standings = standingsOf([`a`, `d`, `e`, `z`], [
            pairing(1, `a`, `z`, [won(`first`), won(`first`)]),
            pairing(1, `d`, `e`, [won(`first`), won(`second`)]),
            pairing(2, `a`, `d`, [won(`first`), won(`second`)]),
            pairing(2, `e`, `z`, [won(`first`), won(null)]),
            pairing(3, `a`, `e`, [won(`first`), won(`first`)]),
            pairing(3, `d`, `z`, [won(null), won(null)]),
        ]);
        expect(standings.map((line) => [line.bot, line.points, line.rank])).toEqual([
            [`a`, 5, 1],
            [`d`, 2, 2],
            [`e`, 2, 3],
            [`z`, 0, 4],
        ]);
    });

    it('shares the rank of bots tied on every count', () => {
        // Each beats the next twice: a circle, every total 2.
        const circle = standingsOf([`a`, `b`, `c`], [
            pairing(1, `a`, `b`, [won(`first`), won(`first`)]),
            pairing(2, `b`, `c`, [won(`first`), won(`first`)]),
            pairing(3, `c`, `a`, [won(`first`), won(`first`)]),
        ]);
        expect(circle.map((line) => [line.bot, line.points, line.rank])).toEqual([
            [`a`, 2, 1],
            [`b`, 2, 1],
            [`c`, 2, 1],
        ]);
    });

    it('lists a bot that scored nothing, and counts no-shows and withdrawals for the bot that remained', () => {
        const standings = standingsOf([`a`, `b`, `c`, `d`], [
            pairing(1, `a`, `b`, [noShow(`second`), noShow(`second`)]),
            pairing(1, `c`, `d`, [{ kind: `forfeit`, withdrawn: `first` }, { kind: `not_played` }]),
        ]);
        expect(standings.map((line) => [line.bot, line.points])).toEqual([
            [`a`, 2],
            [`d`, 1],
            [`b`, 0],
            [`c`, 0],
        ]);
        expect(standings.find((line) => line.bot === `d`)).toMatchObject({ asX: 0, asO: 1 });
    });
});

describe('missedTwoInARow', () => {
    it.each([
        [`missed both games of two pairings in a row`, [[noShow(`second`), noShow(`second`)], [noShow(`first`), noShow(`both`)]], true],
        [`showed for one game of the second`, [[noShow(`second`), noShow(`second`)], [noShow(`first`), won(`first`)]], false],
        [`missed two with a played pairing between`, [[noShow(`second`), noShow(`second`)], [won(null), won(null)], [noShow(`first`), noShow(`first`)]], false],
        [`missed one, the next still running`, [[noShow(`second`), noShow(`second`)], [noShow(`first`), { kind: `live` }]], false],
    ] as const)('%s: %s', (_, rounds, expected) => {
        // b sits second in the first pairing and first in the others.
        const pairings = rounds.map((games, index) => (index === 0 ? pairing(1, `a`, `b`, games) : pairing(index + 1, `b`, `c`, games)));
        expect(missedTwoInARow(`b`, pairings)).toBe(expected);
    });
});
