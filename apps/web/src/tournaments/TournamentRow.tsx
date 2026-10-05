import type { ReactNode } from 'react';
import { clockText, deletedPlayerName, type TournamentDetail, type TournamentPair, type TournamentSummary } from '@hexo-arena/contract';
import { BotBadge } from '../components/player';
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

/** How long until a tournament starts, as every place naming a coming start says it; null once the start is due. */
export function waitUntil(startsAt: string, now: number): string | null {
    const seconds = Math.floor((Date.parse(startsAt) - now) / 1000);
    return seconds > 0 ? text.time.until(seconds) : null;
}

/** A coming tournament's start, its entries, and its clock, as Play and the lists both say them. */
export function comingFacts(tournament: Pick<TournamentDetail, `startsAt` | `maxEntrants` | `timeControl`>, entered: number, now: number): string {
    return [text.tournaments.startsIn(waitUntil(tournament.startsAt, now)), text.tournaments.entered(entered, tournament.maxEntrants), clockText(tournament.timeControl)].join(`; `);
}

/** How long ago a tournament ended, or began where it never ended, as every row of a list says it. */
export function tournamentAgo(tournament: Pick<TournamentSummary, `endedAt` | `startsAt`>, now: number): string {
    return text.time.ago(Math.max(0, Math.floor((now - Date.parse(tournament.endedAt ?? tournament.startsAt)) / 1000)));
}

// A list row draws each game while the openings fit a glance; past it, and in a test, the score.
const glyphOpenings = 5;

/** A tournament's tag: the weekly rated, a person's round robin unrated, or a test. */
export function TournamentTag({ tournament }: { tournament: Pick<TournamentSummary, `rated` | `test`> }) {
    const tags = text.roundRobins.tags;
    return <span className={tournament.rated ? `tag` : `tag muted`}>{tournament.test ? tags.test : tournament.rated ? tags.rated : tags.unrated}</span>;
}

/**
 * One tournament as a list row: a duel's or a round robin's under way or
 * over, one link to its page in the duel row's frame, its facts, the
 * reader's own bot's part or that they set it up, and its leaders' points
 * or a duel's games as cells; one coming up named with its start, and an
 * owner's way to enter it; compact, as Play's side holds it, the parts
 * stack under the name.
 */
export function TournamentRow({ tournament, owner = false, compact = false }: { tournament: TournamentSummary; owner?: boolean; compact?: boolean }) {
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    if (tournament.pair !== undefined) return <DuelRow tournament={tournament} pair={tournament.pair} viewer={viewer} />;
    if (tournament.status !== `scheduled`) return <FieldRow tournament={tournament} viewer={viewer} />;
    return (
        <div className={compact ? `tournament-row tournament-row-compact` : `tournament-row`}>
            <span className="tournament-tag-row">
                <Link to={tournamentPagePath(tournament.id)} className="tournament-row-name">
                    {tournament.name}
                </Link>
                <TournamentTag tournament={tournament} />
            </span>
            <span className="tournament-row-facts">{comingFacts(tournament, tournament.entrants, Date.now())}</span>
            {tournament.yours === undefined ? null : <span className="tournament-row-yours">{yoursText(tournament, tournament.yours)}</span>}
            {owner && tournament.yours === undefined ? (
                <Link to={tournamentPagePath(tournament.id)} className="tournament-row-enter" ariaLabel={text.tournaments.enterBotIn(tournament.name)}>
                    {text.tournaments.enterBot}
                </Link>
            ) : null}
        </div>
    );
}

// A test over reads as its page leads, whatever its size: the bot first in it against the rest, and the verdict.
function testLead(lead: NonNullable<TournamentSummary[`lead`]>): string {
    const verdict = text.roundRobins.estimates.verdicts[verdictOf(lead.estimate)];
    return text.roundRobins.lists.testLead(lead.bot, signed(lead.estimate.rating), verdict);
}

// A round robin under way or over as a list row, the duel row's frame: its
// name and tag, where it stands, its field, who set it up, and when it
// ended; the reader's part; and its leaders' points of their games.
function FieldRow({ tournament, viewer }: { tournament: TournamentSummary; viewer: string | null }) {
    const lists = text.roundRobins.lists;
    const now = Date.now();
    const person = tournament.origin === `person`;
    const setUp = person && viewer !== null && tournament.createdBy === viewer;
    const lead = tournament.test ? tournament.lead : undefined;
    const round = tournament.end?.round ?? null;
    // Who stopped it: its creator, unless the operator or the creator's ban or deletion did.
    const stopper = (tournament.end?.reason ?? `creator`) === `creator` ? tournament.createdBy : null;
    const field = tournament.gamesPerPair === 2 ? text.tournaments.played(tournament.entrants) : lists.field(tournament.entrants, tournament.gamesPerPair);
    const state =
        tournament.status === `running`
            ? tournament.round === null
                ? null
                : text.tournaments.roundLive(tournament.round.current, tournament.round.of)
            : tournament.status === `stopped`
              ? stopper === null
                  ? lists.stopped(round)
                  : lists.stoppedBy(stopper, round)
              : tournament.status === `cut_short`
                ? lists.cutShort(round)
                : tournament.status === `called_off` || tournament.status === `canceled`
                  ? text.tournaments.outcomeInLine[tournament.status]
                  : null;
    const yours = tournament.yours !== undefined ? yoursText(tournament, tournament.yours) : setUp ? lists.yourRole : null;
    return (
        <Link to={tournamentPagePath(tournament.id)} className="duel-row">
            <span className="duel-row-who tournament-tag-row">
                <span className="event-row-name">{tournament.name}</span>
                <TournamentTag tournament={tournament} />
            </span>
            <span className="duel-row-facts">
                {state === null ? null : <span className={tournament.status === `running` ? `duel-row-live` : undefined}>{state}</span>}
                {lead === undefined ? null : <span>{testLead(lead)}</span>}
                <span>{field}</span>
                <span>{person ? lists.setUpBy(tournament.createdBy ?? deletedPlayerName) : lists.weekly}</span>
                {tournament.status === `running` ? null : <span>{tournamentAgo(tournament, now)}</span>}
            </span>
            {yours === null ? null : <span className="event-row-yours">{yours}</span>}
            {tournament.leaders === undefined ? null : <LeadersFigure tournament={tournament} leaders={tournament.leaders} />}
        </Link>
    );
}

