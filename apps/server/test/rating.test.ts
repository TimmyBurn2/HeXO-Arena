import { describe, expect, it } from 'vitest';
import { glicko2Update } from '../src/glicko2';
import {
    broughtTo,
    foldRatings,
    isProvisional,
    periodsBetween,
    rateGame,
    seedRating,
    type FinishedGame,
    type PlayerRating,
    type PlayerRef,
    type RatingStep,
    type Standing,
} from '../src/rating';

const human = { kind: `human` as const, id: `h1` };
const botA = { kind: `bot` as const, id: `b1` };
const botB = { kind: `bot` as const, id: `b2` };

const day = 86_400;
const start = 1_790_000_000;

function rating(value: number, deviation: number, volatility = 0.06): PlayerRating {
    return { rating: value, deviation, volatility };
}

// A player before their first rated game.
function fresh(value: PlayerRating): Standing {
    return { rating: value, ratedAt: null };
}

function game(x: PlayerRef, o: PlayerRef, winner: FinishedGame[`winner`], finishedAt = start, startedAt = finishedAt): FinishedGame {
    return { x, o, winner, startedAt, finishedAt };
}

// Step 6 of the paper over a number of periods, on the Glicko scale.
function widened(value: PlayerRating, periods: number): number {
    const phi = value.deviation / 173.7178;
    return Math.sqrt(phi * phi + periods * value.volatility * value.volatility) * 173.7178;
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
    it('moves both sides of a first bot-versus-bot game as glicko-2 at tau 0.5 does over a game that spans no period', () => {
        const before = { x: rating(1600, 120), o: rating(1500, 90) };
        const after = rateGame(game(botA, botB, `o`), { x: fresh(before.x), o: fresh(before.o) });
        const plainX = glicko2Update(before.x, [{ opponent: before.o, score: 0 }], 0.5, 0);
        const plainO = glicko2Update(before.o, [{ opponent: before.x, score: 1 }], 0.5, 0);
        expect(after).toEqual({ x: plainX, o: plainO });
    });

    it('moves only the human in a game against a bot, in full, against the bot as it stood at the start', () => {
        const before = { x: fresh(rating(1100, 150)), o: fresh(rating(1300, 150)) };
        const atStart = rating(1250, 60);
        for (const winner of [`x`, `o`] as const) {
            const after = rateGame(game(human, botA, winner), before, atStart);
            expect(after.x).toEqual(glicko2Update(before.x.rating, [{ opponent: atStart, score: winner === `x` ? 1 : 0 }], 0.5, 0));
            expect(after.o).toEqual(before.o.rating);
        }
    });

    it('rates the human on either side, the bot left as it stands', () => {
        const before = { x: fresh(rating(1300, 150)), o: fresh(rating(1100, 150)) };
        const after = rateGame(game(botA, human, `o`), before, rating(1300, 150));
        expect(after.o.rating).toBeGreaterThan(1100);
        expect(after.x).toEqual(before.x.rating);
    });

    it('caps a human game at 400 points, then holds the floor of 400', () => {
        const gain = rateGame(game(human, botA, `x`), { x: fresh(rating(1000, 500, 0.09)), o: fresh(rating(2500, 45)) }, rating(2500, 45));
        expect(gain.x.rating).toBe(1400);
        const loss = rateGame(game(human, botA, `o`), { x: fresh(rating(420, 100)), o: fresh(rating(400, 45)) }, rating(400, 45));
        expect(loss.x.rating).toBe(400);
    });

    it('refuses a decided game against a human without the bot as it stood at the start', () => {
        expect(() => rateGame(game(human, botA, `x`), { x: fresh(rating(1100, 150)), o: fresh(rating(1300, 150)) })).toThrow(/start/u);
    });

    it('caps a single game at 400 points either way', () => {
        const after = rateGame(game(botA, botB, `x`), { x: fresh(rating(1500, 500, 0.09)), o: fresh(rating(2500, 45)) });
        expect(after.x.rating).toBe(1900);
    });

    it('keeps every rating at or above 400', () => {
        const after = rateGame(game(botA, botB, `o`), { x: fresh(rating(420, 100)), o: fresh(rating(400, 45)) });
        expect(after.x.rating).toBe(400);
    });

    it('holds deviation at the 45 floor and volatility at the 0.1 cap', () => {
        const steady = rateGame(game(botA, botB, `x`), { x: fresh(rating(1500, 45, 0.01)), o: fresh(rating(1500, 45)) });
        expect(steady.x.deviation).toBe(45);
        const shocked = rateGame(game(botA, botB, `x`), { x: fresh(rating(1500, 100, 0.1)), o: fresh(rating(2500, 45)) });
        expect(shocked.x.volatility).toBe(0.1);
    });

    it('leaves both sides as they stood when the game has no winner', () => {
        const before = { x: { rating: rating(1100, 150), ratedAt: start - 30 * day }, o: fresh(rating(1300, 150)) };
        expect(rateGame(game(human, botA, null), before, rating(1300, 150))).toEqual({ x: before.x.rating, o: before.o.rating });
    });

    it('rates a game from the deviation each side brings to it', () => {
        const before = { x: { rating: rating(1600, 60), ratedAt: start - 30 * day }, o: { rating: rating(1500, 80), ratedAt: start - day } };
        const brought = { x: broughtTo(before.x, start), o: broughtTo(before.o, start) };
        const after = rateGame(game(botA, botB, `x`), before);
        expect(after.x).toEqual(glicko2Update(brought.x, [{ opponent: brought.o, score: 1 }], 0.5, 0));
        expect(after.o).toEqual(glicko2Update(brought.o, [{ opponent: brought.x, score: 0 }], 0.5, 0));
    });
});

