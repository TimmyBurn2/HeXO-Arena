/** The factor between the Glicko scale, where ratings are stored and shown, and Glicko-2's own. */
export const glickoScale = 173.7178;

/** A rating and its deviation on the Glicko scale. */
export interface RatingStanding {
    readonly rating: number;
    readonly deviation: number;
}

/** Glicko-2's g: how much a deviation of `phi`, on Glicko-2's scale, damps a result. */
export function glickoG(phi: number): number {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

/**
 * A player's expected score against an opponent, Glicko-2's E: the
 * share of a point the rating fold expects them to take.
 * Only the opponent's deviation counts, so the two sides of a pair need
 * not sum to one.
 * The server's fold weighs every result through this function; it first
 * widens a deviation by the time since the player's last rated game,
 * which a page reading the stored deviation leaves out.
 */
export function expectedScore(player: RatingStanding, opponent: RatingStanding): number {
    const mu = (player.rating - 1500) / glickoScale;
    const muJ = (opponent.rating - 1500) / glickoScale;
    return 1 / (1 + Math.exp(-glickoG(opponent.deviation / glickoScale) * (mu - muJ)));
}
