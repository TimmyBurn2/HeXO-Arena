import { useMemo } from 'react';
import { fetchAnalyzers } from '../api/client';
import { useAsync } from '../api/use-async';
import type { AnalyzerList } from './ReadingPanel';

/**
 * The bots that declare an analyzer, read for a signed-in person only;
 * `reload` reads them again, keeping the list on screen while it does.
 */
export function useAnalyzers(signedIn: boolean): { analyzers: AnalyzerList; reload: () => void } {
    const { data, error, reload } = useAsync(fetchAnalyzers, { enabled: signedIn });
    const analyzers = useMemo<AnalyzerList>(
        () => (data !== null ? { kind: `ready`, bots: data } : error ? { kind: `failed`, retry: reload } : { kind: `loading` }),
        [data, error, reload],
    );
    return { analyzers, reload };
}
