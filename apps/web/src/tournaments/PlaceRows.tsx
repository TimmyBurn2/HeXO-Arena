import type { TournamentPlace, TournamentSummary } from '@hexo-arena/contract';
import { Link } from '../router/Link';
import { text } from '../text';
import { PairWho, pairStanding, pairState, tournamentAgo, TournamentTag, waitUntil } from './TournamentRow';
import { tournamentPagePath } from './view';

// Where the bot stands: entered in one to come, its place so far or at the end, or why it played no game.
function placeText(tournament: TournamentSummary, place: TournamentPlace, now: number): string {
    const words = text.tournaments.bot;
    const reasons = text.tournaments.reasons;
    switch (tournament.status) {
        case `scheduled`:
            return words.entered(waitUntil(tournament.startsAt, now));
        case `called_off`:
        case `canceled`:
            return text.tournaments.outcome[tournament.status];
        case `running`:
        case `finished`:
        case `stopped`:
        case `cut_short`: {
            if (place.rank === null || place.points === null) return words.didNotPlay(place.reason === undefined ? reasons.absent : reasons[place.reason]);
            const standing = tournament.status === `running` ? words.soFar(place.rank, place.points) : words.final(place.rank, tournament.entrants, place.points);
            return place.state === `withdrawn` && place.reason !== undefined ? `${standing}; ${words.withdrawn(reasons[place.reason])}` : standing;
        }
    }
}

/**
 * The tournaments one bot entered as rows, each one link to its page: a
 * duel by its pair, where it stands, its score and game; any other by its
 * name, where the bot stands or why it did not play, and the round under
 * way; each over with how long ago it ended, as every list of tournaments
 * dates them.
 */
export function PlaceRows({ tournaments }: { tournaments: readonly TournamentSummary[] }) {
    const now = Date.now();
    return (
        <ul className="duel-rows">
            {tournaments.map((tournament) =>
                tournament.bot === undefined ? null : (
                    <li key={tournament.id}>
                        <Link to={tournamentPagePath(tournament.id)} className="duel-row place-row">
                            {tournament.pair === undefined ? (
                                <span className="duel-row-who tournament-tag-row">
                                    {tournament.name}
                                    <TournamentTag tournament={tournament} />
                                </span>
                            ) : (
                                <PairWho pair={tournament.pair}>
                                    <TournamentTag tournament={tournament} />
                                </PairWho>
                            )}
                            <span className="duel-row-facts">
                                <span className={tournament.status === `running` ? `duel-row-live` : undefined}>
                                    {tournament.pair === undefined ? placeText(tournament, tournament.bot, now) : pairState(tournament, tournament.pair)}
                                </span>
                                {tournament.pair !== undefined && tournament.status === `running` ? <span>{pairStanding(tournament.pair)}</span> : null}
                                {tournament.round === null || tournament.pair !== undefined ? null : <span>{text.tournaments.roundOf(tournament.round.current, tournament.round.of)}</span>}
                                {tournament.status === `scheduled` || tournament.status === `running` ? null : <span>{tournamentAgo(tournament, now)}</span>}
                            </span>
                        </Link>
                    </li>
                ),
            )}
        </ul>
    );
}
