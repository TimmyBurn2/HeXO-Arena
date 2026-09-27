import { useLayoutEffect, useSyncExternalStore } from 'react';

let borrowers = 0;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function lent(): boolean {
    return borrowers > 0;
}

/**
 * Put the site's frame around a screen that otherwise owns the viewport,
 * for as long as the caller is mounted: a game that does not exist has no
 * board to show, so it reads as any other missing page.
 * The frame lands before the browser paints, so the screen never shows
 * without it.
 */
export function useBorrowFrame(): void {
    useLayoutEffect(() => {
        borrowers += 1;
        notify();
        return () => {
            borrowers -= 1;
            notify();
        };
    }, []);
}

/** Whether a mounted screen has asked for the frame. */
export function useFrameLent(): boolean {
    return useSyncExternalStore(subscribe, lent, lent);
}
