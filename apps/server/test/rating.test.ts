import { describe, expect, it } from 'vitest';
import { glicko2Update } from '../src/glicko2';
import {
    foldRatings,
    isProvisional,
    rateGame,
    seedRating,
    type FinishedGame,
    type PlayerRating,
} from '../src/rating';

const human = { kind: `human` as const, id: `h1` };
const botA = { kind: `bot` as const, id: `b1` };
const botB = { kind: `bot` as const, id: `b2` };

function rating(value: number, deviation: number, volatility = 0.06): PlayerRating {
    return { rating: value, deviation, volatility };
}

describe('seedRating', () => {
    it('seeds humans at 1000 and bots at 1500, both at deviation 500 and volatility 0.09', () => {
        expect(seedRating(`human`)).toEqual(rating(1000, 500, 0.09));
        expect(seedRating(`bot`)).toEqual(rating(1500, 500, 0.09));
    });
});

describe('isProvisional', () => {
    it('ranks a player at deviation 75 and marks anyone above it provisional', () => {
        expect(isProvisional(rating(1500, 75))).toBe(false);
        expect(isProvisional(rating(1500, 75.01))).toBe(true);
    });
});

describe('rateGame', () => {
    it('moves both sides of a bot-versus-bot game exactly as plain glicko-2 at tau 0.5 would', () => {
        const before = { x: rating(1600, 120), o: rating(1500, 90) };
        const after = rateGame({ x: botA, o: botB, winner: `o` }, before);
        const plainX = glicko2Update(before.x, [{ opponent: before.o, score: 0 }], 0.5);
        const plainO = glicko2Update(before.o, [{ opponent: before.x, score: 1 }], 0.5);
        expect(after).toEqual({ x: plainX, o: plainO });
    });

    it('averages a human result against a bot with the pre-game rating and leaves the bot whole', () => {
        const before = { x: rating(1100, 150), o: rating(1300, 150) };
        const asHuman = rateGame({ x: human, o: botA, winner: `x` }, before);
        const asBot = rateGame({ x: botB, o: botA, winner: `x` }, before);
        expect(asHuman.x.rating).toBeCloseTo((1100 + asBot.x.rating) / 2, 9);
        expect(asHuman.x.deviation).toBe(asBot.x.deviation);
        expect(asHuman.o).toEqual(asBot.o);
    });

    it('halves a human loss to a bot as well as a gain', () => {
        const before = { x: rating(1100, 150), o: rating(1300, 150) };
        const asHuman = rateGame({ x: human, o: botA, winner: `o` }, before);
        const asBot = rateGame({ x: botB, o: botA, winner: `o` }, before);
        expect(1100 - asHuman.x.rating).toBeCloseTo((1100 - asBot.x.rating) / 2, 9);
    });

    it('caps a single game at 400 points either way', () => {
        const after = rateGame(
            { x: botA, o: botB, winner: `x` },
            { x: rating(1500, 500, 0.09), o: rating(2500, 45) },
        );
        expect(after.x.rating).toBe(1900);
    });

    it('keeps every rating at or above 400', () => {
        const after = rateGame({ x: botA, o: botB, winner: `o` }, { x: rating(420, 100), o: rating(400, 45) });
        expect(after.x.rating).toBe(400);
    });

    it('holds deviation at the 45 floor and volatility at the 0.1 cap', () => {
        const steady = rateGame({ x: botA, o: botB, winner: `x` }, { x: rating(1500, 45, 0.01), o: rating(1500, 45) });
        expect(steady.x.deviation).toBe(45);
        const shocked = rateGame({ x: botA, o: botB, winner: `x` }, { x: rating(1500, 100, 0.1), o: rating(2500, 45) });
        expect(shocked.x.volatility).toBe(0.1);
    });

    it('leaves both sides untouched when the game has no winner', () => {
        const before = { x: rating(1100, 150), o: rating(1300, 150) };
        expect(rateGame({ x: human, o: botA, winner: null }, before)).toBe(before);
    });
});

describe('foldRatings', () => {
    it('starts every player from the seed for their kind', () => {
        const table = foldRatings([{ x: human, o: botA, winner: `x` }]);
        const direct = rateGame({ x: human, o: botA, winner: `x` }, { x: seedRating(`human`), o: seedRating(`bot`) });
        expect(table.get(`human:h1`)?.rating).toEqual(direct.x);
        expect(table.get(`bot:b1`)?.rating).toEqual(direct.o);
    });

    it('chains each game from the ratings the previous games left', () => {
        const opener: FinishedGame = { x: botA, o: botB, winner: `x` };
        const rematch: FinishedGame = { x: botB, o: botA, winner: `x` };
        const first = rateGame(opener, { x: seedRating(`bot`), o: seedRating(`bot`) });
        const second = rateGame(rematch, { x: first.o, o: first.x });
        const table = foldRatings([opener, rematch]);
        expect(table.get(`bot:b2`)?.rating).toEqual(second.x);
        expect(table.get(`bot:b1`)?.rating).toEqual(second.o);
    });

    it('skips games without a winner, so an unrated player gets no entry', () => {
        const table = foldRatings([{ x: human, o: botA, winner: null }]);
        expect(table.size).toBe(0);
    });
});