// The leaders' points of their games, and who leads, won, or led when it ended early.
function LeadersFigure({ tournament, leaders }: { tournament: TournamentSummary; leaders: NonNullable<TournamentSummary[`leaders`]> }) {
    const lists = text.roundRobins.lists;
    const names = leaders.bots.map((bot) => bot.name);
    const sub = tournament.status === `running` ? lists.leads(names) : tournament.status === `finished` ? lists.won(names) : lists.led(names);
    return (
        <span className="event-figure">
            <span className="event-figure-main">{lists.figure(leaders.points, leaders.games)}</span>
            <span className="event-figure-sub">{sub}</span>
        </span>
    );
}

// A duel's score, the leader's points first, as its row says it.
function pairScore(pair: TournamentPair): string {
    const high = Math.max(pair.first.points, pair.second.points);
    const low = Math.min(pair.first.points, pair.second.points);
    return text.duels.row.score(String(high), String(low));
}

/** Who leads a duel by how much, or that it stands level. */
export function pairStanding(pair: TournamentPair): string {
    const words = text.duels.page.status;
    const leader = pair.first.points === pair.second.points ? null : pair.first.points > pair.second.points ? pair.first : pair.second;
    return leader === null ? words.level(pairScore(pair)) : words.leads(leader.name, pairScore(pair));
}

/** Where a duel stands, as a list row says it: the game live or next, or how it ended and the score. */
export function pairState(tournament: Pick<TournamentSummary, `status` | `end`>, pair: TournamentPair): string {
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
// stands, unrated or a test, who set it up, and when it ended; the
// reader's part; and its games as cells while they fit a glance, else its
// score framed as a round robin's leaders are; a test over leads with its
// estimate.
function DuelRow({ tournament, pair, viewer }: { tournament: TournamentSummary; pair: TournamentPair; viewer: string | null }) {
    const words = text.duels.row;
    const lists = text.roundRobins.lists;
    const running = tournament.status === `running`;
    const lead = tournament.test ? tournament.lead : undefined;
    const glyphs = !tournament.test && Math.ceil(pair.games.length / 2) <= glyphOpenings;
    const now = Date.now();
    const setUp = viewer !== null && viewer === tournament.createdBy;
    const yours = tournament.yours !== undefined ? yoursText(tournament, tournament.yours) : setUp ? lists.yourRole : null;
    return (
        <Link to={tournamentPagePath(tournament.id)} className="duel-row">
            <PairWho pair={pair}>{tournament.test ? <span className="tag muted">{words.test}</span> : null}</PairWho>
            <span className="duel-row-facts">
                {lead === undefined ? <span className={running ? `duel-row-live` : undefined}>{pairState(tournament, pair)}</span> : <span>{testLead(lead)}</span>}
                {tournament.test ? null : <span>{words.unrated}</span>}
                <span>{lists.setUpBy(tournament.createdBy ?? deletedPlayerName)}</span>
                {running ? null : <span>{tournamentAgo(tournament, now)}</span>}
            </span>
            {yours === null ? null : <span className="event-row-yours">{yours}</span>}
            {glyphs ? <PairGlyphs pair={pair} /> : <PairFigure tournament={tournament} pair={pair} />}
        </Link>
    );
}

// A duel's score, its leader's points first, and who leads, won, or led
// it, once a point is scored; a test over counts a game without a winner a
// half to each, as its estimate does.
function PairFigure({ tournament, pair }: { tournament: TournamentSummary; pair: TournamentPair }) {
    const lists = text.roundRobins.lists;
    const lead = tournament.lead;
    const leader = pair.first.points >= pair.second.points ? pair.first : pair.second;
    const other = leader === pair.first ? pair.second : pair.first;
    const [name, high, low] = lead === undefined ? [leader.name, leader.points, other.points] : [lead.bot, lead.estimate.points.first, lead.estimate.points.second];
    if (high === 0) return null;
    const sub = high === low ? lists.level : tournament.status === `running` ? lists.leads([name]) : tournament.status === `finished` ? lists.won([name]) : lists.led([name]);
    return (
        <span className="event-figure">
            <span className="event-figure-main">{text.duels.row.score(pointsText(high), pointsText(low))}</span>
            <span className="event-figure-sub">{sub}</span>
        </span>
    );
}

/** A duel's two bots as a list row names them: plain names, since the row is one link to the duel. */
export function PairWho({ pair, children }: { pair: TournamentPair; children?: ReactNode }) {
    const name = (bot: TournamentPair[`first`]) => <span className={bot.deleted === true ? `deleted-name` : undefined}>{bot.name}</span>;
    return (
        <span className="duel-row-who">
            {name(pair.first)}
            <BotBadge />
            <span className="duel-row-vs">{text.duels.row.vs}</span>
            {name(pair.second)}
            <BotBadge />
            {children}
        </span>
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
