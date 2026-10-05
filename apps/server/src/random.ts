import { randomInt } from 'node:crypto';

/**
 * A uniform draw from [0, 1).
 * Every server-side lottery (colours, first player) runs through here,
 * so nothing decides a game with a predictable generator.
 */
export function randomFloat(): number {
    return randomInt(2 ** 32) / 2 ** 32;
}

/**
 * A uniform integer in [0, bound).
 * Scaling a float to the bound favours some indices whenever the bound does
 * not divide the float's range; crypto's rejection sampling does not.
 */
export function randomIndex(bound: number): number {
    return randomInt(bound);
}

// Lowercase letters and digits without the look-alikes, as an address carries them.
const idAlphabet = `abcdefghijkmnopqrstuvwxyz0123456789`;

/** A short random id behind its prefix, such as a tournament's `t_`: twelve characters. */
export function shortId(prefix: string): string {
    return `${prefix}${Array.from({ length: 12 }, () => idAlphabet[randomIndex(idAlphabet.length)] ?? `a`).join(``)}`;
}
