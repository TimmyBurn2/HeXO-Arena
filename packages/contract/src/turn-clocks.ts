import type { Side, TimeControl } from './stream';

/** A turn a player chose, as the site keeps it: who played it and the epoch second it landed. */
export interface TimedTurn {
    readonly side: Side;
    readonly at: number;
}

/**
 * Each chosen turn's mover clock in ms after it, in order, from the epoch second the game started and each turn's second;
 * null for an unlimited clock, which has none.
 * The clock runs from the start, so the first turn's time counts from it.
 * A match clock takes each turn's time from its mover's budget, held at 0, then adds the increment, as a live game does;
 * a turn clock is what the turn left of its own time.
 * The site keeps these times to the second, so the clocks are only as exact.
 */
export function turnClocks(timeControl: TimeControl, startedAt: number, turns: readonly TimedTurn[]): number[] | null {
    if (timeControl.mode === `unlimited`) return null;
    const remaining: Record<Side, number> = timeControl.mode === `match` ? { x: timeControl.mainTimeMs, o: timeControl.mainTimeMs } : { x: 0, o: 0 };
    let before = startedAt;
    return turns.map((turn) => {
        // A clock never runs backwards, whatever the stored seconds say.
        const elapsedMs = Math.max(0, turn.at - before) * 1_000;
        before = turn.at;
        if (timeControl.mode === `turn`) return Math.max(0, timeControl.turnTimeMs - elapsedMs);
        remaining[turn.side] = Math.max(0, remaining[turn.side] - elapsedMs) + timeControl.incrementMs;
        return remaining[turn.side];
    });
}
