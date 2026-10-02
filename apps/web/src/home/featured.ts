import { useEffect, useState } from 'react';
import type { FinishedGameEntry, GameSnapshot, LiveGameEntry } from '@hexo-arena/contract';
import { fetchGameSnapshot } from '../api/client';
import type { LiveView } from '../live/use-live-replay';

/** How long a featured game that just ended shows its result before the next one takes the slot. */
export const featuredResultMs = 5_000;

/**
 * What the featured slot shows: a live game, one that just ended, the
 * latest finished game, nothing, or nothing yet while its reads are out.
 */
export type Featured =
    | { kind: `live`; view: LiveView }
    | { kind: `ended`; snapshot: GameSnapshot }
    | { kind: `last`; snapshot: GameSnapshot }
    | { kind: `pending` }
    | { kind: `none` };

// A guest has no rating, so a game's average counts the seats that have one.
function averageRating(entry: LiveGameEntry): number {
    const ratings = [entry.players.x.rating, entry.players.o.rating].filter((rating) => rating !== null);
    return ratings.length === 0 ? 0 : ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

/**
 * The live game most worth watching: rated games first, then the highest
 * average rating; the list is newest first, so a tie goes to the newer game.
 */
export function pickFeatured(entries: readonly LiveGameEntry[]): LiveGameEntry | undefined {
    let best: LiveGameEntry | undefined;
    for (const entry of entries) {
        if (best === undefined) {
            best = entry;
            continue;
        }
        if (entry.rated !== best.rated) {
            if (entry.rated) best = entry;
            continue;
        }
        if (averageRating(entry) > averageRating(best)) best = entry;
    }
    return best;
}

type Hold =
    | { kind: `idle` }
    | { kind: `holding`; gameId: string }
    | { kind: `ending`; gameId: string }
    | { kind: `ended`; snapshot: GameSnapshot };

/**
 * The featured slot over the live list and the latest finished game.
 * The game it picks holds the slot until it leaves the list, however good
 * the games that start meanwhile; then its result shows for
 * {@link featuredResultMs} before the next pick.
 * With nothing live, the latest finished game shows frozen at its end;
 * `latest` is undefined until the finished games have been read.
 */
export function useFeatured(live: readonly LiveView[] | null, latest: FinishedGameEntry | null | undefined): Featured {
    const [hold, setHold] = useState<Hold>({ kind: `idle` });
    const [last, setLast] = useState<{ gameId: string; snapshot: GameSnapshot | null } | null>(null);
    // The held game as last seen, shown while its end is read.
    const [seen, setSeen] = useState<LiveView | null>(null);

    useEffect(() => {
        if (live === null) return;
        if (hold.kind === `idle`) {
            const best = pickFeatured(live.map((view) => view.entry));
            if (best !== undefined) setHold({ kind: `holding`, gameId: best.gameId });
            return;
        }
        if (hold.kind !== `holding`) return;
        const view = live.find((candidate) => candidate.entry.gameId === hold.gameId);
        if (view === undefined) setHold({ kind: `ending`, gameId: hold.gameId });
        // The same read and landing keep the state as it is, so this never renders again on its own.
        else setSeen((before) => (before?.entry === view.entry && before.cells === view.cells ? before : view));
    }, [live, hold]);

    const ending = hold.kind === `ending` ? hold.gameId : null;
    useEffect(() => {
        if (ending === null) return;
        let cancelled = false;
        // A game that left the list without a finished snapshot, such as a
        // guest game whose session ended, gives the slot up at once.
        fetchGameSnapshot(ending)
            .then((snapshot) => {
                if (!cancelled) setHold(snapshot.status === `finished` ? { kind: `ended`, snapshot } : { kind: `idle` });
            })
            .catch(() => {
                if (!cancelled) setHold({ kind: `idle` });
            });
        return () => {
            cancelled = true;
        };
    }, [ending]);

    const endedAt = hold.kind === `ended` ? hold.snapshot.gameId : null;
    useEffect(() => {
        if (endedAt === null) return;
        const timer = setTimeout(() => {
            setHold({ kind: `idle` });
        }, featuredResultMs);
        return () => {
            clearTimeout(timer);
        };
    }, [endedAt]);

    const quiet = live !== null && live.length === 0;
    const latestId = quiet ? (latest?.gameId ?? null) : null;
    useEffect(() => {
        if (latestId === null) return;
        let cancelled = false;
        // A read that fails leaves the slot to the band below.
        fetchGameSnapshot(latestId)
            .then((snapshot) => {
                if (!cancelled) setLast({ gameId: latestId, snapshot: snapshot.status === `finished` ? snapshot : null });
            })
            .catch(() => {
                if (!cancelled) setLast({ gameId: latestId, snapshot: null });
            });
        return () => {
            cancelled = true;
        };
    }, [latestId]);

    if (hold.kind === `holding` || hold.kind === `ending`) {
        const view = live?.find((candidate) => candidate.entry.gameId === hold.gameId) ?? (seen?.entry.gameId === hold.gameId ? seen : undefined);
        if (view !== undefined) return { kind: `live`, view };
    }
    if (hold.kind === `ended`) return { kind: `ended`, snapshot: hold.snapshot };
    if (live === null) return { kind: `pending` };
    // The pick lands in state after this render; it shows from this one.
    const best = hold.kind === `idle` ? pickFeatured(live.map((view) => view.entry)) : undefined;
    const picked = live.find((view) => view.entry.gameId === best?.gameId);
    if (picked !== undefined) return { kind: `live`, view: picked };
    if (!quiet) return { kind: `pending` };
    if (latest === undefined) return { kind: `pending` };
    if (latest === null) return { kind: `none` };
    if (last?.gameId !== latest.gameId) return { kind: `pending` };
    return last.snapshot === null ? { kind: `none` } : { kind: `last`, snapshot: last.snapshot };
}
