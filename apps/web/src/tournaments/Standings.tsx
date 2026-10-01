import type { TournamentDetail } from '@hexo-arena/contract';
import { BotBadge, PlayerName } from '../components/player';
import { text } from '../text';

/** The standings in the ladder's table style, with the x and o split and the rule for ties under them. */
export function Standings({ detail }: { detail: TournamentDetail }) {
    const ratings = new Map(detail.entries.map((entry) => [entry.bot, entry.ratingAtStart]));
    const columns = text.tournaments.columns;
    return (
        <section className="tournament-block" aria-labelledby="tournament-standings-title">
            <h2 id="tournament-standings-title" className="section-title">
                {text.tournaments.standings}
            </h2>
            <div className="table-wrap">
                <table className="standings-table">
                    <thead>
                        <tr>
                            <th scope="col" className="num rank-col">
                                {columns.rank}
                            </th>
                            <th scope="col">{columns.bot}</th>
                            <th scope="col" className="num standings-rating">
                                {columns.rating}
                            </th>
                            <th scope="col" className="num">
                                {columns.points}
                            </th>
                            <th scope="col" className="num standings-sides">
                                {columns.sides}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {detail.standings.map((line) => (
                            <tr key={line.bot}>
                                <td className="num rank-col">{String(line.rank)}</td>
                                <td>
                                    <span className="player-cell">
                                        <PlayerName name={line.bot} kind="bot" />
                                        <BotBadge />
                                        <span className="standings-owner">{text.ladder.byOwner(line.ownerName)}</span>
                                        {line.withdrawn ? <span className="tag muted">{text.tournaments.withdrawn}</span> : null}
                                    </span>
                                </td>
                                <td className="num standings-rating">{String(ratings.get(line.bot) ?? ``)}</td>
                                <td className="num standings-points">{String(line.points)}</td>
                                <td className="num standings-sides">{`${String(line.asX)}, ${String(line.asO)}`}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="note">{text.tournaments.standingsNote}</p>
        </section>
    );
}
