import { clockText, type GamePlayer, type LiveGameEntry, type Side } from '@hexo-arena/contract';
import { BotBadge, Swatch } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import './LiveGameRow.css';

/** Live games as rows, each one link into watching its game. */
export function LiveGameRows({ games }: { games: readonly LiveGameEntry[] }) {
    return (
        <ul className="live-list">
            {games.map((entry) => (
                <li key={entry.gameId}>
                    <LiveGameRow entry={entry} />
                </li>
            ))}
        </ul>
    );
}

// The verb is for assistive tech alone; the rest of the name is the row's
// own visible text, so a spoken command naming what is seen still matches.
function LiveGameRow({ entry }: { entry: LiveGameEntry }) {
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
