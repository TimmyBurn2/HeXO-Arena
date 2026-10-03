/** One unit the estimate counts: a pair's games over so far, or a single game, and the first bot's points in them. */
export interface EstimateUnit {
    readonly games: number;
    /** A win scores 1, a game without a winner 0.5. */
    readonly points: number;
}

/** What the games say about the first bot against the second, in rating points. */
export interface Estimate {
    readonly games: number;
    readonly points: { readonly first: number; readonly second: number };
    /** The first bot's lead in rating points; below zero it trails. */
    readonly rating: number;
    /** The 95% range's ends, null where the range runs past any finite difference. */
    readonly low: number | null;
    readonly high: number | null;
    /** The chance the first bot is the stronger, from 0 to 1. */
    readonly chance: number;
    readonly favored: `first` | `second` | null;
    readonly verdict: EstimateVerdict;
    /** How far the range would reach either way after another {@link estimateMoreGames} games, null where it would still run past any finite difference. */
    readonly narrowed: number | null;
}

/** stronger at a 99% chance or more, likely stronger from 95%, else too close to call. */
export type EstimateVerdict = `stronger` | `likely_stronger` | `too_close`;

/** The chance a verdict of stronger needs. */
export const strongerChance = 0.99;

/** The chance a verdict of likely stronger needs. */
export const likelyStrongerChance = 0.95;

/** The games a second test of the same terms plays, and the estimate's look ahead. */
export const estimateMoreGames = 50;

// The two-sided 95% quantile of the normal distribution.
const z95 = 1.959963984540054;

// The Agresti-Coull adjustment at the pair level: one pair won and one
// lost join the games, so a sweep or a short run still gets a finite
// estimate and a range that says how little it knows.
const prior: readonly EstimateUnit[] = [
    { games: 2, points: 2 },
    { games: 2, points: 0 },
];

// Abramowitz and Stegun 7.1.26, good to 1.5e-7, which a percent never shows.
function erf(x: number): number {
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return x < 0 ? -y : y;
}

function normalCdf(x: number): number {
    return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** A score share as rating points on the logistic scale ratings use. */
export function ratingOfScore(score: number): number {
    return 400 * Math.log10(score / (1 - score));
}

const inside = (score: number) => score > 0 && score < 1;

function verdictOf(chance: number): EstimateVerdict {
    const sure = Math.max(chance, 1 - chance);
    return sure >= strongerChance ? `stronger` : sure >= likelyStrongerChance ? `likely_stronger` : `too_close`;
}

/**
 * The estimate of how much stronger the first bot is, counted by pairs,
 * since a pair's two games share an opening: the score with games without
 * a winner as halves, its 95% range from how the units spread, each end
 * turned into rating points, and the chance the first is the stronger.
 * Answers null before any game is over.
 */
export function estimateOf(units: readonly EstimateUnit[]): Estimate | null {
    const counted = units.filter((unit) => unit.games > 0);
    const games = counted.reduce((sum, unit) => sum + unit.games, 0);
    if (games === 0) return null;
    const points = counted.reduce((sum, unit) => sum + unit.points, 0);
    const all = [...counted, ...prior];
    const total = all.reduce((sum, unit) => sum + unit.games, 0);
    const score = all.reduce((sum, unit) => sum + unit.points, 0) / total;
    // A ratio estimator's variance, so a lone game beside whole pairs weighs as one game.
    const spread = all.reduce((sum, unit) => sum + (unit.points - unit.games * score) ** 2, 0);
    const error = Math.sqrt((all.length / (all.length - 1)) * (spread / total ** 2));
    const chance = normalCdf((score - 0.5) / error);
    const end = (share: number) => (inside(share) ? Math.round(ratingOfScore(share)) : null);
    const ahead = error * Math.sqrt(all.length / (all.length + estimateMoreGames / 2));
    const narrowedLow = score - z95 * ahead;
    const narrowedHigh = score + z95 * ahead;
    return {
        games,
        points: { first: points, second: games - points },
        rating: Math.round(ratingOfScore(score)),
        low: end(score - z95 * error),
        high: end(score + z95 * error),
        chance: Math.round(chance * 1000) / 1000,
        // Halves sum exactly, so an even score is exactly one half.
        favored: score > 0.5 ? `first` : score < 0.5 ? `second` : null,
        verdict: verdictOf(chance),
        narrowed: inside(narrowedLow) && inside(narrowedHigh) ? Math.round((ratingOfScore(narrowedHigh) - ratingOfScore(narrowedLow)) / 2) : null,
    };
}
