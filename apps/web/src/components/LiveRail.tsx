import { clockText, type GamePlayer, type LiveGameEntry, type Side } from '@hexo-arena/contract';
import { useLiveGames } from '../api/use-live-games';
import { Link } from '../router/Link';
import { text } from '../text';
import { BotBadge, Swatch } from './player';
import './LiveRail.css';

/**
 * The games in progress under the ladder, each a way into watching it.
 * `onlyWhenLive` renders nothing until a game is live.
 */
export function LiveRail({ onlyWhenLive = false }: { onlyWhenLive?: boolean }) {
    const { data, error } = useLiveGames();
    if (onlyWhenLive && (data === null || data.length === 0)) return null;
    return (
        <section className="live-rail" aria-labelledby="live-title">
            <div className="live-rail-head">
                <h2 id="live-title" className="section-title">
                    {text.ladder.live.title}
                </h2>
                <Link to="/games/live">{text.ladder.live.all}</Link>
            </div>
            {data === null ? (
                error ? (
                    <p className="note">{text.ladder.live.failed}</p>
                ) : (
                    <div className="skeleton live-skeleton" aria-hidden="true" />
                )
            ) : data.length === 0 ? (
                <p className="note">{text.ladder.live.none}</p>
            ) : (
                <ul className="live-list">
                    {data.map((entry) => (
                        <li key={entry.gameId}>
                            <LiveGameLink entry={entry} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// The verb is for assistive tech alone; the rest of the name is the row's
// own visible text, so a spoken command naming what is seen still matches.
function LiveGameLink({ entry }: { entry: LiveGameEntry }) {
    return (
        <Link to={`/game/${encodeURIComponent(entry.gameId)}`} className="live-game">
            <span className="sr-only">{text.ladder.live.watch}</span>
            <span className="live-seats">
                <LiveSeat side="x" player={entry.players.x} />
                <span className="live-vs">{text.ladder.live.vs}</span>
                <LiveSeat side="o" player={entry.players.o} />
            </span>
            <span className="live-meta">
                {entry.rated ? null : <span className="tag muted">{text.ladder.live.unrated}</span>}
                <span>{clockText(entry.timeControl)}</span>
                <span>{text.ladder.live.toMove(entry.players[entry.toMove].name)}</span>
            </span>
        </Link>
    );
}

function LiveSeat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="live-seat">
            <span className="live-seat-who">
                <Swatch side={side} />
                <span className="live-name">{player.name}</span>
            </span>
            {player.kind === `bot` ? <BotBadge /> : null}
        </span>
    );
}
