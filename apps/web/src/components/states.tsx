import { useEffect } from 'react';
import { text } from '../text';
import { useWait, WaitText } from './wait';

/** Static placeholder rows while the first load runs; nothing animates on load. */
export function SkeletonRows() {
    return (
        <div className="table-wrap" aria-hidden="true">
            <div className="skeleton-stack">
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
                <div className="skeleton" />
            </div>
        </div>
    );
}

/**
 * The error frame every failed load shares, with its retry;
 * a load refused with a wait holds the retry until the wait is over.
 */
export function ErrorFrame({ sentence, onRetry, wait = null }: { sentence: string; onRetry: () => void; wait?: number | null }) {
    const limited = useWait();
    const { start } = limited;
    useEffect(() => {
        if (wait !== null) start(wait);
    }, [wait, start]);
    const holding = limited.wait !== null;
    return (
        <div className="empty">
            <h2>{sentence}</h2>
            <div role="status">{limited.wait === null ? null : <p className="note"><WaitText wait={limited.wait} line={text.states.tooMany} /></p>}</div>
            <div className="actions">
                <button
                    type="button"
                    className="btn btn-ghost"
                    aria-disabled={holding ? `true` : undefined}
                    onClick={() => {
                        if (!holding) onRetry();
                    }}
                >
                    {text.states.tryAgain}
                </button>
            </div>
        </div>
    );
}
