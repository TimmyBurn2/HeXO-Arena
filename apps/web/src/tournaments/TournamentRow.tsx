import { clockText, deletedPlayerName, type TournamentSummary } from '@hexo-arena/contract';
import { BotBadge, PlayerName } from '../components/player';
import { signed } from '../duels/words';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';
import { tournamentPagePath } from './view';
import { verdictOf, yoursText } from './words';
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
        case `called_off`:
        case `canceled`:
            return (
                <>
                    {when(tournament.startsAt)}; {text.tournaments.outcomeInLine[tournament.status]}
                </>
            );
    }
}
