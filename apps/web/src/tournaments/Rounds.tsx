import type { TournamentBot, TournamentDetail } from '@hexo-arena/contract';
import { tournamentGamesPath } from '../games/filters';
import { Link } from '../router/Link';
import { text } from '../text';
import { pairingScore } from './view';

/**
 * Each round's pairings with their score so far and their games, newest
 * round first; `only` keeps one round, `except` leaves one out.
 */
export function Rounds({ detail, only, except }: { detail: TournamentDetail; only?: number; except?: number | null }) {
    const rounds = detail.rounds
        .filter((round) => (only === undefined || round.round === only) && round.round !== except)
        .filter((round) => only !== undefined || round.pairings.some((pairing) => pairing.games.some((game) => game.outcome !== `pending`)))
        .reverse();
    if (rounds.length === 0) return null;
    const body = rounds.map((round) => (
        <div key={round.round} className="round">
            {only === undefined ? <h3 className="round-title">{text.tournaments.round(round.round)}</h3> : null}
            <ul className="round-pairings">
                {round.pairings.map((pairing) => (
                    <PairingItem key={`${String(pairing.first.key)} ${String(pairing.second.key)}`} pairing={pairing} games={tournamentGamesPath(detail.id, round.round)} />
                ))}
            </ul>
            {round.rest === null ? null : <p className="note round-rest">{text.tournaments.rest(<BotLabel bot={round.rest} />)}</p>}
        </div>
    ));
    if (only !== undefined) return <>{body}</>;
    return (
        <section className="tournament-block" aria-labelledby="tournament-rounds-title">
            <h2 id="tournament-rounds-title" className="section-title">
                {text.tournaments.rounds}
            </h2>
            {body}
        </section>
    );
}

/** One bot's pairings, by its key, a round to a line, newest first, as a standings row opens them on a phone. */
export function BotPairings({ detail, bot, id }: { detail: TournamentDetail; bot: number; id: string }) {
    const met = detail.rounds.flatMap((round) =>
        round.pairings.filter((pairing) => pairing.first.key === bot || pairing.second.key === bot).map((pairing) => ({ round: round.round, pairing })),
    );
    return (
        <ul className="round-pairings bot-pairings" id={id}>
            {met.reverse().map(({ round, pairing }) => (
                <PairingItem key={round} pairing={pairing} round={round} games={tournamentGamesPath(detail.id, round)} />
            ))}
        </ul>
    );
}

type Pairing = TournamentDetail[`rounds`][number][`pairings`][number];

// A bot in a round line; a deleted one reads apart, as everywhere a name renders.
function BotLabel({ bot }: { bot: TournamentBot }) {
    return bot.deleted === true ? <span className="deleted-name">{bot.name}</span> : <>{bot.name}</>;
}

// A pair playing several openings names its games together, linking the round's games under Games; two are each named.
function PairingItem({ pairing, round, games }: { pairing: Pairing; round?: number; games: string }) {
    const [first, second] = pairingScore(pairing);
    return (
        <li className="round-pairing">
            {round === undefined ? null : <span className="round-of">{text.tournaments.round(round)}</span>}
            <span className="round-names">{text.tournaments.pairingLine(<BotLabel bot={pairing.first} />, <BotLabel bot={pairing.second} />)}</span>
            <span className="round-score">{text.tournaments.score(first, second)}</span>
            {pairing.games.length > 2 ? (
                <span className="round-games">
                    <Link to={games} className="round-game">
                        {text.roundRobins.page.legs(pairing.games.length, pairing.games.length / 2)}
                    </Link>
                </span>
            ) : (
                <span className="round-games">
                    {pairing.games.map((game, index) =>
                        game.gameId === null ? (
                            <span key={index} className="round-game muted">
                                {text.tournaments.outcomes[game.outcome === `played` || game.outcome === `aborted` ? `none` : game.outcome]}
                            </span>
                        ) : (
                            <Link key={index} to={`/game/${encodeURIComponent(game.gameId)}`} className="round-game">
                                {gameWords(pairing, game, index)}
                            </Link>
                        ),
                    )}
                </span>
            )}
        </li>
    );
}

// A game's link names it by its number and how it stands.
function gameWords(pairing: Pairing, game: Pairing[`games`][number], index: number): string {
    const winner = game.point === pairing.first.key ? pairing.first : pairing.second;
    const outcome =
        game.outcome === `played`
            ? game.point === null
                ? text.tournaments.outcomes.none
                : `${winner.name} ${text.tournaments.outcomes.won}`
            : text.tournaments.outcomes[game.outcome === `aborted` ? `none` : game.outcome];
    return text.tournaments.gameLine(index + 1, outcome);
}
