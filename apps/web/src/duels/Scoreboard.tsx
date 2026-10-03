import type { DuelDetail, DuelGame, DuelSide, Side } from '@hexo-arena/contract';
import { cellPoints, cellSize, hexPoints } from '../board/geometry';
import { BotBadge, PlayerName } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import '../tournaments/Crosstable.css';
import './Duels.css';

const halfWidth = (Math.sqrt(3) * cellSize) / 2;
// A stone leaves a band of its cell, as on a swatch, so the cell reads around it.
const stoneScale = 0.7;
const box = `${String(-halfWidth)} ${String(-cellSize)} ${String(2 * halfWidth)} ${String(2 * cellSize)}`;

/** One bot's game in the scoreboard: how it stands for that bot. */
export type GlyphState = `won` | `lost` | `none` | `live` | `pending` | `missing`;

const outcomeWords: Readonly<Record<GlyphState, string>> = {
    won: text.tournaments.outcomes.won,
    lost: text.tournaments.outcomes.lost,
    none: text.tournaments.outcomes.none,
    pending: text.tournaments.outcomes.pending,
    live: text.tournaments.outcomes.live,
    missing: text.tournaments.outcomes.not_played,
};

/** How a game of the duel stands for one of its bots. */
export function glyphOf(game: DuelGame, side: DuelSide): GlyphState {
    switch (game.state) {
        case `live`:
            return `live`;
        case `pending`:
            return `pending`;
        case `not_played`:
        case `aborted`:
            return `missing`;
        case `played`:
            return game.winner === null ? `none` : game.winner === side ? `won` : `lost`;
    }
}

/** The side a bot of the duel played in a game. */
export function sideIn(game: DuelGame, side: DuelSide): Side {
    return game.x === side ? `x` : `o`;
}

/** The games in pairs, a single game standing alone. */
export function pairsOf(games: readonly DuelGame[]): DuelGame[][] {
    const pairs: DuelGame[][] = [];
    for (let index = 0; index < games.length; index += 2) pairs.push(games.slice(index, index + 2));
    return pairs;
}

/**
 * One game as a cell of the board in the stone of the side the bot played:
 * filled when won, a ring when lost or without a winner, a ring in the live
 * color with a dot while live, a dot to play, a dash when not played; a
 * link into the game once it has one, unless drawn too small to press.
 */
export function GameGlyph({ game, side, bot, opponent, linked = true }: { game: DuelGame; side: DuelSide; bot: string; opponent: string; linked?: boolean }) {
    const state = glyphOf(game, side);
    const played = sideIn(game, side);
    const label = text.tournaments.hex(bot, played, opponent, outcomeWords[state]);
    const mark = (
        <svg className={`xt-hex xt-${state === `missing` ? `missing` : state} xt-${played}`} viewBox={box} aria-hidden="true">
            <polygon className="xt-ground" points={cellPoints()} />
            {state === `pending` || state === `live` ? <circle className="xt-dot" r={cellSize / 5} /> : null}
            {state === `missing` ? <line className="xt-dash" x1={-cellSize / 2} x2={cellSize / 2} y1={0} y2={0} /> : null}
            {state === `won` || state === `lost` || state === `none` || state === `live` ? <polygon className="xt-stone" points={hexPoints(cellSize * stoneScale)} /> : null}
        </svg>
    );
    if (!linked || game.gameId === null || state === `pending` || state === `missing`) {
        return (
            <span className="xt-game" role="img" aria-label={label} title={label}>
                {mark}
            </span>
        );
    }
    return (
        <Link to={`/game/${encodeURIComponent(game.gameId)}`} className="xt-game" ariaLabel={label}>
            {mark}
        </Link>
    );
}

/**
 * The scoreboard: one row per bot, a column per pair holding that bot's two
 * games in the order played, and its points at the end, the leader's in the
 * accent; a single game is one column. Wide ones scroll inside their frame,
 * the names and the points held in place. A compact one draws its cells too
 * small to press, so they link nowhere and the games list links each game.
 */
export function Scoreboard({ duel, compact = false, label }: { duel: Pick<DuelDetail, `first` | `second` | `games` | `score`>; compact?: boolean; label: string }) {
    const pairs = pairsOf(duel.games);
    const words = text.duels.page;
    const leader: DuelSide | null = duel.score.first === duel.score.second ? null : duel.score.first > duel.score.second ? `first` : `second`;
    return (
        <div className="sb-frame" tabIndex={0} role="region" aria-label={label}>
            <table className={compact ? `sb sb-xs` : `sb`}>
                <thead>
                    <tr>
                        <th scope="col" className="sb-name">
                            <span className="sr-only">{words.bot}</span>
                        </th>
                        {pairs.map((pair, index) => (
                            <th key={pair[0]?.game ?? index} scope="col">
                                {duel.games.length === 1 ? words.game : compact ? (index % 5 === 0 ? String(index + 1) : <span className="sr-only">{String(index + 1)}</span>) : words.pair(index + 1)}
                            </th>
                        ))}
                        <th scope="col" className="sb-points-head">
                            {words.points}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {([`first`, `second`] as const).map((side) => {
                        const bot = duel[side];
                        const other = duel[side === `first` ? `second` : `first`];
                        return (
                            <tr key={side} className={leader === side ? `sb-lead` : undefined}>
                                <th scope="row" className="sb-name">
                                    <PlayerName name={bot.name} kind="bot" deleted={bot.deleted === true} />
                                    <BotBadge />
                                </th>
                                {pairs.map((pair, index) => (
                                    <td key={pair[0]?.game ?? index} className="sb-cell">
                                        <span className="xt-pair">
                                            {pair.map((game) => (
                                                <GameGlyph key={game.game} game={game} side={side} bot={bot.name} opponent={other.name} linked={!compact} />
                                            ))}
                                        </span>
                                    </td>
                                ))}
                                <td className="sb-points num">{String(duel.score[side])}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
