import { useEffect, useRef } from 'react';

function inView(): boolean {
    return document.visibilityState === `visible`;
}

/**
 * Runs `read` on the beat while the page is in view, and whenever it comes
 * back into view; the caller reads first, and a null beat reads nothing.
 */
export function useBeat(read: () => void, ms: number | null): void {
    const latest = useRef(read);
    useEffect(() => {
        latest.current = read;
    });
    useEffect(() => {
        if (ms === null) return;
        const timer = setInterval(() => {
            if (inView()) latest.current();
        }, ms);
        function onVisible() {
            if (inView()) latest.current();
        }
        document.addEventListener(`visibilitychange`, onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener(`visibilitychange`, onVisible);
        };
    }, [ms]);
}
