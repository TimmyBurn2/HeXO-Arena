import { useEffect } from 'react';
import type { LiveGameEntry } from '@hexarena/contract';
import { fetchLiveGames } from './client';
import { useAsync, type AsyncView } from './use-async';

// The list has no stream of its own, so the screens that show it reread
// it on this beat.
export const liveRefreshMs = 15_000;

/** The live games list, reread on a fixed beat while a screen shows it. */
export function useLiveGames(): AsyncView<LiveGameEntry[]> {
    const view = useAsync(fetchLiveGames);
    const reload = view.reload;
    useEffect(() => {
        const timer = setInterval(reload, liveRefreshMs);
        return () => {
            clearInterval(timer);
        };
    }, [reload]);
    return view;
}
