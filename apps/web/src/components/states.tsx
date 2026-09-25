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

/** The error frame every failed load shares, with its retry. */
export function ErrorFrame({ sentence, onRetry }: { sentence: string; onRetry: () => void }) {
    return (
        <div className="empty">
            <h2>{sentence}</h2>
            <div className="actions">
                <button type="button" className="btn btn-ghost" onClick={onRetry}>
                    Try again
                </button>
            </div>
        </div>
    );
}
