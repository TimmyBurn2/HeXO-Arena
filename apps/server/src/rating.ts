import type { Side } from '@hexarena/contract';
import { glicko2Update, type Glicko2Rating } from './glicko2';

export const humanSeedRating = 1000;
export const botSeedRating = 1500;
export const seedDeviation = 500;
export const seedVolatility = 0.09;
export const deviationFloor = 45;
export const deviationCap = 500;
export const volatilityCap = 0.1;
export const ratingFloor = 400;
export const gameDeltaCap = 400;
export const rankableDeviation = 75;
export const glicko2Tau = 0.5;

export type PlayerRating = Glicko2Rating;

export interface PlayerRef {
    readonly kind: `human` | `bot`;
    readonly id: string;
}

/**
 * A finished game as the log holds it; a null winner (aborted, wall-time)
 * leaves every rating untouched.
 */
export interface FinishedGame {
    readonly x: PlayerRef;
    readonly o: PlayerRef;
    readonly winner: Side | null;
}

export interface RatedPlayer {
    readonly player: PlayerRef;
    readonly rating: PlayerRating;
}

export function seedRating(kind: PlayerRef[`kind`]): PlayerRating {
    return {
        rating: kind === `human` ? humanSeedRating : botSeedRating,
        deviation: seedDeviation,
        volatility: seedVolatility,
    };
}

export function isProvisional(rating: PlayerRating): boolean {
    return rating.deviation > rankableDeviation;
}

export function playerKey(player: PlayerRef): string {
    return `${player.kind}:${player.id}`;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function settle(game: FinishedGame, winner: Side, side: Side, before: Record<Side, PlayerRating>): PlayerRating {
    const other: Side = side === `x` ? `o` : `x`;
    const own = before[side];
    const raw = glicko2Update(own, [{ opponent: before[other], score: winner === side ? 1 : 0 }], glicko2Tau);
    const capped = clamp(raw.rating - own.rating, -gameDeltaCap, gameDeltaCap);
    // The halving valve: a human's result against a bot counts half, so
    // farming a weak bot pays half.
    const halved = game[side].kind === `human` && game[other].kind === `bot`;
    const after = own.rating + capped;
    return {
        rating: Math.max(ratingFloor, halved ? (own.rating + after) / 2 : after),
        deviation: clamp(raw.deviation, deviationFloor, deviationCap),
        volatility: Math.min(raw.volatility, volatilityCap),
    };
}

/**
 * Both sides' ratings after a game, each computed from the pre-game pair,
 * so neither side's update sees the other's; a game with no winner returns
 * the pair unchanged.
 * Every live update and every recomputation goes through here, which is
 * what makes the fold reproduce the stored table bit for bit.
 */
export function rateGame(game: FinishedGame, before: Record<Side, PlayerRating>): Record<Side, PlayerRating> {
    if (game.winner === null) return before;
    return { x: settle(game, game.winner, `x`, before), o: settle(game, game.winner, `o`, before) };
}

/**
 * Folds a game log, in finish order, into the rating of every player who
 * has a rated game, keyed by {@link playerKey}.
 * The fold is the ground truth: the stored ratings are its cache.
 */
export function foldRatings(log: Iterable<FinishedGame>): Map<string, RatedPlayer> {
    const table = new Map<string, RatedPlayer>();
    const current = (player: PlayerRef): PlayerRating =>
        table.get(playerKey(player))?.rating ?? seedRating(player.kind);
    for (const game of log) {
        if (game.winner === null) continue;
        const after = rateGame(game, { x: current(game.x), o: current(game.o) });
        table.set(playerKey(game.x), { player: game.x, rating: after.x });
        table.set(playerKey(game.o), { player: game.o, rating: after.o });
    }
    return table;
}
