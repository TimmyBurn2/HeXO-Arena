import { randomInt } from 'node:crypto';

/**
 * A uniform draw from [0, 1). Every server-side lottery (colours, opening
 * stones, first player) runs through here, so nothing decides a game with
 * a predictable generator.
 */
export function randomFloat(): number {
    return randomInt(2 ** 32) / 2 ** 32;
}
