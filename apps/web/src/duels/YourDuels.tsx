import { useState } from 'react';
import { SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { text } from '../text';
import { DuelRows } from './DuelRows';
import { gamesDuelsPath } from './setup';
import { useMineDuels, type MineRead } from './use-duels';
import './Duels.css';

// A profile or the side of a setup shows this many; the rest are a link away.
const shown = 3;

/**
 * The signed-in person's duels and tests on their Profile, as Games lists
 * them under Yours: those they started and those their bots play, live
 * first, then a link to the rest; nothing at all while there are none.
 */
export function YourDuels() {
    const mine = useMineDuels(true);
    const [now] = useState(() => Date.now());
    const duels = latest(mine);
    if (duels === null || duels.length === 0) return null;
    const words = text.profile.duels;
    return (
        <section className="duel-list your-duels" aria-labelledby="your-duels-title">
            <h2 id="your-duels-title" className="section-title">
                {words.title}
            </h2>
            <DuelRows duels={duels} now={now} />
            <p className="your-duels-foot">
                <Link to={gamesDuelsPath(`yours`)}>{words.all}</Link>
            </p>
        </section>
    );
}

/**
 * The same beside a duel's setup, where a duel just started is looked
 * for again: the latest few, or a line while there are none yet.
 */
export function YourDuelsBeside({ mine }: { mine: MineRead }) {
    const [now] = useState(() => Date.now());
    const duels = latest(mine);
    const words = text.duels.lists;
    return (
        <section className="duel-list" aria-labelledby="your-duels-title">
            <div className="duel-list-head">
                <h2 id="your-duels-title" className="section-title">
                    {words.yoursTitle}
                </h2>
                <Link to={gamesDuelsPath(`yours`)}>{words.allYours}</Link>
            </div>
            {duels === null ? mine.failed ? <p className="note">{words.failed}</p> : <SkeletonRows /> : duels.length === 0 ? <p className="note">{words.noneYours}</p> : <DuelRows duels={duels} now={now} />}
        </section>
    );
}

function latest(mine: MineRead) {
    return mine.list === null ? null : [...mine.list.running, ...mine.list.past].slice(0, shown);
}
