import { Component, type ReactNode } from 'react';
import type { Layout } from './frame';
import { Link } from './router/Link';
import { text } from './text';

/** A screen's code that did not arrive, as against a screen that broke while drawing. */
export class ScreenDownloadError extends Error {}

/** Load a screen's module, marking a failed download as such for the boundary. */
export async function loadScreen<T>(load: () => Promise<T>): Promise<T> {
    try {
        return await load();
    } catch (cause) {
        throw new ScreenDownloadError(`a screen's code did not download`, { cause });
    }
}

type Failed = `download` | `crash`;

interface RouteBoundaryProps {
    layout: Layout;
    // A new route clears the failure, so leaving it renders the next screen.
    resetKey: string;
    children: ReactNode;
}

/**
 * The stand-in for a screen that failed, most often because its code did
 * not download: it says so where the screen would be and offers a reload.
 * React keeps a lazy screen's failed load, so only a reload fetches it again.
 */
export class RouteBoundary extends Component<RouteBoundaryProps, { failed: Failed | null }> {
    override state: { failed: Failed | null } = { failed: null };

    static getDerivedStateFromError(error: unknown): { failed: Failed } {
        return { failed: error instanceof ScreenDownloadError ? `download` : `crash` };
    }

    override componentDidUpdate(previous: RouteBoundaryProps): void {
        if (this.state.failed !== null && previous.resetKey !== this.props.resetKey) this.setState({ failed: null });
    }

    override render(): ReactNode {
        const { failed } = this.state;
        if (failed === null) return this.props.children;
        return this.props.layout === `framed` ? (
            <RouteFailure layout="framed" failed={failed} />
        ) : (
            <div className="stage-message">
                <RouteFailure layout="immersive" failed={failed} />
            </div>
        );
    }
}

// The stage has no nav, so there the failure also offers the way out.
function RouteFailure({ layout, failed }: { layout: Layout; failed: Failed }) {
    return (
        <div className="empty route-failure">
            <h1>{text.states.routeFailed}</h1>
            <p>{failed === `download` ? text.states.routeFailedSentence : text.states.routeCrashedSentence}</p>
            <div className="actions">
                <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                        window.location.reload();
                    }}
                >
                    {text.states.reload}
                </button>
                {layout === `immersive` ? (
                    <Link to="/ladder" className="btn btn-ghost">
                        {text.states.routeFailedLadder}
                    </Link>
                ) : null}
            </div>
        </div>
    );
}
