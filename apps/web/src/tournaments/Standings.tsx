import { Fragment, useId, useState } from 'react';
import type { TournamentDetail } from '@hexo-arena/contract';
import { BotBadge, PlayerName } from '../components/player';
import { text } from '../text';
import { BotPairings } from './Rounds';

/**
 * The standings in the ladder's table style, with the x and o split and
 * the rule for ties under them.
 * On a phone, where the crosstable is cramped, a row opens the bot's
 * pairings under it.
 */
export function Standings({ detail }: { detail: TournamentDetail }) {
    const ratings = new Map(detail.entries.map((entry) => [entry.bot, entry.ratingAtStart]));
    const [open, setOpen] = useState<string | null>(null);
    const ids = useId();
    const played = detail.rounds.length > 0;
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
                        {detail.standings.map((line, index) => {
                            const shown = open === line.bot;
                            const pairingsId = `${ids}-${String(index)}`;
                            return (
                                <Fragment key={line.bot}>
                                    <tr>
                                        <td className="num rank-col">{String(line.rank)}</td>
                                        <td>
                                            <span className="player-cell">
                                                <PlayerName name={line.bot} kind="bot" />
                                                <BotBadge />
                                                <span className="standings-owner">{text.ladder.byOwner(<PlayerName name={line.ownerName} kind="human" />)}</span>
                                                {line.withdrawn ? <span className="tag muted">{text.tournaments.withdrawn}</span> : null}
                                                {played ? (
                                                    <button
                                                        type="button"
                                                        className="standings-open"
                                                        aria-expanded={shown}
                                                        aria-controls={shown ? pairingsId : undefined}
                                                        aria-label={text.tournaments.pairingsOf(line.bot)}
                                                        onClick={() => {
                                                            setOpen(shown ? null : line.bot);
                                                        }}
                                                    >
                                                        <svg viewBox="0 0 24 24" aria-hidden="true">
                                                            <path d="M6 9l6 6 6-6" />
                                                        </svg>
                                                    </button>
                                                ) : null}
                                            </span>
                                        </td>
                                        <td className="num standings-rating">{String(ratings.get(line.bot) ?? ``)}</td>
                                        <td className="num standings-points">{String(line.points)}</td>
                                        <td className="num standings-sides">{`${String(line.asX)}, ${String(line.asO)}`}</td>
                                    </tr>
                                    {shown ? (
                                        <tr className="standings-pairings">
                                            <td colSpan={5}>
                                                <BotPairings detail={detail} bot={line.bot} id={pairingsId} />
                                            </td>
                                        </tr>
                                    ) : null}
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <p className="note">{text.tournaments.standingsNote}</p>
        </section>
    );
}
