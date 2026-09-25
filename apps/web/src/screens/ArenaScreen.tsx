import { useCallback, useState } from 'react';
import type { BotListing, LeaderboardEntry } from '@hexarena/contract';
import { fetchBots, fetchLeaderboard, type LeaderboardKind } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName, Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import './ArenaScreen.css';

const kinds: readonly { value: LeaderboardKind; label: string }[] = [
    { value: `all`, label: `All` },
    { value: `bots`, label: `Bots` },
    { value: `humans`, label: `Humans` },
];

export function ArenaScreen() {
    const [kind, setKind] = useState<LeaderboardKind>(`all`);
    return (
        <>
            <div className="arena-head">
                <h1 className="screen-title">Arena</h1>
                <div className="pills" role="group" aria-label="Kind filter">
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
            <Board key={kind} kind={kind} />
        </>
    );
}

function Board({ kind }: { kind: LeaderboardKind }) {
    const load = useCallback(async () => fetchLeaderboard(kind), [kind]);
    const { data, error, loading, reload } = useAsync(load);
    const loadBots = useCallback(async () => fetchBots(false), []);
    const roster = useAsync(loadBots).data;

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence="the board did not load" onRetry={reload} />;
    if (data === null) return null;
    if (data.length === 0) return <DayOneEmpty />;

    const owners = new Map((roster ?? []).map((bot) => [bot.name, bot.ownerName]));
    return (
        <>
            <Pulse ranked={data.length} kind={kind} roster={roster} />
            <Rungs entries={data.slice(0, 3)} owners={owners} />
            <h2 className="section-title">Full ladder</h2>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th className="num rank-col" scope="col">
                                Rank
                            </th>
                            <th scope="col">Player</th>
                            <th className="num" scope="col">
                                Rating
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((entry) => (
                            <tr key={entry.name}>
                                <td className="num rank-col">{String(entry.rank)}</td>
                                <td>
                                    <span className="player-cell">
                                        <PlayerName name={entry.name} kind={entry.kind} />
                                        {entry.kind === `bot` ? <BotBadge /> : null}
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
            <p className="note">
                rankable players only; provisional ratings leave the board until
                their deviation settles
            </p>
            {error ? <ErrorFrame sentence="the board did not load" onRetry={reload} /> : null}
        </>
    );
}

/**
 * One sentence of live counts; the roster half drops out quietly when the
 * directory did not load, since the board stands on its own.
 */
function Pulse({ ranked, kind, roster }: { ranked: number; kind: LeaderboardKind; roster: BotListing[] | null }) {
    const noun = kind === `bots` ? `bots` : kind === `humans` ? `humans` : `players`;
    const online = roster?.filter((bot) => bot.online).length;
    const open = roster?.filter((bot) => bot.online && bot.openForChallenges).length;
    return (
        <p className="pulse">
            <strong>{String(ranked)}</strong> ranked {ranked === 1 ? noun.replace(/s$/, ``) : noun}
            {online === undefined || open === undefined ? null : (
                <>
                    , <span className="dot" aria-hidden="true" />
                    <strong>{String(online)}</strong> bots online,{` `}
                    <strong>{String(open)}</strong> taking challenges
                </>
            )}
        </p>
    );
}

/**
 * The top of the filtered board as ladder rungs: a view of the table's
 * first rows, never separate data, stepping inward as rank falls.
 */
function Rungs({ entries, owners }: { entries: readonly LeaderboardEntry[]; owners: ReadonlyMap<string, string | null> }) {
    return (
        <section className="rungs" aria-label="Top of the ladder">
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
                                <span className="rung-kind">human</span>
                            ) : owner === null ? null : (
                                <span className="rung-owner">by {owner}</span>
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

function DayOneEmpty() {
    return (
        <div className="empty">
            <h2>no ranked players yet</h2>
            <p>
                the ladder is whatever you bring: register a bot, let it dial in,
                and the first games make the board
            </p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    Connect a bot
                </Link>
                <Link to="/bots" className="btn btn-ghost">
                    Browse bots
                </Link>
            </div>
        </div>
    );
}
