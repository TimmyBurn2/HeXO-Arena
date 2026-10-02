import { expectedScore, glickoG, glickoScale } from '@hexo-arena/contract';

/**
 * A player on the Glicko scale, where ratings are stored and shown.
 */
export interface Glicko2Rating {
    readonly rating: number;
    readonly deviation: number;
    readonly volatility: number;
}

/**
 * One game of a rating period from the rated player's side: score 1 for a
 * win, 0.5 for a draw, 0 for a loss.
 * The opponent's volatility plays no part in the update.
 */
export interface Glicko2Result {
    readonly opponent: Pick<Glicko2Rating, `rating` | `deviation`>;
    readonly score: number;
}

const convergenceTolerance = 0.000001;

// The Illinois iteration of the paper's revised step 5: Newton's method
// can fail to converge from a poor starting value; this bracket cannot.
function nextVolatility(phi: number, sigma: number, v: number, delta: number, tau: number): number {
    const a = Math.log(sigma * sigma);
    const f = (x: number): number => {
        const ex = Math.exp(x);
        const denominator = phi * phi + v + ex;
        return (ex * (delta * delta - phi * phi - v - ex)) / (2 * denominator * denominator) - (x - a) / (tau * tau);
    };
    let boundA = a;
    let boundB: number;
    if (delta * delta > phi * phi + v) {
        boundB = Math.log(delta * delta - phi * phi - v);
    } else {
        let k = 1;
        while (f(a - k * tau) < 0) k += 1;
        boundB = a - k * tau;
    }
    let fA = f(boundA);
    let fB = f(boundB);
    while (Math.abs(boundB - boundA) > convergenceTolerance) {
        const boundC = boundA + ((boundA - boundB) * fA) / (fB - fA);
        const fC = f(boundC);
        if (fC * fB <= 0) {
            boundA = boundB;
            fA = fB;
        } else {
            fA = fA / 2;
        }
        boundB = boundC;
        fB = fC;
    }
    return Math.exp(boundA / 2);
}

/**
 * Updates one player over a rating period, following Mark Glickman,
 * "Example of the Glicko-2 system" (glicko.net), steps 2 through 8.
 * Variable names follow the paper.
 * `tau` constrains how far volatility moves in one period.
 * `periods` is how many periods step 6 widens the deviation by: one in
 * the paper; zero for a game whose player brings a deviation already
 * widened by the time since their previous game.
 */
export function glicko2Update(
    player: Glicko2Rating,
    results: readonly Glicko2Result[],
    tau: number,
    periods = 1,
): Glicko2Rating {
    const mu = (player.rating - 1500) / glickoScale;
    const phi = player.deviation / glickoScale;
    const sigma = player.volatility;
    if (results.length === 0) {
        return {
            rating: player.rating,
            deviation: Math.sqrt(phi * phi + periods * sigma * sigma) * glickoScale,
            volatility: sigma,
        };
    }
    let information = 0;
    let improvement = 0;
    for (const result of results) {
        const gJ = glickoG(result.opponent.deviation / glickoScale);
        const expected = expectedScore(player, result.opponent);
        information += gJ * gJ * expected * (1 - expected);
        improvement += gJ * (result.score - expected);
    }
    const v = 1 / information;
    const sigmaPrime = nextVolatility(phi, sigma, v, v * improvement, tau);
    const phiStar = Math.sqrt(phi * phi + periods * sigmaPrime * sigmaPrime);
    const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muPrime = mu + phiPrime * phiPrime * improvement;
    return {
        rating: muPrime * glickoScale + 1500,
        deviation: phiPrime * glickoScale,
        volatility: sigmaPrime,
    };
}
