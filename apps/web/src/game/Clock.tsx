import { useEffect, useState } from 'react';
import './Clock.css';

/**
 * A clock that ticks down from the snapshot's reading; the interval is
 * scoped here, so the board and feed never re-render on a tick.
 * `since`, in epoch milliseconds, is when the reading was taken,
 * for a clock that appears after its reading;
 * absent, the reading is fresh.
 */
export function Clock({ remainingMs, running, since }: { remainingMs: number; running: boolean; since?: number }) {
    const [elapsed, setElapsed] = useState(() => (running && since !== undefined ? Math.max(0, Date.now() - since) : 0));

    useEffect(() => {
        const aged = since === undefined ? 0 : Math.max(0, Date.now() - since);
        setElapsed(running ? aged : 0);
        if (!running) return;
        const startedAt = performance.now() - aged;
        const timer = setInterval(() => {
            setElapsed(performance.now() - startedAt);
        }, 100);
        return () => {
            clearInterval(timer);
        };
    }, [remainingMs, running, since]);

    const ms = Math.max(0, remainingMs - elapsed);
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const text = `${pad(minutes)}:${pad(seconds % 60)}`;
    // The running clock is a plate; under ten seconds the plate turns to
    // the alarm color once and stays there.
    const state = !running ? `idle` : ms < 10_000 ? `low` : `active`;

    return (
        <span className={`clock ${state}`} role="timer" aria-live="off">
            {text}
        </span>
    );
}

function pad(value: number): string {
    return String(value).padStart(2, `0`);
}
