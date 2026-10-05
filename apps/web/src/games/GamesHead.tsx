import { useCallback } from 'react';
import { fetchLiveGames } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import './GamesHead.css';

// One of the places under Games.
type GamesView = `finished` | `live` | `duels` | `tournaments`;

const places: readonly { view: GamesView; to: string }[] = [
    { view: `finished`, to: `/games` },
    { view: `live`, to: `/games/live` },
    { view: `duels`, to: `/games/duels` },
    { view: `tournaments`, to: `/games/tournaments` },
];

/**
 * The Games heading with its places as links: finished, live, duels, and
 * tournaments.
 * Live alone carries a count, every live game's, once known, read here
 * unless the page already holds the live list; one count keeps the four
 * in one row on a phone.
 */
export function GamesHead({ view, live }: { view: GamesView; live?: number | null }) {
    return (
        <div className="games-head">
            <h1 className="screen-title">{text.games.title}</h1>
            <nav className="pills games-views" aria-label={text.games.views}>
                {places.map((place) => (
                    <Link key={place.view} to={place.to} className={view === place.view ? `pill active` : `pill`} ariaCurrent={view === place.view}>
                        {text.games.places[place.view]}
                        {place.view !== `live` ? null : live === undefined ? <LiveCount /> : <Count value={live} />}
                    </Link>
                ))}
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
