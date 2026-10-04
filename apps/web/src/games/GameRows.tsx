import { clockText, resultSentence, type FinishedGameEntry, type GamePlayer, type Side } from '@hexo-arena/contract';
import { BotBadge, Rating, seatLevelFacts, seatName, seatsRateNobody, Swatch } from '../components/player';
import { duelPagePath } from '../duels/setup';
import { Link } from '../router/Link';
import { text } from '../text';
import { gameCaption } from '../tournaments/words';
import './GameRows.css';

/**
 * Finished games as rows, each a link into its game: both seats at the
 * rating they stood at before the result, the result in words, the clock,
 * the opening, the length, and when it ended; never a rating's move.
 * A game the operator voided stays listed, tagged, as it counts in no
 * record; one community analyzers have read whole says how many did.
 * A game of a duel or a tournament names it under the result, a link of
 * its own beside the row's, since a link holds no other: on a narrow
 * window a line under the card, on a wide one laid over the row.
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
                <GameRow key={game.gameId} game={game} now={now} />
            ))}
        </ol>
    );
}

function GameRow({ game, now }: { game: FinishedGameEntry; now: number }) {
    const event = eventOf(game);
    const result = (
        <>
            {resultSentence(game, { x: seatName(game.players.x), o: seatName(game.players.o) })}
            {game.voided ? <span className="tag muted">{text.games.voided}</span> : null}
            {game.test === true ? (
                <span className="tag muted">{text.games.test}</span>
            ) : seatsRateNobody(game.players) || game.unratedByChoice === true ? (
                <span className="tag muted">{text.games.unrated}</span>
            ) : null}
            {game.analyses > 0 ? <span className="tag">{text.games.analyses(game.analyses)}</span> : null}
        </>
    );
    return (
        <li className={event === null ? undefined : `game-row-evented`}>
            <Link to={`/game/${encodeURIComponent(game.gameId)}`} className="game-row">
                <span className="game-row-seats">
                    <Seat side="x" player={game.players.x} />
                    <span className="game-row-vs">{text.games.versus}</span>
                    <Seat side="o" player={game.players.o} />
                </span>
                <span className="game-row-result">
                    {result}
                    {event === null ? null : (
                        <span className="game-row-event-space" aria-hidden="true">
                            {event.words}
                        </span>
                    )}
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
            {event === null ? null : (
                <p className="game-row-event">
                    {/* On a wide window the caption lies over the row, below an unseen copy of the result that sets it where the row keeps room for it. */}
                    <span className="game-row-event-space" aria-hidden="true">
                        {result}
                    </span>
                    <Link to={event.to}>{event.words}</Link>
                </p>
            )}
        </li>
    );
}

// The duel or tournament a game belongs to, as its caption names and links it.
function eventOf(game: FinishedGameEntry): { to: string; words: string } | null {
    if (game.tournament !== undefined) {
        return { to: `/tournaments/${encodeURIComponent(game.tournament.id)}`, words: gameCaption(game.tournament) };
    }
    if (game.duel !== undefined) return { to: duelPagePath(game.duel.id), words: text.duels.caption(game.test === true ? `test` : `duel`, game.duel.game, game.duel.of) };
    return null;
}

function Seat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="game-row-seat">
            <span className="game-row-who">
                <Swatch side={side} />
                <span className={player.deleted === true ? `game-row-name deleted-name` : `game-row-name`} title={seatLevelFacts(player)}>
                    {seatName(player)}
                </span>
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
