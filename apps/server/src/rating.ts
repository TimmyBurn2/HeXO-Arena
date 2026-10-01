import { humanSeedRating, rankableDeviation, type Side } from '@hexo-arena/contract';
import { glicko2Update, type Glicko2Rating } from './glicko2';

export const botSeedRating = 1500;
export const seedDeviation = 500;
export const seedVolatility = 0.09;
export const deviationFloor = 45;
export const deviationCap = 500;
export const volatilityCap = 0.1;
export const ratingFloor = 400;
export const gameDeltaCap = 400;
export const glicko2Tau = 0.5;
// lichess's rate, lila's Glicko.periodsPerDay: one period about every
// 4.7 days, so an active player's deviation settles toward the floor.
export const ratingPeriodsPerDay = 0.21436;
const secondsPerDay = 86_400;

export type PlayerRating = Glicko2Rating;

export interface PlayerRef {
    readonly kind: `human` | `bot`;
    readonly id: string;
}

/**
 * A finished game as the log holds it, with its finish in epoch seconds;
 * a null winner (aborted, wall-time) leaves every rating untouched.
 */
export interface FinishedGame {
    readonly x: PlayerRef;
    readonly o: PlayerRef;
    readonly winner: Side | null;
    readonly finishedAt: number;
}

/**
 * A player's rating between games, with the finish of their last rated
 * game in epoch seconds; null before their first.
 */
export interface Standing {
    readonly rating: PlayerRating;
    readonly ratedAt: number | null;
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

/** The rating periods between two finishes in epoch seconds, at lichess's rate; never negative. */
export function periodsBetween(from: number, to: number): number {
    return (Math.max(0, to - from) / secondsPerDay) * ratingPeriodsPerDay;
}

/**
 * The rating a player brings to a game finished at `at`: the deviation
 * widens by the volatility over the periods since their previous rated
 * game, inside its bounds; a first game brings the rating as it stands.
 */
export function broughtTo(standing: Standing, at: number): PlayerRating {
    const periods = standing.ratedAt === null ? 0 : periodsBetween(standing.ratedAt, at);
    if (periods === 0) return standing.rating;
    const widened = glicko2Update(standing.rating, [], glicko2Tau, periods);
    return { ...standing.rating, deviation: clamp(widened.deviation, deviationFloor, deviationCap) };
}

function settle(game: FinishedGame, winner: Side, side: Side, brought: Record<Side, PlayerRating>): PlayerRating {
    const other: Side = side === `x` ? `o` : `x`;
    const own = brought[side];
    // The time since the previous game already widened the deviation, so
    // the game itself spans no period.
    const raw = glicko2Update(own, [{ opponent: brought[other], score: winner === side ? 1 : 0 }], glicko2Tau, 0);
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
 * the pair as it stood.
 * Every live update and every recomputation goes through here, which is
 * what makes the fold reproduce the stored table bit for bit.
 */
export function rateGame(game: FinishedGame, before: Record<Side, Standing>): Record<Side, PlayerRating> {
    if (game.winner === null) return { x: before.x.rating, o: before.o.rating };
    const brought = { x: broughtTo(before.x, game.finishedAt), o: broughtTo(before.o, game.finishedAt) };
    return { x: settle(game, game.winner, `x`, brought), o: settle(game, game.winner, `o`, brought) };
}

/** Both sides' ratings around one game of the fold; after is before for a game that rates nobody. */
export interface RatingStep {
    readonly before: Record<Side, PlayerRating>;
    readonly after: Record<Side, PlayerRating>;
}

/**
 * Folds a game log, in finish order, into the rating of every player who
 * has a rated game, keyed by {@link playerKey}, handing each game's step
 * to `visit` on the way.
 * The fold is the ground truth: the stored ratings are its cache.
 */
export function foldRatings<Game extends FinishedGame>(
    log: Iterable<Game>,
    visit?: (game: Game, step: RatingStep) => void,
): Map<string, RatedPlayer> {
    const table = new Map<string, RatedPlayer>();
    const ratedAt = new Map<string, number>();
    const standing = (player: PlayerRef): Standing => ({
        rating: table.get(playerKey(player))?.rating ?? seedRating(player.kind),
        ratedAt: ratedAt.get(playerKey(player)) ?? null,
    });
    for (const game of log) {
        const before = { x: standing(game.x), o: standing(game.o) };
        const after = rateGame(game, before);
        visit?.(game, { before: { x: before.x.rating, o: before.o.rating }, after });
        if (game.winner === null) continue;
        for (const side of [`x`, `o`] as const) {
            table.set(playerKey(game[side]), { player: game[side], rating: after[side] });
            ratedAt.set(playerKey(game[side]), game.finishedAt);
        }
    }
    return table;
}
