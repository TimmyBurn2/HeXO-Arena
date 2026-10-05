import { useLayoutEffect } from 'react';
import type { Route } from './router/route';
import { createStore, useStore } from './store';

// How many mounted screens have asked for the frame.
const borrowers = createStore(0);

/**
 * Put the site's frame around a screen that otherwise owns the viewport,
 * for as long as the caller is mounted: a game that does not exist has no
 * board to show, so it reads as any other missing page.
 * The frame lands before the browser paints, so the screen never shows
 * without it.
 */
export function useBorrowFrame(): void {
    useLayoutEffect(() => {
        borrowers.set(borrowers.read() + 1);
        return () => {
            borrowers.set(borrowers.read() - 1);
        };
    }, []);
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
    const lent = useStore(borrowers) > 0;
    return layoutOf(route) === `framed` || lent;
}
