import { useCallback, useEffect, useState } from 'react';
import type { PlayerRecord, RatingPoint, RatingRange } from '@hexo-arena/contract';
import { fetchPlayerRecord, fetchRatingHistory } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName } from '../components/player';
import { gamesPathOf } from '../games/filters';
import { Link } from '../router/Link';
import { text } from '../text';
import { RatingChart } from './RatingChart';
import './PlayerBlocks.css';

function dateOf(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium` }).format(new Date(iso));
}

function useRatingHistory(name: string): { points: RatingPoint[] | `failed` | null; range: RatingRange; setRange: (range: RatingRange) => void; retry: () => void } {
    const [range, setRange] = useState<RatingRange>(`1y`);
    const [points, setPoints] = useState<RatingPoint[] | `failed` | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setPoints(null);
        fetchRatingHistory(name, range).then(
            (history) => {
                if (!cancelled) setPoints(history);
            },
            () => {
                if (!cancelled) setPoints(`failed`);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [name, range, attempt]);
    const retry = useCallback(() => {
        setAttempt((count) => count + 1);
    }, []);
    return { points, range, setRange, retry };
}

/**
 * What a page about a player shows of their play: the rating chart, the
 * record, and the opponents met most; each block stands while it loads
 * and leaves out what it cannot read. A bot page lists its tournaments
 * beside its duels.
 */
export function PlayerBlocks({ name }: { name: string }) {
    const history = useRatingHistory(name);
    const load = useCallback(async () => fetchPlayerRecord(name), [name]);
    const record = useAsync(load);
    return (
        <div className="player-blocks">
            <RatingChart points={history.points} range={history.range} onRange={history.setRange} onRetry={history.retry} />
            {record.data === null && record.error ? (
                <p className="player-failed">
                    <span className="note">{text.players.record.failed}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={record.reload}>
                        {text.states.tryAgain}
                    </button>
                </p>
            ) : record.data === null ? null : (
                <div className="player-columns">
                    <Record record={record.data} />
                    <MostPlayed record={record.data} />
                </div>
            )}
        </div>
    );
}

function Record({ record }: { record: PlayerRecord }) {
    const words = text.players.record;
    return (
        <section className="card player-record" aria-labelledby="player-record-title">
            <h2 id="player-record-title" className="card-title">
                {words.title}
            </h2>
            {record.games === 0 && (record.guests?.games ?? 0) === 0 ? <p className="note">{words.empty}</p> : <Figures record={record} />}
        </section>
    );
}

function Figures({ record }: { record: PlayerRecord }) {
    const words = text.players.record;
    return (
        <>
            <ul className="player-figures">
                {[
                    [record.games, words.games],
                    [record.won, words.won],
                    [record.lost, words.lost],
                    [record.undecided, words.none],
                ].map(([figure, label]) => (
                    <li key={String(label)}>
                        <span className="player-figure">{String(figure)}</span>
                        <span className="player-figure-label">{label}</span>
                    </li>
                ))}
            </ul>
            <dl className="kv">
                <dt>{words.asX}</dt>
                <dd>{words.side(record.asX.games, record.asX.won)}</dd>
                <dt>{words.asO}</dt>
                <dd>{words.side(record.asO.games, record.asO.won)}</dd>
                <dt>{words.forfeits}</dt>
                <dd>{words.forfeitLine(record.forfeits.disconnect, record.forfeits.terminated)}</dd>
                {record.firstGameAt === null || record.lastGameAt === null ? null : (
                    <>
                        <dt>{words.played}</dt>
                        <dd>{words.span(dateOf(record.firstGameAt), dateOf(record.lastGameAt))}</dd>
                    </>
                )}
                {record.guests === undefined || record.guests.games === 0 ? null : (
                    <>
                        <dt>{words.guests}</dt>
                        <dd>{words.guestLine(record.guests.games, record.guests.won, record.guests.lost)}</dd>
                    </>
                )}
                {record.rank === null ? null : (
                    <>
                        <dt>{words.ladder}</dt>
                        <dd>
                            <Link to="/ladder">{words.rank(record.rank)}</Link>
                        </dd>
                    </>
                )}
            </dl>
            <p className="note">{words.aborted}</p>
        </>
    );
}

function MostPlayed({ record }: { record: PlayerRecord }) {
    const words = text.players.mostPlayed;
    return (
        <section className="card player-opponents" aria-labelledby="player-opponents-title">
            <h2 id="player-opponents-title" className="card-title">
                {words.title}
            </h2>
            {record.opponents.length === 0 ? (
                <p className="note">{words.none}</p>
            ) : (
                <ul className="player-opponent-list">
                    {/* Two deleted opponents share a label, so the place in the list keys each. */}
                    {record.opponents.map((opponent, index) => (
                        <li key={`${String(index)} ${opponent.kind} ${opponent.name}`}>
                            <span className="player-cell">
                                <PlayerName name={opponent.name} kind={opponent.kind} deleted={opponent.deleted} />
                                {opponent.kind === `bot` ? <BotBadge /> : null}
                            </span>
                            {opponent.deleted === true ? (
                                <span className="player-meetings">{words.meetings(opponent.games, opponent.won, opponent.lost)}</span>
                            ) : (
                                <Link to={gamesPathOf(record.name, opponent.name)} className="player-meetings">
                                    {words.meetings(opponent.games, opponent.won, opponent.lost)}
                                </Link>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
