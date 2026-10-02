import type { Accepts } from '@hexo-arena/contract';

/** The accepted turn window as a pair, or null when turn clocks are out. */
export function turnWindowOf(accepts: Accepts | undefined): readonly [number, number] | null {
    const declared = accepts?.turnMs;
    if (declared === null || declared === undefined || declared.length !== 2) return null;
    const [min, max] = declared;
    if (min === undefined || max === undefined) return null;
    return [min, max];
}

/** Which clock modes the declaration covers. */
export function coveredModes(accepts: Accepts | undefined): Record<`turn` | `match` | `unlimited`, boolean> {
    return {
        turn: accepts?.turnMs != null,
        match: accepts?.match === true,
        unlimited: accepts?.unlimited === true,
    };
}
