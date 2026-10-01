import { clockText, type TournamentSummary } from '@hexo-arena/contract';
import { fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { LadderHead } from '../ladder/LadderHead';
import { Link } from '../router/Link';
import { text } from '../text';
import './TournamentScreen.css';

function when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

/** The tournaments: the one running, those coming up, and the latest past ones. */
export function TournamentsScreen() {
    const { data, error, limited, reload } = useAsync(fetchTournaments);
    return (
        <>
            <LadderHead view="tournaments" title={text.tournaments.title}>
                <p className="note">{text.tournaments.lead}</p>
            </LadderHead>
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
                    {data.running === null ? null : <Listed title={text.tournaments.running} id="running" tournaments={[data.running]} />}
                    {data.scheduled.length === 0 ? null : <Listed title={text.tournaments.waiting} id="waiting" tournaments={data.scheduled} />}
                    {data.past.length === 0 ? null : <Listed title={text.tournaments.past} id="past" tournaments={data.past} />}
                </>
            )}
        </>
    );
}

function Listed({ title, id, tournaments }: { title: string; id: string; tournaments: readonly TournamentSummary[] }) {
    return (
        <section className="tournament-block" aria-labelledby={`tournaments-${id}`}>
            <h2 id={`tournaments-${id}`} className="section-title">
                {title}
            </h2>
            <ul className="tournament-list">
                {tournaments.map((tournament) => (
                    <li key={tournament.id} className="tournament-row">
                        <Link to={`/tournaments/${encodeURIComponent(tournament.id)}`} className="tournament-row-name">
                            {tournament.name}
                        </Link>
                        <span className="tournament-row-facts">
                            <Facts tournament={tournament} />
                        </span>
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
                    {text.tournaments.played(tournament.entrants)}; {clock}
                </>
            );
        case `finished`:
            return (
                <>
                    {when(tournament.startsAt)};{` `}
                    {tournament.winner === null ? text.tournaments.played(tournament.entrants) : text.tournaments.won(tournament.winner.name, tournament.winner.ownerName)}
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
