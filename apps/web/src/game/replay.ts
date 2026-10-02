import { useCallback, useEffect, useRef, useState } from 'react';
import { turnsOnBoard } from '@hexo-arena/contract';

/** The query parameter that opens a game at a turn. */
export const turnParam = `turn`;

/**
 * Where a replay stands, in stones on the board: the opening is one step,
 * so the fewest shown is the opening's own stones; a turn after it adds
 * two, and the last may add one.
 */
export interface ReplayRange {
    readonly opening: number;
    readonly total: number;
}

function clamp(shown: number, range: ReplayRange): number {
    return Math.min(range.total, Math.max(range.opening, shown));
}

/** The turn the last shown stone belongs to; the origin is turn 0. */
export function turnOf(shown: number): number {
    return turnsOnBoard(shown);
}

/** The stones on the board at the end of a turn, inside the range. */
export function shownAtTurn(turn: number, range: ReplayRange): number {
    return clamp(1 + 2 * turn, range);
}

/**
 * One turn back or on from where the board stands: a board halfway into a
 * turn steps to that turn's start or its end; the opening counts as one.
 */
export function stepTurn(shown: number, direction: -1 | 1, range: ReplayRange): number {
    if (direction === 1) return shown < range.opening ? range.opening : clamp(shown + (shown % 2 === 1 ? 2 : 1), range);
    if (shown <= range.opening) return range.opening;
    return clamp(shown - (shown % 2 === 1 ? 2 : 1), range);
}

/** One stone back or on, never into the opening, which shows whole. */
export function stepStone(shown: number, direction: -1 | 1, range: ReplayRange): number {
    return clamp(shown + direction, range);
}

/** The shown stones of the last turn on the board, which the last-move rings mark; the opening has none. */
export function lastTurnOf<T>(stones: readonly T[], shown: number, range: ReplayRange): T[] {
    if (shown <= range.opening) return [];
    const first = 2 * turnOf(shown) - 1;
    return stones.slice(first, shown);
}

function turnFromUrl(): number | null {
    const raw = new URLSearchParams(window.location.search).get(turnParam);
    if (raw === null || !/^\d{1,4}$/u.test(raw)) return null;
    return Number(raw);
}

function writeTurn(turn: number | null): void {
    const url = new URL(window.location.href);
    if (turn === null) url.searchParams.delete(turnParam);
    else url.searchParams.set(turnParam, String(turn));
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, ``, next);
}

/** A replay's position and the moves on it. */
export interface Replay {
    readonly range: ReplayRange;
    /** The stones shown. */
    readonly shown: number;
    /** Whether the board follows the latest stone: the end of a finished game, or live. */
    readonly following: boolean;
    /** Show this many stones; the latest count follows the game again. */
    readonly go: (shown: number) => void;
    /** Freeze the board where it stands, or follow the latest stone again. */
    readonly follow: (on: boolean) => void;
}

/**
 * The board's position in a replay: the latest stone unless the reader has
 * stepped back, held where they left it as later stones arrive.
 * A link's `?turn=` opens it at that turn, and each step writes the turn
 * back in place, so the address always opens the moment on screen.
 */
export function useReplay(range: ReplayRange, enabled: boolean): Replay {
    const [frozen, setFrozen] = useState<number | null>(() => {
        const turn = enabled ? turnFromUrl() : null;
        return turn === null ? null : shownAtTurn(turn, range);
    });
    const shown = frozen === null ? range.total : clamp(frozen, range);
    // Held at the latest stone is still held: the next stone does not show.
    const following = frozen === null;
    const wrote = useRef(false);

    useEffect(() => {
        if (!enabled) return;
        // Only a step writes; opening a game leaves its address as it came.
        if (!wrote.current) return;
        writeTurn(following ? null : turnOf(shown));
    }, [enabled, following, shown]);

    const go = useCallback(
        (next: number) => {
            wrote.current = true;
            setFrozen(next >= range.total ? null : clamp(next, range));
        },
        [range],
    );
    const follow = useCallback(
        (on: boolean) => {
            wrote.current = true;
            setFrozen(on ? null : shown);
        },
        [shown],
    );
    return { range, shown, following, go, follow };
}
