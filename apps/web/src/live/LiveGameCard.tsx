import { clockText, type GamePlayer, type LiveGameEntry, type Side } from '@hexo-arena/contract';
import { BotBadge, Swatch } from '../components/player';
import { Clock } from '../game/Clock';
import { Link } from '../router/Link';
import { text } from '../text';
import { MiniBoard } from './MiniBoard';
import type { LiveView } from './use-live-replay';
import './LiveGameCard.css';

/**
 * Live games as a grid of boards, each card a way into its game;
 * the cards' headings sit one level under the section holding them.
 */
export function LiveGameGrid({ games, level }: { games: readonly LiveView[]; level: 2 | 3 }) {
    return (
        <ul className="live-grid">
            {games.map((game) => (
                <li key={game.entry.gameId}>
                    <LiveGameCard game={game} level={level} />
                </li>
            ))}
        </ul>
    );
}

// The heading's link stretches over the whole card,
// so the card is one target with one name,
// and the board and the clock stay outside that name.
// The board follows the heading in reading order, though it stands first on screen,
// so heading navigation lands on the game before its picture.
function LiveGameCard({ game, level }: { game: LiveView; level: 2 | 3 }) {
    const { entry } = game;
    const Heading = level === 2 ? `h2` : `h3`;
    // The clock belongs to the latest read, so it waits until the board shows that read.
    const landed = game.cells.length === entry.cells.length;
    return (
        <article className="live-card">
            <div className="live-card-body">
                <Heading className="live-card-title">
                    <Link to={`/game/${encodeURIComponent(entry.gameId)}`} className="live-card-link">
                        <span className="sr-only">{text.ladder.live.watch}</span>
                        <Seat side="x" player={entry.players.x} />
                        <span className="live-vs">{text.ladder.live.vs}</span>
                        <Seat side="o" player={entry.players.o} />
                    </Link>
                </Heading>
                <p className="live-card-turn">
                    <span>{text.ladder.live.toMove(entry.players[game.toMove].name)}</span>
                    {landed ? <RunningClock entry={entry} side={game.toMove} since={game.readAt} /> : null}
                </p>
                <p className="live-card-meta">
                    {entry.rated ? null : <span className="tag muted">{text.ladder.live.unrated}</span>}
                    <span>{clockText(entry.timeControl)}</span>
                </p>
            </div>
            <MiniBoard game={game} />
        </article>
    );
}

function Seat({ side, player }: { side: Side; player: GamePlayer }) {
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

// The side to move's time, counted from the read however late the board lands;
// an unlimited game has none.
function RunningClock({ entry, side, since }: { entry: LiveGameEntry; side: Side; since: number }) {
    const clock = entry.clock;
    if (clock.mode === `turn`) return <Clock remainingMs={clock.remainingTurnMs} running since={since} />;
    if (clock.mode === `match`) return <Clock remainingMs={clock.remainingMainMs[side]} running since={since} />;
    return null;
}
