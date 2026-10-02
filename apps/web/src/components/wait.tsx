import { useCallback, useEffect, useMemo, useState } from 'react';
import { text } from '../text';

/** A wait the server named: the seconds it began with and the seconds left, whole and at least 1. */
export interface Wait {
    readonly seconds: number;
    readonly left: number;
}

/**
 * A wait that counts down once a second and then ends:
 * `wait` is null while none runs.
 */
export function useWait(): { wait: Wait | null; start: (seconds: number) => void; clear: () => void } {
    const [running, setRunning] = useState<{ until: number; seconds: number } | null>(null);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (running === null) return;
        const timer = setInterval(() => {
            const at = Date.now();
            setNow(at);
            if (at >= running.until) setRunning(null);
        }, 1000);
        return () => {
            clearInterval(timer);
        };
    }, [running]);

    const start = useCallback((seconds: number) => {
        const at = Date.now();
        setNow(at);
        setRunning({ until: at + seconds * 1000, seconds });
    }, []);
    const clear = useCallback(() => {
        setRunning(null);
    }, []);

    // One object per tick, so a wait handed on as a prop changes only when its count does.
    const wait = useMemo(
        () => (running === null ? null : { seconds: running.seconds, left: Math.max(1, Math.ceil((running.until - now) / 1000)) }),
        [running, now],
    );
    return { wait, start, clear };
}

/** Why an action did not go through: the wait a limit named, counting down, or the failure's own line. */
export function ActionFailure({ failure, wait }: { failure: string | null; wait: Wait | null }) {
    if (wait !== null) {
        return (
            <p className="field-error" role="alert">
                <WaitText wait={wait} line={text.states.tooMany} />
            </p>
        );
    }
    return failure === null ? null : (
        <p className="field-error" role="alert">
            {failure}
        </p>
    );
}

/**
 * A line about a wait: the count ticks on screen,
 * while a live region beside it says the wait once,
 * as it stands when the line appears.
 */
export function WaitText({ wait, line }: { wait: Wait; line: (seconds: number) => string }) {
    // A line that comes back mid-wait says the time left;
    // every held control keeps the line mounted for its whole wait, so a new wait brings a new line.
    const [said] = useState(wait.left);
    return (
        <>
            <span aria-hidden="true">{line(wait.left)}</span>
            <span className="sr-only">{line(said)}</span>
        </>
    );
}
