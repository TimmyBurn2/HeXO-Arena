import type { LeaderboardEntry } from '@hexo-arena/contract';
import { text } from '../text';
import { BotBadge, PlayerName } from './player';
import './Rungs.css';

/**
 * The top of a ladder as rungs: a view of its first rows, never separate
 * data, stepping inward as rank falls.
 * A bot's rung names its owner where the owner is known.
 */
export function Rungs({ entries }: { entries: readonly LeaderboardEntry[] }) {
    return (
        <section className="rungs" aria-label={text.ladder.top}>
            {entries.map((entry, index) => {
                const owner = entry.kind === `bot` ? entry.ownerName : null;
                // The tier follows position, not rank, so ties never double
                // or drop the top rung.
                const rung = (
                    <div className={`rung r${String(index + 1)}`}>
                        <span className="rung-rank">{String(entry.rank)}</span>
                        <span className="rung-name">
                            <PlayerName name={entry.name} kind={entry.kind} />
                            {entry.kind === `bot` ? <BotBadge /> : null}
                            {entry.kind === `human` ? (
                                <span className="rung-kind">{text.ladder.human}</span>
                            ) : owner === null ? null : (
                                <span className="rung-owner">{text.ladder.by(owner)}</span>
                            )}
                        </span>
                        <span className="rung-rating">{String(entry.rating)}</span>
                    </div>
                );
                // The top rung lifts; the lift sits on a wrapper because the
                // cut would clip it.
                return index === 0 ? (
                    <div className="rung-lift" key={entry.name}>
                        {rung}
                    </div>
                ) : (
                    <div key={entry.name}>{rung}</div>
                );
            })}
        </section>
    );
}
