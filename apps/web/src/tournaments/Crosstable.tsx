import type { Side, TournamentDetail } from '@hexo-arena/contract';
import { pagePath } from '@hexo-arena/contract';
import { cellPoints, cellSize, hexPoints } from '../board/geometry';
import { BotBadge, PlayerName } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import { meeting, type HexState, type HexView } from './view';
import './Crosstable.css';

const halfWidth = (Math.sqrt(3) * cellSize) / 2;
// A stone leaves a band of its cell, as on a swatch, so the cell reads around it.
const stoneScale = 0.7;
const box = `${String(-halfWidth)} ${String(-cellSize)} ${String(2 * halfWidth)} ${String(2 * cellSize)}`;

const outcomeWords: Readonly<Record<HexState, string>> = {
    won: text.tournaments.outcomes.won,
    lost: text.tournaments.outcomes.lost,
    none: text.tournaments.outcomes.none,
    pending: text.tournaments.outcomes.pending,
    live: text.tournaments.outcomes.live,
    missing: text.tournaments.outcomes.not_played,
};

/**
 * The crosstable in stones: a row and a column per bot, each cell the two
 * games the row's bot played against the column's, as x and then as o,
 * each a cell of the board in that side's stone: filled when won, a ring
 * when lost or without a winner, a dot to play, a dash when not played.
 * A played game's cell links to it.
 */
export function Crosstable({ detail }: { detail: TournamentDetail }) {
    const bots = detail.standings;
    return (
        <div className="xt-frame" tabIndex={0} role="region" aria-label={text.tournaments.crosstable}>
            <table className="xt">
                <thead>
                    <tr>
                        <th scope="col" className="xt-name">
                            {text.tournaments.columns.bot}
                        </th>
                        {bots.map((bot, index) => (
                            <th key={bot.key} scope="col" className="xt-col">
                                <span aria-hidden="true">{String(index + 1)}</span>
                                <span className="sr-only">{bot.bot}</span>
                            </th>
                        ))}
                        <th scope="col" className="num">
                            {text.tournaments.total}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {detail.standings.map((line, row) => (
                        <tr key={line.key}>
                            <th scope="row" className="xt-name">
                                <span className="xt-rank" aria-hidden="true">
                                    {String(row + 1)}
                                </span>
                                <PlayerName name={line.bot} kind="bot" deleted={line.deleted} />
                                <BotBadge />
                            </th>
                            {bots.map((opponent) => {
                                const met = meeting(detail, line.key, opponent.key);
                                return (
                                    <td key={opponent.key} className={met === null ? `xt-cell xt-self` : `xt-cell`}>
                                        {met === null ? null : (
                                            <span className="xt-pair">
                                                <Hex view={met.x} side="x" bot={line.bot} opponent={opponent.bot} />
                                                <Hex view={met.o} side="o" bot={line.bot} opponent={opponent.bot} />
                                            </span>
                                        )}
                                    </td>
                                );
                            })}
                            <td className="num xt-total">{String(line.points)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Hex({ view, side, bot, opponent }: { view: HexView; side: Side; bot: string; opponent: string }) {
    const label = text.tournaments.hex(bot, side, opponent, outcomeWords[view.state]);
    const mark = (
        <svg className={`xt-hex xt-${view.state} xt-${side}`} viewBox={box} aria-hidden="true">
            <polygon className="xt-ground" points={cellPoints()} />
            {view.state === `pending` || view.state === `live` ? <circle className="xt-dot" r={cellSize / 5} /> : null}
            {view.state === `missing` ? <line className="xt-dash" x1={-cellSize / 2} x2={cellSize / 2} y1={0} y2={0} /> : null}
            {view.state === `won` || view.state === `lost` || view.state === `none` || view.state === `live` ? (
                <polygon className="xt-stone" points={hexPoints(cellSize * stoneScale)} />
            ) : null}
        </svg>
    );
    if (view.gameId === null || view.state === `pending` || view.state === `missing`) {
        return (
            <span className="xt-game" role="img" aria-label={label} title={label}>
                {mark}
            </span>
        );
    }
    return (
        <Link to={pagePath(`game`, { gameId: view.gameId })} className="xt-game" ariaLabel={label}>
            {mark}
        </Link>
    );
}
