import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameCell, LiveGameEntry, Side } from '@hexo-arena/contract';
import { playerToMove } from '@hexo-arena/rules';
import { fetchLiveGames, limitedFor } from '../api/client';

/** How often a page with live boards reads the list again while it is in view. */
export const liveReplayMs = 5_000;

/** A live game as a page shows it: its latest read and the stones landed so far. */
export interface LiveView {
    entry: LiveGameEntry;
    cells: readonly GameCell[];
    toMove: Side;
    /** When the entry was read, in epoch milliseconds, which its clock counts from. */
    readAt: number;
}

/** The live list with each game's stones landing between reads. */
export interface LiveReplay {
    games: LiveView[] | null;
    // Whether the latest read failed; the games of the one before stay.
    failed: boolean;
    // The seconds a rate-limited read asks to wait before the retry.
    limited: number | null;
    reload: () => void;
}

// One read's new stones: how many showed when it came, how many it holds,
// when it came, and the wait between landings.
interface Landing {
    from: number;
    to: number;
    at: number;
    step: number;
}

function shownBy(landing: Landing, now: number): number {
    if (landing.step === 0) return landing.to;
    return Math.min(landing.to, landing.from + Math.max(0, Math.floor((now - landing.at) / landing.step)));
}

function reducedMotion(): boolean {
    return typeof window.matchMedia === `function` && window.matchMedia(`(prefers-reduced-motion: reduce)`).matches;
}

function samePrefix(held: readonly GameCell[], next: readonly GameCell[], count: number): boolean {
    for (let index = 0; index < count; index += 1) {
        const a = held[index];
        const b = next[index];
        if (a === undefined || b === undefined || a.x !== b.x || a.y !== b.y || a.side !== b.side) return false;
    }
    return true;
}

function sideAfter(cells: readonly GameCell[]): Side {
    return playerToMove({ stones: cells.map((cell) => ({ x: cell.x, y: cell.y, player: cell.side === `x` ? 0 : 1 })) }) === 0 ? `x` : `o`;
}

/**
 * The live list for pages that draw its boards: no stream, a read every
 * {@link liveReplayMs} while the page is in view, and each read's new stones
 * landing one at a time across the wait, or at once for a reader who asks
 * for reduced motion.
 * A game seen for the first time shows whole.
 */
export function useLiveReplay(): LiveReplay {
    const [entries, setEntries] = useState<LiveGameEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [limited, setLimited] = useState<number | null>(null);
    const [now, setNow] = useState(() => Date.now());
    const [readAt, setReadAt] = useState(() => Date.now());
    const landings = useRef(new Map<string, Landing>());
    const held = useRef(new Map<string, LiveGameEntry>());

    const read = useCallback(async () => {
        let list: LiveGameEntry[];
        try {
            list = await fetchLiveGames();
        } catch (cause) {
            setFailed(true);
            setLimited(limitedFor(cause));
            return;
        }
        const at = Date.now();
        const instant = reducedMotion();
        const next = new Map<string, Landing>();
        for (const entry of list) {
            const to = entry.cells.length;
            const before = held.current.get(entry.gameId);
            const landing = landings.current.get(entry.gameId);
            const shown = before === undefined || landing === undefined ? to : Math.min(to, shownBy(landing, at));
            const from = instant || !samePrefix(before?.cells ?? [], entry.cells, shown) ? to : shown;
            next.set(entry.gameId, { from, to, at, step: from === to ? 0 : Math.floor(liveReplayMs / (to - from + 1)) });
        }
        landings.current = next;
        held.current = new Map(list.map((entry) => [entry.gameId, entry]));
        setEntries(list);
        setFailed(false);
        setReadAt(at);
        setNow(at);
    }, []);

    useEffect(() => {
        void read();
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void read();
        }, liveReplayMs);
        function onVisible() {
            if (document.visibilityState === `visible`) void read();
        }
        document.addEventListener(`visibilitychange`, onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener(`visibilitychange`, onVisible);
        };
    }, [read]);

    // One wake per landing, the soonest first, so the page renders only when a stone lands.
    useEffect(() => {
        let soonest = Infinity;
        for (const landing of landings.current.values()) {
            const shown = shownBy(landing, now);
            if (shown < landing.to) soonest = Math.min(soonest, landing.at + (shown - landing.from + 1) * landing.step);
        }
        if (soonest === Infinity) return;
        const timer = setTimeout(
            () => {
                setNow(Date.now());
            },
            Math.max(0, Math.ceil(soonest - Date.now())),
        );
        return () => {
            clearTimeout(timer);
        };
    }, [now, entries]);

    const games =
        entries === null
            ? null
            : entries.map((entry) => {
                  const landing = landings.current.get(entry.gameId);
                  const count = landing === undefined ? entry.cells.length : shownBy(landing, now);
                  const cells = count === entry.cells.length ? entry.cells : entry.cells.slice(0, count);
                  return { entry, cells, toMove: count === entry.cells.length ? entry.toMove : sideAfter(cells), readAt };
              });

    return { games, failed, limited, reload: () => void read() };
}
