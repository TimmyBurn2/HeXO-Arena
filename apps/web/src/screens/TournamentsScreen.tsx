import { useCallback } from 'react';
import { clockText, deletedPlayerName, type TournamentSummary } from '@hexo-arena/contract';
import { fetchBots, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { GamesHead } from '../games/GamesHead';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';
import { tournamentPagePath } from '../tournaments/view';
import { yoursText } from '../tournaments/words';
import '../games/Events.css';
import './TournamentScreen.css';

function when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

/**
 * The tournaments under Games: the one live, those coming up, and the
 * latest past ones, each naming the reader's own bot's part; an owner who
 * has not entered one coming up is offered its entry.
 */
export function TournamentsScreen() {
    const { data, error, limited, reload } = useAsync(fetchTournaments);
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const loadRoster = useCallback(async () => (viewer === null ? [] : fetchBots(false)), [viewer]);
    const roster = useAsync(loadRoster);
    const owner = viewer !== null && (roster.data ?? []).some((bot) => bot.ownerName === viewer);
    return (
        <>
            <GamesHead view="tournaments" />
            <div className="events-lead">
                <p className="note">{text.tournaments.lead}</p>
            </div>
            {data === null ? (
                error ? (
                    <ErrorFrame sentence={text.tournaments.failed} onRetry={reload} wait={limited} />
                ) : (
                    <SkeletonRows />
                )
            ) : data.running === null && data.scheduled.length === 0 && data.past.length === 0 ? (
                <div className="empty">
                    <h2>{text.tournaments.none.heading}</h2>
                    <p>{text.tournaments.none.body}</p>
                </div>
            ) : (
                <>
                    {data.running === null ? null : <Listed title={text.tournaments.running} id="running" tournaments={[data.running]} owner={owner} />}
                    {data.scheduled.length === 0 ? null : <Listed title={text.tournaments.waiting} id="waiting" tournaments={data.scheduled} owner={owner} />}
                    {data.past.length === 0 ? null : <Listed title={text.tournaments.past} id="past" tournaments={data.past} owner={owner} />}
                </>
            )}
        </>
    );
}

function Listed({ title, id, tournaments, owner }: { title: string; id: string; tournaments: readonly TournamentSummary[]; owner: boolean }) {
    return (
        <section className="tournament-block events-section" aria-labelledby={`tournaments-${id}`}>
            <h2 id={`tournaments-${id}`} className="section-title">
                {title}
            </h2>
            <ul className="tournament-list">
                {tournaments.map((tournament) => (
                    <li key={tournament.id} className="tournament-row">
                        <Link to={tournamentPagePath(tournament.id)} className="tournament-row-name">
                            {tournament.name}
                        </Link>
                        <span className="tournament-row-facts">
                            <Facts tournament={tournament} />
                        </span>
                        {tournament.yours === undefined ? null : <span className="tournament-row-yours">{yoursText(tournament, tournament.yours)}</span>}
                        {owner && tournament.status === `scheduled` && tournament.yours === undefined ? (
                            <Link to={tournamentPagePath(tournament.id)} className="tournament-row-enter" ariaLabel={text.tournaments.enterBotIn(tournament.name)}>
                                {text.tournaments.enterBot}
                            </Link>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    );
}

function Facts({ tournament }: { tournament: TournamentSummary }) {
    const clock = clockText(tournament.timeControl);
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
                    {when(tournament.startsAt)};{` `}
                    {tournament.winner === null ? (
                        text.tournaments.played(tournament.entrants)
                    ) : (
                        <>
                            {text.tournaments.winner(<PlayerName name={tournament.winner.name} kind="bot" deleted={tournament.winner.deleted} />)}
                            <BotBadge />{` `}
                            <span className="tournament-owner">{text.ladder.byOwner(<PlayerName name={tournament.winner.ownerName} kind="human" deleted={tournament.winner.ownerName === deletedPlayerName} />)}</span>
                        </>
                    )}
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
