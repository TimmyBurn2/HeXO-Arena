import { clockText, deletedPlayerName, type TournamentSummary } from '@hexo-arena/contract';
import { BotBadge, PlayerName } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import { tournamentPagePath } from './view';
import { yoursText } from './words';
import './RoundRobin.css';

function when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

/** A tournament's tag: the weekly rated, a person's round robin unrated, or a test. */
export function TournamentTag({ tournament }: { tournament: Pick<TournamentSummary, `rated` | `test`> }) {
    const tags = text.roundRobins.tags;
    return <span className={tournament.rated ? `tag` : `tag muted`}>{tournament.test ? tags.test : tournament.rated ? tags.rated : tags.unrated}</span>;
}

/**
 * One tournament as a list row: its name linking its page, its tag, the
 * facts its state calls for, the reader's own bot's part, and an owner's
 * way to enter one coming up; compact, as Play's side holds it, the parts
 * stack under the name.
 */
export function TournamentRow({ tournament, owner = false, compact = false }: { tournament: TournamentSummary; owner?: boolean; compact?: boolean }) {
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
            {tournament.yours === undefined ? null : <span className="tournament-row-yours">{yoursText(tournament, tournament.yours)}</span>}
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

function Facts({ tournament }: { tournament: TournamentSummary }) {
    const clock = clockText(tournament.timeControl);
    const lists = text.roundRobins.lists;
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
                    {when(tournament.endedAt ?? tournament.startsAt)}; <Winner tournament={tournament} />
                </>
            );
        case `stopped`:
            return (
                <>
                    {when(tournament.endedAt ?? tournament.startsAt)}; {text.tournaments.played(tournament.entrants)}; {tournament.createdBy === null ? lists.stopped : lists.stoppedBy(tournament.createdBy, null)}
                </>
            );
        case `called_off`:
        case `canceled`:
            return (
                <>
                    {when(tournament.startsAt)}; {text.tournaments.outcome[tournament.status]}
                </>
            );
    }
}
