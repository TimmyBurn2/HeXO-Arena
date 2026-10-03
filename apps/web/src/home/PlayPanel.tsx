import { resultSentence, type BotListing, type FinishedGameEntry, type LiveGameEntry, type Me } from '@hexo-arena/contract';
import { Rating, seatName } from '../components/player';
import { rosterOf } from '../play/setup';
import { Link } from '../router/Link';
import { HomeDuel } from './HomeDuel';
import { text } from '../text';

/** How many ready bots the panel offers by name. */
const offered = 3;

/**
 * The way into a game: the reader's own live games first, then the play
 * card with its ready count and a few ready bots by name, the last result,
 * and a line on how this reader plays.
 * With no bot online the card stands disabled, and the band on building
 * a bot, right under the panel, is the way forward.
 */
export function PlayPanel({ me, roster, yours, latest }: {
    me: Me | undefined;
    roster: readonly BotListing[] | null;
    yours: readonly LiveGameEntry[];
    latest: FinishedGameEntry | null;
}) {
    const ready = roster === null ? null : rosterOf(roster, []).ready;
    const quiet = roster !== null && !roster.some((bot) => bot.online);
    return (
        <section className="play-panel" aria-labelledby="play-panel-title">
            <h1 id="play-panel-title" className="screen-title">
                {text.home.title}
            </h1>
            <p className="play-panel-rules">{text.home.rules}</p>
            {yours.length === 0 ? null : <YourGames games={yours} me={me} />}
            {quiet ? (
                <div className="play-card play-card-off" aria-disabled="true">
                    <span className="play-card-title">{text.home.playBot}</span>
                    <span className="play-card-count">{text.home.noneOnline}</span>
                </div>
            ) : (
                <Link to="/play" className="play-card">
                    <span className="play-card-title">{text.home.playBot}</span>
                    {ready === null ? null : <span className="play-card-count">{text.play.readyCount(ready.length)}</span>}
                </Link>
            )}
            {ready === null || ready.length === 0 ? null : (
                <ul className="play-ready">
                    {ready.slice(0, offered).map((bot) => (
                        <li key={bot.name}>
                            <Link to={`/play?bot=${encodeURIComponent(bot.name)}`} className="play-ready-bot">
                                <span className="play-ready-name">{text.play.cardTitle(bot.name)}</span>
                                <span className="play-ready-rating">
                                    <Rating value={bot.rating} provisional={bot.provisional} />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
            {quiet ? <p className="note">{text.home.noBots}</p> : <HomeDuel bots={roster} me={me} />}
            {latest === null ? null : (
                <p className="play-panel-last">
                    {text.home.lastGame(
                        (words) => <Link to={`/game/${encodeURIComponent(latest.gameId)}`}>{words}</Link>,
                        seatName(latest.players.x),
                        seatName(latest.players.o),
                        resultSentence(latest, { x: seatName(latest.players.x), o: seatName(latest.players.o) }),
                    )}
                </p>
            )}
            <VisitorNote me={me} />
        </section>
    );
}

function YourGames({ games, me }: { games: readonly LiveGameEntry[]; me: Me | undefined }) {
    const self = me?.name;
    return (
        <section className="your-games" aria-labelledby="your-games-title">
            <h2 id="your-games-title" className="section-title">
                {text.home.yourGames}
            </h2>
            <ul className="your-games-list">
                {games.map((game) => {
                    const yourSide = game.players.x.name === self ? `x` : `o`;
                    const opponent = game.players[yourSide === `x` ? `o` : `x`];
                    return (
                        <li key={game.gameId}>
                            <Link to={`/game/${encodeURIComponent(game.gameId)}`} className="your-game">
                                <span className="your-game-who">{text.home.against(seatName(opponent))}</span>
                                <span className={game.toMove === yourSide ? `your-game-turn yours` : `your-game-turn`}>
                                    {game.toMove === yourSide ? text.home.yourTurn : text.home.toMove(seatName(opponent))}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}

function VisitorNote({ me }: { me: Me | undefined }) {
    if (me === undefined) return null;
    if (me === null) return <p className="note">{text.play.signedOutLead}</p>;
    if (me.kind === `guest`) return <p className="note">{text.play.guestNote(me.name)}</p>;
    return null;
}
