import { useLayoutEffect, useSyncExternalStore } from 'react';
import type { Route } from './router/route';

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

// Whether a mounted screen has asked for the frame.
function useFrameLent(): boolean {
    return useSyncExternalStore(subscribe, lent, lent);
}

/** Where a screen sits: inside the site's frame, or alone on the stage. */
export type Layout = `framed` | `immersive`;

// The game is immersive: the board is the screen, with no site chrome; a
// paused banner would not apply, since live games continue.
function layoutOf(route: Route): Layout {
    return route.name === `game` ? `immersive` : `framed`;
}

/**
 * Whether a framed screen spans the window under the bar, edge to edge,
 * instead of the shell's centered column: the analysis board's workspace
 * fills the window as the game stage does.
 */
export function spansWindow(route: Route): boolean {
    return route.name === `analysis`;
}

/** Whether the screen at this route sits in the site's frame, its own or lent. */
export function useFramed(route: Route): boolean {
    const lentNow = useFrameLent();
    return layoutOf(route) === `framed` || lentNow;
}
