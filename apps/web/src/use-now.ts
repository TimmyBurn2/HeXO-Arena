import { useEffect, useState } from 'react';

/**
 * The time now, in epoch milliseconds, stepping every `ms` while `on`, so a
 * countdown ticks between reads; off, it holds where it last stood.
 */
export function useNow(on: boolean, ms = 1000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = setInterval(() => {
            setNow(Date.now());
        }, ms);
        return () => {
            clearInterval(timer);
        };
    }, [on, ms]);
    return now;
}
