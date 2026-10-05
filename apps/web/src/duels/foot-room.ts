import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keeps a sheet's room for its sticky foot as tall as the foot, in the
 * sheet's `--foot-room`, so a row that focus scrolls to stops above the
 * foot rather than under it.
 */
export function useFootRoom(sheet: RefObject<HTMLElement | null>, foot: RefObject<HTMLElement | null>): void {
    // The foot may come and go with what is picked, so each render looks for it again.
    useLayoutEffect(() => {
        const body = sheet.current;
        const held = foot.current;
        if (body === null) return;
        if (held === null) {
            body.style.removeProperty(`--foot-room`);
            return;
        }
        const fit = () => {
            body.style.setProperty(`--foot-room`, `${String(held.offsetHeight)}px`);
        };
        fit();
        if (typeof ResizeObserver === `undefined`) return;
        const watcher = new ResizeObserver(fit);
        watcher.observe(held);
        return () => {
            watcher.disconnect();
        };
    });
}
