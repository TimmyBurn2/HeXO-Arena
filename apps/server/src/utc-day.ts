/** Seconds in a day. */
export const daySeconds = 86_400;

/**
 * The UTC day an epoch second falls in: its first second, and the seconds
 * left until the next begins, which the daily caps answer as their wait.
 */
export function utcDay(seconds: number): { readonly start: number; readonly secondsLeft: number } {
    // Unix epoch days are UTC days, so the floor is the whole day boundary.
    const start = Math.floor(seconds / daySeconds) * daySeconds;
    return { start, secondsLeft: start + daySeconds - seconds };
}
