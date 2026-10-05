import { clockText, deletedPlayerName, type TournamentPair, type TournamentSummary } from '@hexo-arena/contract';
import { BotBadge, PlayerName } from '../components/player';
import { glyphPairs } from '../duels/DuelRows';
import { pointsText, signed } from '../duels/words';
import { Hex } from './Crosstable';
import { cutWhy } from './DuelParts';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';
import { hexOf, tournamentPagePath } from './view';
import { verdictOf, yoursText } from './words';
import '../duels/Duels.css';
import './RoundRobin.css';

/** A tournament's date and time as its list row writes them. */
export function tournamentWhen(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

const when = tournamentWhen;

/** A tournament's tag: the weekly rated, a person's round robin unrated, or a test. */
export function TournamentTag({ tournament }: { tournament: Pick<TournamentSummary, `rated` | `test`> }) {
    const tags = text.roundRobins.tags;
    return <span className={tournament.rated ? `tag` : `tag muted`}>{tournament.test ? tags.test : tournament.rated ? tags.rated : tags.unrated}</span>;
}

/**
 * One tournament as a list row: its name linking its page, its tag, the
 * facts its state calls for, the reader's own bot's part or that they set
 * it up, and an owner's way to enter one coming up; compact, as Play's
 * side holds it, the parts stack under the name.
 */
export function TournamentRow({ tournament, owner = false, compact = false }: { tournament: TournamentSummary; owner?: boolean; compact?: boolean }) {
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const setUp = tournament.origin === `person` && viewer !== null && tournament.createdBy === viewer;
    if (tournament.pair !== undefined) return <DuelRow tournament={tournament} pair={tournament.pair} viewer={viewer} />;
    return (
        <div className={compact ? `tournament-row tournament-row-compact` : `tournament-row`}>
            <span className="tournament-tag-row">
                <Link to={tournamentPagePath(tournament.id)} className="tournament-row-name">
                    {tournament.name}
                </Link>
                <TournamentTag tournament={tournament} />
            </span>
            <span className="tournament-row-facts">
                <Facts tournament={tournament} />
            </span>
            {tournament.yours !== undefined ? (
                <span className="tournament-row-yours">{yoursText(tournament, tournament.yours)}</span>
            ) : setUp ? (
                <span className="tournament-row-yours">{text.roundRobins.lists.yourRole}</span>
            ) : null}
            {owner && tournament.status === `scheduled` && tournament.yours === undefined ? (
                <Link to={tournamentPagePath(tournament.id)} className="tournament-row-enter" ariaLabel={text.tournaments.enterBotIn(tournament.name)}>
                    {text.tournaments.enterBot}
                </Link>
            ) : null}
        </div>
    );
}

function Winner({ tournament }: { tournament: TournamentSummary }) {
    if (tournament.winner === null) return <>{text.tournaments.played(tournament.entrants)}</>;
    return (
        <>
            {text.tournaments.played(tournament.entrants)};{` `}
            {text.tournaments.winner(<PlayerName name={tournament.winner.name} kind="bot" deleted={tournament.winner.deleted} />)}
            <BotBadge />{` `}
            <span className="tournament-owner">{text.ladder.byOwner(<PlayerName name={tournament.winner.ownerName} kind="human" deleted={tournament.winner.ownerName === deletedPlayerName} />)}</span>
        </>
    );
}

// A test over reads as its page leads: the bot first in it against the rest, and the verdict.
function TestLead({ lead }: { lead: NonNullable<TournamentSummary[`lead`]> }) {
    const verdict = text.roundRobins.estimates.verdicts[verdictOf(lead.estimate)];
    return <>{text.roundRobins.lists.testLead(lead.bot, signed(lead.estimate.rating), verdict)}</>;
}

function Facts({ tournament }: { tournament: TournamentSummary }) {
    const clock = clockText(tournament.timeControl);
    const lists = text.roundRobins.lists;
    const lead = tournament.test ? tournament.lead : undefined;
    // Who stopped it: its creator, unless the operator or the creator's ban or deletion did.
    const stopper = (tournament.end?.reason ?? `creator`) === `creator` ? tournament.createdBy : null;
    const round = tournament.end?.round ?? null;
    switch (tournament.status) {
        case `scheduled`:
            return (
                <>
                    {text.tournaments.starts(when(tournament.startsAt))}; {text.tournaments.entered(tournament.entrants, tournament.maxEntrants)}; {clock}
                </>
            );
        case `running`:
            return (
                <>
                    {tournament.round === null ? null : (
                        <>
                            <span className="tournament-row-live">{text.tournaments.roundLive(tournament.round.current, tournament.round.of)}</span>;{` `}
                        </>
                    )}
                    {text.tournaments.played(tournament.entrants)}; {clock}
                </>
            );
        case `finished`:
            return (
                <>
                    {when(tournament.endedAt ?? tournament.startsAt)}; {lead === undefined ? <Winner tournament={tournament} /> : <TestLead lead={lead} />}
                </>
            );
        case `stopped`:
            return (
                <>
                    {when(tournament.endedAt ?? tournament.startsAt)}; {lead === undefined ? text.tournaments.played(tournament.entrants) : <TestLead lead={lead} />};{` `}
                    {stopper === null ? lists.stopped(round) : lists.stoppedBy(stopper, round)}
                </>
            );
        case `cut_short`:
            return (
                <>
                    {when(tournament.endedAt ?? tournament.startsAt)}; {lead === undefined ? text.tournaments.played(tournament.entrants) : <TestLead lead={lead} />}; {lists.cutShort(round)}
                </>
            );
        case `called_off`:
        case `canceled`:
            return (
                <>
                    {when(tournament.startsAt)}; {text.tournaments.outcomeInLine[tournament.status]}
                </>
            );
    }
}

// A duel's score, the leader's points first, as its row says it.
function pairScore(pair: TournamentPair): string {
    const high = Math.max(pair.first.points, pair.second.points);
    const low = Math.min(pair.first.points, pair.second.points);
    return text.duels.row.score(String(high), String(low));
}

// Where a duel stands, as its row says it.
function pairState(tournament: TournamentSummary, pair: TournamentPair): string {
    const words = text.duels.row;
    const of = pair.games.length;
    const score = pairScore(pair);
    switch (tournament.status) {
        case `running`: {
            const live = pair.games.findIndex((game) => game.outcome === `live`);
            const next = pair.games.findIndex((game) => game.outcome === `pending`);
            return live !== -1 ? words.live(live + 1, of) : words.next((next === -1 ? of - 1 : next) + 1, of);
        }
        case `finished`: {
            const leader = pair.first.points === pair.second.points ? null : pair.first.points > pair.second.points ? pair.first : pair.second;
            return leader === null ? words.level(score) : words.won(leader.name, score);
        }
        case `cut_short`:
            return words.cutShort(score, cutWhy(tournament));
        case `stopped`:
        case `canceled`:
            return words.stopped(score);
        case `scheduled`:
        case `called_off`:
            return ``;
    }
}

// A duel as a list row, one link to its page: the two bots, where it
// stands, unrated or a test, who set it up, and its games as cells while
// they fit a glance, else the score; a test over leads with its estimate.
function DuelRow({ tournament, pair, viewer }: { tournament: TournamentSummary; pair: TournamentPair; viewer: string | null }) {
    const words = text.duels.row;
    const running = tournament.status === `running`;
    const lead = tournament.test ? tournament.lead : undefined;
    const estimate = lead === undefined ? null : text.duels.row.estimate(lead.bot, signed(lead.estimate.rating), text.roundRobins.estimates.verdicts[verdictOf(lead.estimate)]);
    const glyphs = !tournament.test && Math.ceil(pair.games.length / 2) <= glyphPairs;
    const now = Date.now();
    const creator = tournament.createdBy ?? deletedPlayerName;
    return (
        <Link to={tournamentPagePath(tournament.id)} className="duel-row">
            <span className="duel-row-who">
                <PlayerName name={pair.first.name} kind="bot" deleted={pair.first.deleted} />
                <BotBadge />
                <span className="duel-row-vs">{words.vs}</span>
                <PlayerName name={pair.second.name} kind="bot" deleted={pair.second.deleted} />
                <BotBadge />
                {tournament.test ? <span className="tag muted">{words.test}</span> : null}
            </span>
            <span className="duel-row-facts">
                {estimate === null ? <span className={running ? `duel-row-live` : undefined}>{pairState(tournament, pair)}</span> : <span>{estimate}</span>}
                {tournament.test ? null : <span>{words.unrated}</span>}
                <span>{viewer !== null && viewer === tournament.createdBy ? text.roundRobins.lists.yourRole : words.startedBy(creator)}</span>
                {tournament.endedAt === undefined ? null : <span>{text.time.ago(Math.max(0, Math.floor((now - Date.parse(tournament.endedAt)) / 1000)))}</span>}
            </span>
            {glyphs ? (
                <PairGlyphs pair={pair} />
            ) : (
                <span className="duel-figure">{lead === undefined ? text.duels.row.score(String(pair.first.points), String(pair.second.points)) : text.duels.row.score(pointsText(lead.estimate.points.first), pointsText(lead.estimate.points.second))}</span>
            )}
        </Link>
    );
}

// A duel's games as cells, a line per bot with its points, inside the row's one link.
function PairGlyphs({ pair }: { pair: TournamentPair }) {
    const openings: TournamentPair[`games`][] = [];
    for (const [index, game] of pair.games.entries()) {
        const at = pair.games.length === 1 ? 0 : Math.floor(index / 2);
        openings[at] = [...(openings[at] ?? []), game];
    }
    const label = text.duels.row.glyphs(pair.first.name, pair.second.name, text.duels.row.score(String(pair.first.points), String(pair.second.points)));
    return (
        <span className="duel-glyphs" role="img" aria-label={label}>
            {[pair.first, pair.second].map((bot) => {
                const other = bot === pair.first ? pair.second : pair.first;
                return (
                    <span key={bot.key} className="glyph-line">
                        <span className="glyph-pairs" aria-hidden="true">
                            {openings.map((games, index) => (
                                <span key={index} className="xt-pair">
                                    {games.map((game, slot) => (
                                        <Hex key={slot} view={{ ...hexOf(game, bot.key), gameId: null }} side={game.x === bot.key ? `x` : `o`} bot={bot.name} opponent={other.name} />
                                    ))}
                                </span>
                            ))}
                        </span>
                        <span className="glyph-score" aria-hidden="true">
                            {String(bot.points)}
                        </span>
                    </span>
                );
            })}
        </span>
    );
}
