import { Link } from '../router/Link';
import { text } from '../text';
import '../games/GamesHead.css';

// One of the places under Play, each a way to start something.
type PlayView = `bot` | `tournament`;

const places: readonly { view: PlayView; to: string; label: string }[] = [
    { view: `bot`, to: `/play`, label: text.play.places.bot },
    { view: `tournament`, to: `/play/tournament`, label: text.play.places.tournament },
];

/**
 * The Play heading with its places as links: playing a bot yourself, and
 * a tournament: a duel or round robin of bots, or the weekly.
 */
export function PlayHead({ view }: { view: PlayView }) {
    return (
        <div className="games-head">
            <h1 className="screen-title">{text.play.title}</h1>
            <nav className="pills games-views" aria-label={text.play.places.label}>
                {places.map((place) => (
                    <Link key={place.view} to={place.to} className={view === place.view ? `pill active` : `pill`} ariaCurrent={view === place.view}>
                        {place.label}
                    </Link>
                ))}
            </nav>
        </div>
    );
}
