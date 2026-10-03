import { ErrorFrame } from '../components/states';
import { GamesHead } from '../games/GamesHead';
import { useShowTests } from '../games/show-tests';
import { ShowTests } from '../games/ShowTests';
import { LiveGameGrid } from '../live/LiveGameCard';
import { useLiveReplay } from '../live/use-live-replay';
import { Link } from '../router/Link';
import { text } from '../text';
import './LiveGamesScreen.css';

/** Every game the live list holds, as boards whose stones land as they are played. */
export function LiveGamesScreen() {
    const [tests, setTests] = useShowTests();
    const { games, failed, limited, reload } = useLiveReplay(tests);
    return (
        <>
            <div className="live-head">
                <GamesHead view="live" live={games?.length ?? null} />
                <div className="live-tools">
                    {games === null || games.length === 0 ? null : <p className="note">{text.live.count(games.length)}</p>}
                    <ShowTests on={tests} onChange={setTests} />
                </div>
            </div>
            {games === null ? (
                failed ? (
                    <ErrorFrame sentence={text.live.failed} onRetry={reload} wait={limited} />
                ) : (
                    <div className="live-grid live-skeletons" aria-hidden="true">
                        <div className="skeleton" />
                        <div className="skeleton" />
                        <div className="skeleton" />
                    </div>
                )
            ) : games.length === 0 ? (
                <div className="empty">
                    <h2>{text.live.empty.heading}</h2>
                    <p>{text.live.empty.body}</p>
                    <div className="actions">
                        <Link to="/play" className="btn btn-primary">
                            {text.live.empty.play}
                        </Link>
                        <Link to="/connect" className="btn btn-ghost">
                            {text.live.empty.build}
                        </Link>
                    </div>
                </div>
            ) : (
                <>
                    {/* Mounted empty, so a reader announces the line when a read fails. */}
                    <div role="status">{failed ? <p className="note live-stale">{text.live.refreshFailed}</p> : null}</div>
                    <LiveGameGrid games={games} level={2} />
                </>
            )}
        </>
    );
}
