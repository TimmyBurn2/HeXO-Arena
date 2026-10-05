import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, limitedFor } from './client';
import { useBeat } from './use-beat';

/** A read as a screen shows it. */
export interface AsyncView<T> {
    /** The latest data read, kept through a failed or a pending read; null before the first. */
    readonly data: T | null;
    /** A read is under way, whatever shows meanwhile. */
    readonly pending: boolean;
    /** A read is under way, with no data and no failure to show meanwhile. */
    readonly loading: boolean;
    /** The latest read failed. */
    readonly error: boolean;
    /** The latest read answered that what it asks for does not exist. */
    readonly missing: boolean;
    /** The seconds a rate-limited failure asks to wait before the retry. */
    readonly limited: number | null;
    /** Read again now; a failure on screen gives way to the loading state. */
    readonly reload: () => void;
    /** Show data an action answered with in place of the last read, made from the data shown. */
    readonly replace: (update: (data: T | null) => T) => void;
}

/** How a read runs. */
export interface AsyncOptions<T> {
    /** Whether to read at all; while false the view holds nothing. True unless given. */
    readonly enabled?: boolean;
    /**
     * Whether a new load function shows the data of the one before until it
     * answers; false shows nothing meanwhile, for data that names what it
     * answers. True unless given.
     */
    readonly keep?: boolean;
    /**
     * The beat to read again on while the page is in view, and at once when
     * it comes back into view, from the data shown; none unless given, and
     * none once a read answers that what it asks for does not exist.
     * A read still out when the beat comes lands rather than giving way.
     */
    readonly every?: number | ((data: T) => number | null) | null;
}

interface Failure {
    readonly missing: boolean;
    readonly limited: number | null;
}

// A read asked for: its count, and whether a failure on screen stays while it runs.
interface Run {
    readonly count: number;
    readonly quiet: boolean;
}

/**
 * Load on mount and on every change of the load function's identity, and
 * again on `reload` or the beat. A failed read keeps the last data on
 * screen; only a failure with nothing to show calls for the error frame
 * with its retry.
 */
export function useAsync<T>(load: () => Promise<T>, options: AsyncOptions<T> = {}): AsyncView<T> {
    const { enabled = true, keep = true, every = null } = options;
    const [run, setRun] = useState<Run>({ count: 0, quiet: false });
    const [held, setHeld] = useState<{ load: () => Promise<T>; data: T } | null>(null);
    const [settled, setSettled] = useState<{ load: () => Promise<T>; count: number; failure: Failure | null } | null>(null);
    // Whether a read is out, which a beat lets land rather than cut short, however slow.
    const out = useRef(false);

    const count = run.count;
    useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        out.current = true;
        load().then(
            (data) => {
                if (cancelled) return;
                out.current = false;
                setHeld({ load, data });
                setSettled({ load, count, failure: null });
            },
            (cause: unknown) => {
                if (cancelled) return;
                out.current = false;
                setSettled({ load, count, failure: { missing: cause instanceof ApiError && cause.status === 404, limited: limitedFor(cause) } });
            },
        );
        return () => {
            cancelled = true;
            out.current = false;
        };
    }, [load, enabled, count]);

    const reload = useCallback(() => {
        setRun((current) => ({ count: current.count + 1, quiet: false }));
    }, []);
    const refresh = useCallback(() => {
        if (out.current) return;
        setRun((current) => ({ count: current.count + 1, quiet: true }));
    }, []);
    const replace = useCallback(
        (update: (data: T | null) => T) => {
            setHeld((current) => ({ load, data: update(current !== null && (keep || current.load === load) ? current.data : null) }));
        },
        [load, keep],
    );

    const shown = enabled && held !== null && (keep || held.load === load) ? held : null;
    const pending = enabled && (settled?.load !== load || settled.count !== count);
    const failure = enabled && settled?.load === load && (!pending || run.quiet) ? settled.failure : null;
    const data = shown?.data ?? null;
    const missing = failure?.missing ?? false;
    const beat = typeof every === `function` ? (data === null ? null : every(data)) : every;
    useBeat(refresh, enabled && !missing ? beat : null);

    return {
        data,
        pending,
        loading: pending && shown === null && failure === null,
        error: failure !== null,
        missing,
        limited: failure?.limited ?? null,
        reload,
        replace,
    };
}
