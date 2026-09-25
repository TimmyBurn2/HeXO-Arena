import { useEffect, useState } from 'react';
import './Clock.css';

/**
 * A clock that ticks down from the snapshot's reading; the interval is
 * scoped here, so the board and feed never re-render on a tick.
 */
export function Clock({ remainingMs, running }: { remainingMs: number; running: boolean }) {
    const [elapsed, setElapsed] = useState(0);

    useEffect(() => {
        setElapsed(0);
        if (!running) return;
        const startedAt = performance.now();
        const timer = setInterval(() => {
            setElapsed(performance.now() - startedAt);
        }, 100);
        return () => {
            clearInterval(timer);
        };
    }, [remainingMs, running]);

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
