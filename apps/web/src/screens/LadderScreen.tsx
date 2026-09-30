import { useCallback, useEffect, useState } from 'react';
import type { BotListing, LeaderboardEntry } from '@hexo-arena/contract';
import { fetchBots, fetchLeaderboard, type LeaderboardKind } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName, Rating } from '../components/player';
import { LiveRail } from '../components/LiveRail';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { text } from '../text';
import './LadderScreen.css';

const kinds: readonly { value: LeaderboardKind; label: string }[] = [
    { value: `all`, label: text.ladder.kinds.all },
    { value: `bots`, label: text.ladder.kinds.bots },
    { value: `humans`, label: text.ladder.kinds.humans },
];

export function LadderScreen() {
    const [kind, setKind] = useState<LeaderboardKind>(`all`);
    // Unknown until the ladder answers, so day one never flashes the rail's
    // quiet line under the skeleton.
    const [ladderEmpty, setLadderEmpty] = useState<boolean | null>(null);
    return (
        <>
            <div className="ladder-head">
                <h1 className="screen-title">{text.ladder.title}</h1>
                <div className="pills" role="group" aria-label={text.ladder.kindFilter}>
                    {kinds.map((entry) => (
                        <button
                            key={entry.value}
                            type="button"
                            className={`pill${kind === entry.value ? ` active` : ``}`}
                            aria-pressed={kind === entry.value}
                            onClick={() => {
                                setKind(entry.value);
                            }}
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>
            </div>
            <Standings key={kind} kind={kind} onRows={setLadderEmpty} />
            {/* The live list is its own data, so the rail stays mounted
                through a filter switch, a ladder reload, and a ladder error.
                Day one leads with its empty state, whose copy is the way
                forward; the rail follows it only while a game is live. */}
            {ladderEmpty === null ? null : <LiveRail onlyWhenLive={ladderEmpty} />}
        </>
    );
}

function Standings({ kind, onRows }: { kind: LeaderboardKind; onRows: (empty: boolean) => void }) {
    const load = useCallback(async () => fetchLeaderboard(kind), [kind]);
    const { data, error, limited, loading, reload } = useAsync(load);
    const me = useMe();
    const loadBots = useCallback(async () => fetchBots(false), []);
    const roster = useAsync(loadBots).data;

    // A ladder that failed to load is not day one, so the rail still shows.
    useEffect(() => {
        if (data !== null) onRows(data.length === 0);
        else if (error) onRows(false);
    }, [data, error, onRows]);

    if (loading && data === null) return <LadderSkeleton />;
    if (error && data === null) return <ErrorFrame sentence={text.ladder.failed} onRetry={reload} wait={limited} />;
    if (data === null) return null;
    if (data.length === 0) return <DayOneEmpty />;

    const owners = new Map((roster ?? []).map((bot) => [bot.name, bot.ownerName]));
    const self = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    return (
        <>
            <Pulse ranked={data.length} kind={kind} roster={roster} />
            <Rungs entries={data.slice(0, 3)} owners={owners} />
            <h2 className="section-title">{text.ladder.full}</h2>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th className="num rank-col" scope="col">
                                {text.ladder.rank}
                            </th>
                            <th scope="col">{text.ladder.player}</th>
                            <th className="num" scope="col">
                                {text.ladder.rating}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((entry) => (
                            <tr key={entry.name} className={entry.name === self ? `you` : undefined}>
                                <td className="num rank-col">{String(entry.rank)}</td>
                                <td>
                                    <span className="player-cell">
                                        <PlayerName name={entry.name} kind={entry.kind} />
                                        {entry.kind === `bot` ? <BotBadge /> : null}
                                        {entry.name === self ? <span className="you-tag">{text.ladder.you}</span> : null}
                                    </span>
                                </td>
                                <td className="num rating-cell">
                                    <Rating value={entry.rating} provisional={false} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="note">{text.ladder.note}</p>
            {error ? <ErrorFrame sentence={text.ladder.failed} onRetry={reload} wait={limited} /> : null}
        </>
    );
}

/**
 * One sentence of live counts; the roster half drops out quietly when the
 * directory did not load, since the ladder stands on its own.
 */
function Pulse({ ranked, kind, roster }: { ranked: number; kind: LeaderboardKind; roster: BotListing[] | null }) {
    const online = roster?.filter((bot) => bot.online).length;
    const open = roster?.filter((bot) => bot.online && bot.openForChallenges).length;
    return (
        <p className="pulse">
            {text.ladder.pulse(
                ranked,
                kind,
                online === undefined || open === undefined ? null : { online, open },
                strong,
                <span className="dot" aria-hidden="true" />,
            )}
        </p>
    );
}

function strong(words: string) {
    return <strong>{words}</strong>;
}

/**
 * The top of the filtered ladder as rungs: a view of the table's
 * first rows, never separate data, stepping inward as rank falls.
 */
function Rungs({ entries, owners }: { entries: readonly LeaderboardEntry[]; owners: ReadonlyMap<string, string | null> }) {
    return (
        <section className="rungs" aria-label={text.ladder.top}>
            {entries.map((entry, index) => {
                const owner = owners.get(entry.name) ?? null;
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

// The ladder's own shape while it loads, so nothing jumps when rows land.
function LadderSkeleton() {
    return (
        <div className="ladder-skeleton" aria-hidden="true">
            <div className="rungs">
                <div className="rung-skeleton r1" />
                <div className="rung-skeleton r2" />
                <div className="rung-skeleton r3" />
            </div>
            <SkeletonRows />
        </div>
    );
}

function DayOneEmpty() {
    return (
        <div className="empty">
            <h2>{text.ladder.empty.heading}</h2>
            <p>{text.ladder.empty.body}</p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    {text.ladder.empty.build}
                </Link>
                <Link to="/bots" className="btn btn-ghost">
                    {text.ladder.empty.browse}
                </Link>
            </div>
        </div>
    );
}
