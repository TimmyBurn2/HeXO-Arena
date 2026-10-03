import { useCallback, useState } from 'react';
import type { DuelSummary } from '@hexo-arena/contract';
import { fetchDuels } from '../api/client';
import { useAsync } from '../api/use-async';
import { Link } from '../router/Link';
import { text } from '../text';
import { DuelRows } from './DuelRows';
import './Duels.css';

// A bot page shows this many of each kind; the rest are a link away.
const shownOnPage = 3;

/**
 * A bot's duels and tests, live first, then the latest over, each kind
 * beside the other; a kind with none leaves its block out.
 */
export function BotDuels({ bot, owner }: { bot: string; owner: string | null }) {
    const loadDuels = useCallback(async () => fetchDuels({ bot, kind: `duel` }), [bot]);
    const loadTests = useCallback(async () => fetchDuels({ bot, kind: `test` }), [bot]);
    const duels = useAsync(loadDuels).data;
    const tests = useAsync(loadTests).data;
    const [now] = useState(() => Date.now());
    const latest = (list: { running: DuelSummary[]; past: DuelSummary[] } | null) => (list === null ? [] : [...list.running, ...list.past].slice(0, shownOnPage));
    const shownDuels = latest(duels);
    const shownTests = latest(tests);
    if (shownDuels.length === 0 && shownTests.length === 0) return null;
    const words = text.duels.bot;
    const all = `/play/duels?${new URLSearchParams({ bot }).toString()}`;
    return (
        <div className="bot-duels">
            {shownDuels.length === 0 ? null : (
                <section className="duel-list" aria-labelledby="bot-duels-title">
                    <div className="duel-list-head">
                        <h2 id="bot-duels-title" className="section-title">
                            {words.duels}
                        </h2>
                        <Link to={all}>{words.allDuels}</Link>
                    </div>
                    <DuelRows duels={shownDuels} now={now} starter />
                </section>
            )}
            {shownTests.length === 0 ? null : (
                <section className="duel-list" aria-labelledby="bot-tests-title">
                    <div className="duel-list-head">
                        <h2 id="bot-tests-title" className="section-title">
                            {words.tests}
                        </h2>
                        <Link to={all}>{words.allTests}</Link>
                    </div>
                    <DuelRows duels={shownTests} now={now} />
                    {owner === null ? null : <p className="note">{words.testsNote(owner)}</p>}
                </section>
            )}
        </div>
    );
}
