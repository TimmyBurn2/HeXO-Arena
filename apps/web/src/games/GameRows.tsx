import { clockText, resultSentence, type FinishedGameEntry, type GamePlayer, type Side } from '@hexo-arena/contract';
import { BotBadge, Rating, Swatch } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import './GameRows.css';

/**
 * Finished games as rows, each a link into its game: both seats at the
 * rating they stood at before the result, the result in words, the clock,
 * the opening, the length, and when it ended; never a rating's move.
 * A game the operator voided stays listed, tagged, as it counts in no
 * record.
 * A wide window lines them up under a head of columns; a narrow one makes
 * each a card with the time at its top right.
 */
export function GameRows({ games, now, label }: { games: readonly FinishedGameEntry[]; now: number; label?: string }) {
    const columns = text.games.columns;
    // A list a page turns to takes the keyboard by its name.
    const named = label === undefined ? {} : { 'aria-label': label, tabIndex: -1 };
    return (
        <ol className="game-rows" {...named}>
            {/* The row's own words name each value, so the head is for the eye
                alone; it shares the rows' grid, so its columns are theirs. */}
            <li className="game-rows-head" aria-hidden="true">
                <span>{columns.players}</span>
                <span>{columns.result}</span>
                <span>{columns.clock}</span>
                <span>{columns.opening}</span>
                <span>{columns.length}</span>
                <span>{columns.finished}</span>
            </li>
            {games.map((game) => (
                <li key={game.gameId}>
                    <Link to={`/game/${encodeURIComponent(game.gameId)}`} className="game-row">
                        <span className="game-row-seats">
                            <Seat side="x" player={game.players.x} />
                            <span className="game-row-vs">{text.games.versus}</span>
                            <Seat side="o" player={game.players.o} />
                        </span>
                        <span className="game-row-result">
                            {resultSentence(game, { x: game.players.x.name, o: game.players.o.name })}
                            {game.voided ? <span className="tag muted">{text.games.voided}</span> : null}
                        </span>
                        <span className="game-row-facts">
                            <span>{clockText(game.timeControl)}</span>
                            <span>{text.games.openingValue(game.openingPlies)}</span>
                            <span>{text.games.turns(game.turns)}</span>
                        </span>
                        <time className="game-row-when" dateTime={game.finishedAt} title={game.finishedAt.replace(`T`, ` `).replace(`Z`, ` UTC`)}>
                            {text.time.ago(Math.max(0, Math.floor((now - Date.parse(game.finishedAt)) / 1000)))}
                        </time>
                    </Link>
                </li>
            ))}
        </ol>
    );
}

function Seat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="game-row-seat">
            <span className="game-row-who">
                <Swatch side={side} />
                <span className="game-row-name">{player.name}</span>
            </span>
            {player.kind === `bot` ? <BotBadge /> : null}
            {player.rating === null ? null : (
                <span className="game-row-rating">
                    <Rating value={player.rating} provisional={player.provisional} />
                </span>
            )}
        </span>
    );
}
