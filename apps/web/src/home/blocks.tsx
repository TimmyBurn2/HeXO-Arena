import type { BotListing, FinishedGameEntry, GamePlayer, LeaderboardEntry, Side, TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { clockText, pagePath, resultSentence } from '@hexo-arena/contract';
import { BotBadge, OpenTag, PlayerName, PresenceDot, Rating, seatLevelFacts, seatName, Swatch } from '../components/player';
import { Rungs } from '../components/Rungs';
import { LiveGameGrid } from '../live/LiveGameCard';
import { LiveGameRows } from '../live/LiveGameRow';
import type { LiveView } from '../live/use-live-replay';
import { Link } from '../router/Link';
import { botApiRepository } from '../site-links';
import { text } from '../text';
import { tournamentPagePath } from '../tournaments/view';
import { yoursText } from '../tournaments/words';

/** How many games Live now draws as boards; the rest are rows. */
const liveMinis = 2;
/** How many rows stand beside the boards, about their height; the rest run under them. */
const rowsBeside = 4;
/** How many rows of the ladder follow its rungs. */
const ladderRows = 5;
/** How many results Recent results lists. */
const recentCount = 8;
/** How many bots Bots online lists. */
const onlineCount = 8;

function Heading({ id, title, link }: { id: string; title: string; link?: { to: string; label: string } }) {
    return (
        <div className="home-block-head">
            <h2 id={id} className="section-title">
                {title}
            </h2>
            {link === undefined ? null : <Link to={link.to}>{link.label}</Link>}
        </div>
    );
}

/**
 * The live games past the featured one: the first few as boards, the rest
 * as rows beside and under them; a phone shows them all as rows.
 */
export function LiveNow({ games }: { games: readonly LiveView[] }) {
    // Boards with nothing beside them leave the row empty, so a few games
    // read as rows alone.
    if (games.length <= liveMinis) {
        return (
            <section className="home-block live-now" aria-labelledby="live-now-title">
                <Heading id="live-now-title" title={text.home.liveNow} link={{ to: `/games/live`, label: text.home.allLive }} />
                <div className="live-now-more">
                    <LiveGameRows games={games.map((view) => view.entry)} />
                </div>
            </section>
        );
    }
    const minis = games.slice(0, liveMinis);
    const rest = games.slice(liveMinis).map((view) => view.entry);
    return (
        <section className="home-block live-now" aria-labelledby="live-now-title">
            <Heading id="live-now-title" title={text.home.liveNow} link={{ to: `/games/live`, label: text.home.allLive }} />
            <div className="live-now-body">
                <div className="live-now-minis">
                    <LiveGameGrid games={minis} level={3} />
                </div>
                <div className="live-now-rows">
                    <div className="live-now-rows-phone">
                        <LiveGameRows games={minis.map((view) => view.entry)} />
                    </div>
                    <LiveGameRows games={rest.slice(0, rowsBeside)} />
                </div>
            </div>
            {rest.length > rowsBeside ? (
                <div className="live-now-more">
                    <LiveGameRows games={rest.slice(rowsBeside)} />
                </div>
            ) : null}
        </section>
    );
}

/**
 * The top of the ladder as rungs and a few rows, the all-time ladder when
 * nobody ranked played this month, or, while no rating has settled, the
 * bots by rating with their ratings still marked provisional.
 */
export function LadderBlock({ ladder, allTime, roster, failed, retry }: {
    ladder: readonly LeaderboardEntry[];
    allTime: boolean;
    roster: readonly BotListing[] | null;
    failed: boolean;
    retry: () => void;
}) {
    if (failed) {
        return (
            <section className="home-block" aria-labelledby="home-ladder-title">
                <Heading id="home-ladder-title" title={text.home.ladder} link={{ to: `/ladder`, label: text.home.fullLadder }} />
                <BlockFailed sentence={text.ladder.failed} retry={retry} />
            </section>
        );
    }
    if (ladder.length === 0) {
        const settling = [...(roster ?? [])].sort((a, b) => b.rating - a.rating).slice(0, ladderRows);
        if (settling.length === 0) return null;
        return (
            <section className="home-block" aria-labelledby="home-ladder-title">
                <Heading id="home-ladder-title" title={text.home.settling} link={{ to: `/bots`, label: text.home.allBots }} />
                <p className="note">{text.home.settlingNote}</p>
                <ol className="home-rows">
                    {settling.map((bot) => (
                        <li key={bot.name} className="home-row">
                            <span className="home-row-who">
                                <PlayerName name={bot.name} kind="bot" />
                                <BotBadge />
                            </span>
                            <span className="home-row-figure">
                                <span>
                                    <Rating value={bot.rating} provisional={bot.provisional} />
                                </span>
                            </span>
                        </li>
                    ))}
                </ol>
            </section>
        );
    }
    const rows = ladder.slice(3, 3 + ladderRows);
    return (
        <section className="home-block" aria-labelledby="home-ladder-title">
            <Heading id="home-ladder-title" title={text.home.ladder} link={{ to: allTime ? `/ladder?active=all` : `/ladder`, label: text.home.fullLadder }} />
            {allTime ? <p className="note">{text.home.allTime}</p> : null}
            <Rungs entries={ladder.slice(0, 3)} />
            {rows.length === 0 ? null : (
                <ol className="home-rows">
                    {rows.map((entry) => (
                        <li key={entry.name} className="home-row">
                            <span className="home-row-rank">{String(entry.rank)}</span>
                            <span className="home-row-who">
                                <PlayerName name={entry.name} kind={entry.kind} />
                                {entry.kind === `bot` ? <BotBadge /> : null}
                            </span>
                            <span className="home-row-figure">{String(entry.rating)}</span>
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
}

/** The latest results, each a link into its game; no rating moves, only who won and how. */
export function RecentResults({ games, failed, now, retry }: { games: readonly FinishedGameEntry[]; failed: boolean; now: number; retry: () => void }) {
    if (failed) {
        return (
            <section className="home-block" aria-labelledby="recent-title">
                <Heading id="recent-title" title={text.home.recent} />
                <BlockFailed sentence={text.home.recentFailed} retry={retry} />
            </section>
        );
    }
    if (games.length === 0) return null;
    return (
        <section className="home-block" aria-labelledby="recent-title">
            <Heading id="recent-title" title={text.home.recent} link={{ to: `/games`, label: text.home.allGames }} />
            <ul className="recent-list">
                {games.slice(0, recentCount).map((game) => (
                    <li key={game.gameId}>
                        <Link to={pagePath(`game`, { gameId: game.gameId })} className="recent-game">
                            <span className="live-seats">
                                <RecentSeat side="x" player={game.players.x} />
                                <span className="live-vs">{text.ladder.live.vs}</span>
                                <RecentSeat side="o" player={game.players.o} />
                            </span>
                            <span className="recent-meta">
                                <span>{resultSentence(game, { x: seatName(game.players.x), o: seatName(game.players.o) })}</span>
                                <span>{text.time.ago(Math.max(0, Math.floor((now - Date.parse(game.finishedAt)) / 1000)))}</span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function RecentSeat({ side, player }: { side: Side; player: GamePlayer }) {
    return (
        <span className="live-seat">
            <span className="live-seat-who">
                <Swatch side={side} />
                <span className={player.deleted === true ? `live-name deleted-name` : `live-name`} title={seatLevelFacts(player)}>
                    {seatName(player)}
                </span>
            </span>
            {player.kind === `bot` ? <BotBadge /> : null}
        </span>
    );
}

/** The bots holding their stream open now, by rating. */
export function BotsOnline({ roster }: { roster: readonly BotListing[] }) {
    const online = roster
        .filter((bot) => bot.online)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, onlineCount);
    if (online.length === 0) return null;
    return (
        <section className="home-block" aria-labelledby="bots-online-title">
            <Heading id="bots-online-title" title={text.home.botsOnline} link={{ to: `/bots`, label: text.home.allBots }} />
            <ul className="home-rows">
                {online.map((bot) => (
                    <li key={bot.name} className="home-row">
                        <span className="home-row-who">
                            <PresenceDot online />
                            <PlayerName name={bot.name} kind="bot" />
                            <BotBadge />
                        </span>
                        <span className="home-row-figure">
                            <OpenTag open={bot.openForChallenges} />
                            <span>
                                <Rating value={bot.rating} provisional={bot.provisional} />
                            </span>
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

// A block whose read failed says so, with the way to read it again.
function BlockFailed({ sentence, retry }: { sentence: string; retry: () => void }) {
    return (
        <p className="home-failed">
            <span className="note">{sentence}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>
                {text.states.tryAgain}
            </button>
        </p>
    );
}

/**
 * The way to bring a bot: one sentence, three steps, and the two links
 * that start it; a reader signed in has the first step done.
 */
export function BuildBand({ wide, signedInAs }: { wide: boolean; signedInAs: string | null }) {
    return (
        <section className={wide ? `home-block build-band wide` : `home-block build-band`} aria-labelledby="build-band-title">
            <Heading id="build-band-title" title={text.home.build} />
            <p className="build-band-lead">{text.home.buildLead}</p>
            <ol className="build-steps">
                {text.home.buildSteps.map((step, index) => (index === 0 && signedInAs !== null ? text.home.signedInStep(signedInAs) : step)).map((step, index) => (
                    <li key={step}>
                        <span className="build-step-n" aria-hidden="true">
                            {String(index + 1)}
                        </span>
                        <span>{step}</span>
                    </li>
                ))}
            </ol>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    {text.home.startBuilding}
                </Link>
                <a href={botApiRepository} className="btn btn-ghost" rel="noreferrer">
                    {text.home.readApi}
                </a>
            </div>
        </section>
    );
}

/** How far ahead a waiting tournament earns a block on Home. */
const tournamentSoonMs = 86_400_000;

/**
 * The tournament worth a look: the weekly running, else the next one
 * starting within a day; nothing otherwise.
 * An owner who has not entered the next one is offered its entry in its
 * own row while it waits, however far off it starts, and sees their own
 * bot's part in the one shown; anyone signed in is offered a round robin
 * of their own.
 */
export function TournamentBlock({ list, now, owner, signedIn }: { list: TournamentList; now: number; owner: boolean; signedIn: boolean }) {
    const next = list.scheduled[0];
    const open = owner && next !== undefined && next.yours === undefined ? next : null;
    const soon = list.scheduled.find((entry) => Date.parse(entry.startsAt) - now <= tournamentSoonMs);
    const shown = list.running.find((tournament) => tournament.origin === `operator`) ?? soon ?? open;
    if (shown === null) return null;
    return (
        <section className="home-block" aria-labelledby="tournament-block-title">
            <Heading id="tournament-block-title" title={text.home.tournament} link={{ to: `/games/tournaments`, label: text.home.allTournaments }} />
            <ul className="home-rows">
                <TournamentHomeRow tournament={shown} now={now} enter={open?.id === shown.id} />
                {open === null || open.id === shown.id ? null : <TournamentHomeRow tournament={open} now={now} enter />}
            </ul>
            {signedIn ? (
                <p className="home-block-foot">
                    <Link to="/play/tournament">{text.roundRobins.home.setUp}</Link>
                </p>
            ) : null}
        </section>
    );
}

// One tournament: its name, how far it got or how many entered, the reader's part, and the entry an owner may still make.
function TournamentHomeRow({ tournament, now, enter }: { tournament: TournamentSummary; now: number; enter: boolean }) {
    const wait = Math.max(0, Math.floor((Date.parse(tournament.startsAt) - now) / 1000));
    return (
        <li className="home-row">
            <span className="home-row-who">
                <Link to={tournamentPagePath(tournament.id)} className="player-name">
                    {tournament.name}
                </Link>
                <span className="note">
                    {tournament.status === `running`
                        ? text.home.tournamentRunning(tournament.entrants, clockText(tournament.timeControl))
                        : text.home.tournamentStarts(tournament.entrants, tournament.maxEntrants)}
                </span>
                {tournament.yours === undefined ? null : <span className="note home-row-yours">{yoursText(tournament, tournament.yours)}</span>}
                {enter ? (
                    <span className="home-row-enter">
                        <Link to="/play/tournament" ariaLabel={text.tournaments.enterBotIn(tournament.name)}>
                            {text.tournaments.enterBot}
                        </Link>
                    </span>
                ) : null}
            </span>
            <span className="home-row-figure">
                {tournament.status === `running` ? <span className="tag">{text.home.tournamentLive}</span> : <span>{text.home.tournamentIn(text.time.until(wait))}</span>}
            </span>
        </li>
    );
}
