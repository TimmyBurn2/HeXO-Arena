import { useCallback } from 'react';
import { fetchDuels } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import '../games/GamesHead.css';

/**
 * The Play heading with its two places, playing a bot and bot duels, as
 * links; the duels one carries how many run now once known, read here
 * unless the page already holds the list.
 */
export function PlayHead({ view, live }: { view: `bot` | `duels`; live?: number | null }) {
    const words = text.duels;
    return (
        <div className="games-head">
            <h1 className="screen-title">{text.play.title}</h1>
            <nav className="pills games-views" aria-label={words.places}>
                <Link to="/play" className={view === `bot` ? `pill active` : `pill`} ariaCurrent={view === `bot`}>
                    {words.playBot}
                </Link>
                <Link to="/play/duels" className={view === `duels` ? `pill active` : `pill`} ariaCurrent={view === `duels`}>
                    {words.botDuels}
                    {live === undefined ? <LiveDuels /> : <Count value={live} />}
                </Link>
            </nav>
        </div>
    );
}

function LiveDuels() {
    const load = useCallback(async () => fetchDuels(), []);
    return <Count value={useAsync(load).data?.running.length ?? null} />;
}

function Count({ value }: { value: number | null }) {
    return value === null || value === 0 ? null : (
        <>
            {` `}
            <span className="games-view-count">{text.duels.liveCount(value)}</span>
        </>
    );
}
