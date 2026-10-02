import { useCallback, useId, useState } from 'react';
import { fetchFinishedGames } from '../api/client';
import { useAsync } from '../api/use-async';
import { SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { text } from '../text';
import { gamesPathOf } from './filters';
import { GameRows } from './GameRows';

/** How many games a page lists of a player's history before it leads to the rest. */
const shownRows = 5;

/**
 * A player's latest finished games on a page about them: a few rows, then
 * the way to all of them in Games, counted; the heading stands while they
 * load, so the page below does not move when they land.
 */
export function PlayerHistory({ player, title }: { player: string; title: string }) {
    const load = useCallback(async () => fetchFinishedGames({ player }), [player]);
    const { data, error, reload } = useAsync(load);
    const [now] = useState(() => Date.now());
    const titleId = useId();
    return (
        <section className="player-history" aria-labelledby={titleId}>
            <h2 id={titleId} className="section-title">
                {title}
            </h2>
            {data === null && !error ? (
                <SkeletonRows />
            ) : data === null ? (
                <p className="history-failed">
                    <span className="note">{text.games.failed}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>
                        {text.states.tryAgain}
                    </button>
                </p>
            ) : data.games.length === 0 ? (
                <p className="note">{text.games.none}</p>
            ) : (
                <>
                    <GameRows games={data.games.slice(0, shownRows)} now={now} />
                    <p className="history-all">
                        <Link to={gamesPathOf(player)}>{text.games.all(data.record?.games ?? data.games.length)}</Link>
                    </p>
                </>
            )}
        </section>
    );
}
