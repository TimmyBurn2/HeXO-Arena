import { useCallback, useEffect, useRef, useState } from 'react';
import { limitedFor } from './client';

export interface AsyncView<T> {
    data: T | null;
    loading: boolean;
    error: boolean;
    // The seconds a rate-limited failure asks to wait before the retry.
    limited: number | null;
    reload: () => void;
}

/**
 * Load on mount and on every change of the load function's identity. A
 * failed refresh keeps the last data on screen; only a first failure shows
 * the error frame with its retry.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncView<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [limited, setLimited] = useState<number | null>(null);
    const [attempt, setAttempt] = useState(0);
    const hadData = useRef(false);

    useEffect(() => {
        let cancelled = false;
        if (!hadData.current) setLoading(true);
        setError(false);
        load()
            .then((value) => {
                if (cancelled) return;
                hadData.current = true;
                setData(value);
                setLoading(false);
            })
            .catch((cause: unknown) => {
                if (cancelled) return;
                setError(true);
                setLimited(limitedFor(cause));
                setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [load, attempt]);

    const reload = useCallback(() => {
        setAttempt((current) => current + 1);
    }, []);

    return { data, error, limited, loading, reload };
}