describe('broughtTo', () => {
    it('counts rating periods at lichess\'s 0.21436 a day', () => {
        expect(periodsBetween(start, start + day)).toBeCloseTo(0.21436, 12);
        expect(periodsBetween(start, start + 30 * day)).toBeCloseTo(6.4308, 12);
        expect(periodsBetween(start, start - day)).toBe(0);
    });

    it('brings a first game the rating as it stands', () => {
        const seed = seedRating(`bot`);
        expect(broughtTo(fresh(seed), start + 365 * day)).toEqual(seed);
    });

    it('widens the deviation after an idle month by the volatility over 30 days of periods', () => {
        const settled = rating(1600, 60, 0.06);
        const brought = broughtTo({ rating: settled, ratedAt: start }, start + 30 * day);
        expect(brought.deviation).toBeCloseTo(widened(settled, 30 * 0.21436), 9);
        expect(brought.deviation).toBeCloseTo(65.56, 2);
        expect({ ...brought, deviation: 60 }).toEqual(settled);
    });

    it('adds nothing between two games in the same second', () => {
        const settled = rating(1600, 60, 0.06);
        expect(broughtTo({ rating: settled, ratedAt: start }, start)).toEqual(settled);
    });

    it('keeps the widened deviation inside its bounds', () => {
        const idle = broughtTo({ rating: rating(1500, 400, 0.1), ratedAt: start }, start + 10 * 365 * day);
        expect(idle.deviation).toBe(500);
    });
});

