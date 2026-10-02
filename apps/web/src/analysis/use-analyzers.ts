import { useCallback, useEffect, useState } from 'react';
import { fetchAnalyzers } from '../api/client';
import type { AnalyzerList } from './ReadingPanel';

/**
 * The bots that declare an analyzer, read for a signed-in person only;
 * `reload` reads them again, keeping the list on screen while it does.
 */
export function useAnalyzers(signedIn: boolean): { analyzers: AnalyzerList; reload: () => void } {
    const [analyzers, setAnalyzers] = useState<AnalyzerList>({ kind: `loading` });
    const [attempt, setAttempt] = useState(0);
    const reload = useCallback(() => {
        setAttempt((count) => count + 1);
    }, []);

    useEffect(() => {
        if (!signedIn) {
            setAnalyzers({ kind: `loading` });
            return;
        }
        let cancelled = false;
        fetchAnalyzers().then(
            (bots) => {
                if (!cancelled) setAnalyzers({ kind: `ready`, bots });
            },
            () => {
                if (!cancelled) setAnalyzers((current) => (current.kind === `ready` ? current : { kind: `failed`, retry: reload }));
            },
        );
        return () => {
            cancelled = true;
        };
    }, [signedIn, attempt, reload]);

    return { analyzers, reload };
}
