import { clockText, type GamePlayer, type LiveGameEntry, type Side } from '@hexo-arena/contract';
import { BotBadge, seatLevelFacts, seatName, Swatch } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import { gameCaption } from '../tournaments/words';
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
                {entry.test === true ? <span className="tag muted">{text.games.test}</span> : entry.rated ? null : <span className="tag muted">{text.ladder.live.unrated}</span>}
                <span>{clockText(entry.timeControl)}</span>
                {entry.duel === undefined ? null : <span>{text.duels.caption(entry.test === true ? `test` : `duel`, entry.duel.game, entry.duel.of)}</span>}
                {entry.tournament === undefined ? null : <span>{gameCaption(entry.tournament)}</span>}
                <span>{text.ladder.live.toMove(seatName(entry.players[entry.toMove]))}</span>
            </span>
        </Link>
    );
}

function LiveSeat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="live-seat">
            <span className="live-seat-who">
                <Swatch side={side} />
                <span className="live-name" title={seatLevelFacts(player)}>
                    {seatName(player)}
                </span>
            </span>
            {player.kind === `bot` ? <BotBadge /> : null}
        </span>
    );
}