describe('foldRatings', () => {
    it('starts every player from the seed for their kind', () => {
        const table = foldRatings([game(human, botA, `x`)]);
        const direct = rateGame(game(human, botA, `x`), { x: fresh(seedRating(`human`)), o: fresh(seedRating(`bot`)) }, seedRating(`bot`));
        expect(table.get(`human:h1`)?.rating).toEqual(direct.x);
        expect(table.get(`bot:b1`)?.rating).toEqual(seedRating(`bot`));
    });

    it('moves only the human when a human beats a bot many times, the bot staying at its seed', () => {
        const log = Array.from({ length: 60 }, (_, index) => game(human, botA, `x`, start + index * 600));
        const steps: RatingStep[] = [];
        const table = foldRatings(log, (_, step) => steps.push(step));
        expect(table.get(`bot:b1`)?.rating).toEqual(seedRating(`bot`));
        expect(steps.every((step) => step.before.o === step.after.o)).toBe(true);
        const climbed = steps.map((step) => step.after.x.rating);
        expect(climbed.every((value, index) => index === 0 || value >= (climbed[index - 1] ?? 0))).toBe(true);
        expect(climbed.at(-1)).toBeGreaterThan(1500);
    });

    it('rates a human against the bot as it stood when their game started, not after the bot games finished during it', () => {
        const opener = game(botA, botB, `x`, start);
        const during = game(botA, botB, `x`, start + 2 * day);
        const humanGame = game(human, botA, `x`, start + 3 * day, start + day);
        const steps: RatingStep[] = [];
        foldRatings([opener, during, humanGame], (_, step) => steps.push(step));
        const [first, second, third] = steps;
        if (first === undefined || second === undefined || third === undefined) throw new Error(`a step is missing`);
        const expected = rateGame(humanGame, { x: fresh(seedRating(`human`)), o: { rating: second.after.x, ratedAt: start + 2 * day } }, first.after.x);
        expect(third.after.x).toEqual(expected.x);
        expect(third.after.x).not.toEqual(rateGame(humanGame, { x: fresh(seedRating(`human`)), o: { rating: second.after.x, ratedAt: null } }, second.after.x).x);
        expect(third.before.o).toEqual(second.after.x);
        expect(third.after.o).toEqual(second.after.x);
    });

    it('counts a bot game that finished in the second its human game started as before the start', () => {
        const opener = game(botA, botB, `x`, start);
        const humanGame = game(human, botA, `o`, start + day, start);
        const steps: RatingStep[] = [];
        foldRatings([opener, humanGame], (_, step) => steps.push(step));
        const atStart = steps[0]?.after.x;
        if (atStart === undefined) throw new Error(`no opener step`);
        expect(steps[1]?.after.x).toEqual(rateGame(humanGame, { x: fresh(seedRating(`human`)), o: { rating: atStart, ratedAt: start } }, atStart).x);
    });

    it('widens a bot by the time since its previous bot game, which a human game does not reset', () => {
        const opener = game(botA, botB, `x`, start);
        const log = [opener, game(human, botA, `x`, start + 10 * day), game(botA, botB, `x`, start + 20 * day)];
        const steps: RatingStep[] = [];
        foldRatings(log, (_, step) => steps.push(step));
        const last = steps[2];
        if (last === undefined) throw new Error(`no step for the last game`);
        const expected = rateGame(game(botA, botB, `x`, start + 20 * day), { x: { rating: last.before.x, ratedAt: start }, o: { rating: last.before.o, ratedAt: start } });
        expect(last.after).toEqual(expected);
    });

    it('chains each game from the ratings the previous games left, widened by the time between', () => {
        const opener = game(botA, botB, `x`, start);
        const rematch = game(botB, botA, `x`, start + 3 * day);
        const first = rateGame(opener, { x: fresh(seedRating(`bot`)), o: fresh(seedRating(`bot`)) });
        const second = rateGame(rematch, { x: { rating: first.o, ratedAt: start }, o: { rating: first.x, ratedAt: start } });
        const table = foldRatings([opener, rematch]);
        expect(table.get(`bot:b2`)?.rating).toEqual(second.x);
        expect(table.get(`bot:b1`)?.rating).toEqual(second.o);
    });

    it('widens each player by the time since their own previous rated game, which a game without a winner does not reset', () => {
        const log = [
            game(botA, botB, `x`, start),
            game(botB, human, `o`, start + 10 * day),
            game(botA, botB, null, start + 15 * day),
            game(botA, botB, `x`, start + 20 * day),
        ];
        const steps: RatingStep[] = [];
        const table = foldRatings(log, (_, step) => steps.push(step));
        const last = steps[3];
        if (last === undefined) throw new Error(`no step for the last game`);
        const expected = rateGame(log[3] ?? game(botA, botB, null), {
            x: { rating: last.before.x, ratedAt: start },
            o: { rating: last.before.o, ratedAt: start },
        });
        expect(table.get(`bot:b1`)?.rating).toEqual(expected.x);
        expect(table.get(`bot:b2`)?.rating).toEqual(expected.o);
    });

    it('skips games without a winner, so an unrated player gets no entry', () => {
        const table = foldRatings([game(human, botA, null)]);
        expect(table.size).toBe(0);
    });

    // Six even games a day against a field that plays as often: the
    // deviation that one full period per game held near 74.6 now falls
    // toward the floor.
    it('ranks a bot playing even games six times a day within 50 games, and settles it toward the floor', () => {
        const runner: PlayerRef = { kind: `bot`, id: `runner` };
        const field: PlayerRef[] = Array.from({ length: 6 }, (_, index) => ({ kind: `bot`, id: `f${String(index)}` }));
        const log: FinishedGame[] = [];
        for (let played = 0; played < 200; played++) {
            const at = start + Math.floor((played * day) / 6);
            const opponent = field[played % field.length] ?? runner;
            const partner = field[(played + 3) % field.length] ?? runner;
            const pair = field[(played + 1) % field.length] ?? runner;
            log.push(game(pair, partner, played % 2 === 0 ? `x` : `o`, at));
            log.push(game(runner, opponent, played % 2 === 0 ? `x` : `o`, at + 60));
        }
        const deviations: number[] = [];
        foldRatings(log, (rated, step) => {
            if (rated.x === runner) deviations.push(step.after.x.deviation);
        });
        const ranked = deviations.findIndex((deviation) => !isProvisional(rating(1500, deviation))) + 1;
        expect(ranked).toBeGreaterThan(0);
        expect(ranked).toBeLessThanOrEqual(50);
        expect(deviations.at(-1)).toBeLessThan(55);
    });
});
