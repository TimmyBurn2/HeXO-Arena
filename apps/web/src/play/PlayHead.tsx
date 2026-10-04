import { Link } from '../router/Link';
import { text } from '../text';
import '../games/GamesHead.css';

/** One of the places under Play, each a way to start something. */
export type PlayView = `bot` | `duel` | `tournament`;

const places: readonly { view: PlayView; to: string; label: string }[] = [
    { view: `bot`, to: `/play`, label: text.duels.playBot },
    { view: `duel`, to: `/play/duels`, label: text.duels.botDuel },
    { view: `tournament`, to: `/play/tournament`, label: text.duels.tournament },
];

/**
 * The Play heading with its places as links: playing a bot yourself, a
 * duel between two bots, and entering a bot in a tournament.
 */
export function PlayHead({ view }: { view: PlayView }) {
    return (
        <div className="games-head">
            <h1 className="screen-title">{text.play.title}</h1>
            <nav className="pills games-views" aria-label={text.duels.places}>
                {places.map((place) => (
                    <Link key={place.view} to={place.to} className={view === place.view ? `pill active` : `pill`} ariaCurrent={view === place.view}>
                        {place.label}
                    </Link>
                ))}
            </nav>
        </div>
    );
}
