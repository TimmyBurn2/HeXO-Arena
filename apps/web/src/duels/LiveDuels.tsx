import { clockText, type DuelSummary, type LiveGameEntry } from '@hexo-arena/contract';
import { BotBadge } from '../components/player';
import { MiniBoard } from '../live/MiniBoard';
import { Link } from '../router/Link';
import { text } from '../text';
import { DuelRows, Glyphs, glyphPairs } from './DuelRows';
import { duelPagePath } from './setup';
import { estimatePoints, estimateRow, rowState, standingText } from './words';
import './Duels.css';

// Past this many live duels, boards would push the past ones far down, so they list as rows.
const liveBoardsCap = 3;

/**
 * Live duels, each a card linking its page: its live game's board beside
 * where the duel stands, its terms, and its games as cells; past
 * {@link liveBoardsCap}, rows as the past ones list.
 */
export function LiveDuels({ duels, live, now, readAt }: { duels: readonly DuelSummary[]; live: readonly LiveGameEntry[]; now: number; readAt: number }) {
    if (duels.length > liveBoardsCap) return <DuelRows duels={duels} now={now} starter />;
    return (
        <ul className="live-duels">
            {duels.map((duel) => (
                <li key={duel.id}>
                    <LiveDuel duel={duel} entry={live.find((entry) => entry.duel?.id === duel.id)} readAt={readAt} />
                </li>
            ))}
        </ul>
    );
}

// The board stays out of the link's name, which the words beside it already give;
// between two games there is no board, and the words take the card.
function LiveDuel({ duel, entry, readAt }: { duel: DuelSummary; entry: LiveGameEntry | undefined; readAt: number }) {
    const words = text.duels;
    const test = duel.kind === `test`;
    const estimate = estimateRow(duel);
    const glyphs = !test && Math.ceil(duel.terms.games / 2) <= glyphPairs;
    return (
        <Link to={duelPagePath(duel.id)} className={entry === undefined ? `live-duel live-duel-waiting` : `live-duel`}>
            {entry === undefined ? null : (
                <div className="live-duel-board" aria-hidden="true">
                    <MiniBoard game={{ entry, cells: entry.cells, toMove: entry.toMove, readAt }} />
                </div>
            )}
            <div className="live-duel-body">
                <p className="duel-row-who live-duel-who">
                    <span>{duel.first.name}</span>
                    <BotBadge />
                    <span className="duel-row-vs">{words.row.vs}</span>
                    <span>{duel.second.name}</span>
                    <BotBadge />
                    {test ? <span className="tag muted">{words.row.test}</span> : null}
                </p>
                <p className="live-duel-status">
                    <span className="duel-row-live">{rowState(duel)}</span>
                    <span>{test && estimate !== null ? estimate : standingText(duel, duel.results)}</span>
                </p>
                <p className="live-duel-terms">{words.lists.terms(clockText(duel.terms.timeControl), test ? words.page.terms.test : duel.terms.rated ? words.row.rated : words.row.unrated, duel.startedBy)}</p>
                {glyphs ? <Glyphs duel={duel} /> : test && duel.estimate !== undefined ? <p className="duel-figure">{estimatePoints(duel.estimate)}</p> : null}
            </div>
        </Link>
    );
}
