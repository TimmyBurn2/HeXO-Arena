import type { DuelResult, DuelSummary } from '@hexo-arena/contract';
import { BotBadge } from '../components/player';
import { Link } from '../router/Link';
import { text } from '../text';
import { duelPagePath } from './setup';
import { GameGlyph, pairsOf } from './Scoreboard';
import { estimatePoints, estimateRow, noWinnerCount, rowState, scoreText } from './words';
import './Duels.css';

/** A list row draws each game while the pairs fit a glance; past it, the score alone. */
export const glyphPairs = 5;

/**
 * Duels as rows, each one link to its page: the two bots, where it stands,
 * rated or a test, and the games as cells, or a test's points and estimate.
 */
export function DuelRows({ duels, now, starter = false }: { duels: readonly DuelSummary[]; now: number; starter?: boolean }) {
    return (
        <ul className="duel-rows">
            {duels.map((duel) => (
                <li key={duel.id}>
                    <DuelRow duel={duel} now={now} starter={starter} />
                </li>
            ))}
        </ul>
    );
}

function DuelRow({ duel, now, starter }: { duel: DuelSummary; now: number; starter: boolean }) {
    const words = text.duels.row;
    const test = duel.kind === `test`;
    const estimate = estimateRow(duel);
    const running = duel.status === `running`;
    const glyphs = !test && Math.ceil(duel.terms.games / 2) <= glyphPairs;
    // A test's figure counts a game without a winner as halves, which the row says.
    const drawn = test ? noWinnerCount(duel.results) : 0;
    return (
        <Link to={duelPagePath(duel.id)} className="duel-row">
            <span className="duel-row-who">
                <span>{duel.first.name}</span>
                <BotBadge />
                <span className="duel-row-vs">{words.vs}</span>
                <span>{duel.second.name}</span>
                <BotBadge />
                {test ? <span className="tag muted">{words.test}</span> : null}
            </span>
            <span className="duel-row-facts">
                {test && estimate !== null ? <span>{estimate}</span> : <span className={running ? `duel-row-live` : undefined}>{rowState(duel)}</span>}
                {test && estimate !== null && running ? <span className="duel-row-live">{rowState(duel)}</span> : null}
                {drawn === 0 ? null : <span>{text.duels.noWinnerFact(drawn)}</span>}
                {test ? null : <span>{duel.terms.rated ? words.rated : words.unrated}</span>}
                {starter ? <span>{words.startedBy(duel.startedBy)}</span> : null}
                {duel.endedAt === null ? null : <span>{text.time.ago(Math.max(0, Math.floor((now - Date.parse(duel.endedAt)) / 1000)))}</span>}
            </span>
            {glyphs ? (
                <Glyphs duel={duel} />
            ) : (
                <span className="duel-figure">{test && duel.estimate !== undefined ? estimatePoints(duel.estimate) : scoreText(duel)}</span>
            )}
        </Link>
    );
}

/** A duel's games as cells, a row per bot with its points, inside the one link of a row or a card. */
export function Glyphs({ duel }: { duel: DuelSummary }) {
    const pairs = pairsOf(duel.results.map(asGame));
    const label = text.duels.row.glyphs(duel.first.name, duel.second.name, scoreText(duel));
    return (
        <span className="duel-glyphs" role="img" aria-label={label}>
            {([`first`, `second`] as const).map((side) => (
                <span key={side} className="glyph-line">
                    <span className="glyph-pairs" aria-hidden="true">
                        {pairs.map((pair) => (
                            <span key={pair[0]?.game} className="xt-pair">
                                {pair.map((game) => (
                                    <GameGlyph key={game.game} game={{ ...game, gameId: null }} side={side} bot={duel[side].name} opponent={duel[side === `first` ? `second` : `first`].name} />
                                ))}
                            </span>
                        ))}
                    </span>
                    <span className="glyph-score" aria-hidden="true">
                        {String(duel.score[side])}
                    </span>
                </span>
            ))}
        </span>
    );
}

function asGame(result: DuelResult) {
    return { ...result, reason: null, turns: null, opening: null };
}
