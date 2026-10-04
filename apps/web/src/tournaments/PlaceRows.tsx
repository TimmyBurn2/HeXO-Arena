import type { TournamentPlace, TournamentSummary } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { text } from '../text';
import { tournamentPagePath } from './view';

function day(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium` }).format(new Date(iso));
}

function when(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

// Where the bot stands: its place so far or at the end, or why it played no game.
function placeText(tournament: TournamentSummary, place: TournamentPlace): string {
    const words = text.tournaments.bot;
    const reasons = text.tournaments.reasons;
    switch (tournament.status) {
        case `scheduled`:
            return words.entered(when(tournament.startsAt));
        case `called_off`:
        case `canceled`:
            return text.tournaments.outcome[tournament.status];
        case `running`:
        case `finished`: {
            if (place.rank === null || place.points === null) return words.didNotPlay(place.reason === undefined ? reasons.absent : reasons[place.reason]);
            const standing = tournament.status === `running` ? words.soFar(place.rank, place.points) : words.final(place.rank, tournament.entrants, place.points);
            return place.state === `withdrawn` && place.reason !== undefined ? `${standing}; ${words.withdrawn(reasons[place.reason])}` : standing;
        }
    }
}

/**
 * The tournaments one bot entered as rows, each one link to its page: the
 * name, where the bot stands or why it did not play, the round under way,
 * and the day it ended or began.
 */
export function PlaceRows({ tournaments }: { tournaments: readonly TournamentSummary[] }) {
    return (
        <ul className="duel-rows">
            {tournaments.map((tournament) =>
                tournament.bot === undefined ? null : (
                    <li key={tournament.id}>
                        <Link to={tournamentPagePath(tournament.id)} className="duel-row place-row">
                            <span className="duel-row-who">{tournament.name}</span>
                            <span className="duel-row-facts">
                                <span className={tournament.status === `running` ? `duel-row-live` : undefined}>{placeText(tournament, tournament.bot)}</span>
                                {tournament.round === null ? null : <span>{text.tournaments.roundOf(tournament.round.current, tournament.round.of)}</span>}
                                {tournament.status === `scheduled` ? null : <span>{day(tournament.endedAt ?? tournament.startsAt)}</span>}
                            </span>
                        </Link>
                    </li>
                ),
            )}
        </ul>
    );
}
