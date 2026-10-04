import { useCallback, useState } from 'react';
import { fetchDuels } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import { DuelRows } from './DuelRows';
import { duelListPath } from './setup';
import './Duels.css';

// A profile shows this many; the rest are a link away.
const shownOnProfile = 3;

/**
 * The signed-in person's duels and tests, as Bot duels lists them under
 * Yours: those they started and those their bots play, live first, then
 * a link to the rest; nothing at all while there are none.
 */
export function YourDuels() {
    const load = useCallback(async () => fetchDuels({ mine: `1` }), []);
    const duels = useAsync(load).data;
    const [now] = useState(() => Date.now());
    const shown = duels === null ? [] : [...duels.running, ...duels.past].slice(0, shownOnProfile);
    if (shown.length === 0) return null;
    const words = text.profile.duels;
    return (
        <section className="duel-list your-duels" aria-labelledby="your-duels-title">
            <h2 id="your-duels-title" className="section-title">
                {words.title}
            </h2>
            <DuelRows duels={shown} now={now} />
            <p className="your-duels-foot">
                <Link to={duelListPath(`yours`)}>{words.all}</Link>
            </p>
        </section>
    );
}
