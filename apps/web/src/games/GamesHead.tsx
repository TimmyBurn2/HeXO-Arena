import { useCallback } from 'react';
import { fetchLiveGames } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import './GamesHead.css';

/**
 * The Games heading with its two views, finished and live, as links; the
 * live one carries its count once known, read here unless the page already
 * holds the live list.
 */
export function GamesHead({ view, live }: { view: `finished` | `live`; live?: number | null }) {
    return (
        <div className="games-head">
            <h1 className="screen-title">{text.games.title}</h1>
            <nav className="pills games-views" aria-label={text.games.views}>
                <Link to="/games" className={view === `finished` ? `pill active` : `pill`} ariaCurrent={view === `finished`}>
                    {text.games.finished}
                </Link>
                <Link to="/games/live" className={view === `live` ? `pill active` : `pill`} ariaCurrent={view === `live`}>
                    {text.games.live}
                    {live === undefined ? <LiveCount /> : <Count value={live} />}
                </Link>
            </nav>
        </div>
    );
}

function LiveCount() {
    const load = useCallback(async () => fetchLiveGames(), []);
    return <Count value={useAsync(load).data?.length ?? null} />;
}

function Count({ value }: { value: number | null }) {
    return value === null || value === 0 ? null : (
        <>
            {` `}
            <span className="games-view-count">{String(value)}</span>
        </>
    );
}
