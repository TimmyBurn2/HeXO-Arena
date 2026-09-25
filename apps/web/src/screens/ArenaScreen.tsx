import { useCallback, useState } from 'react';
import { fetchLeaderboard, type LeaderboardKind } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName, Rating } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';

const kinds: readonly { value: LeaderboardKind; label: string }[] = [
    { value: `all`, label: `All` },
    { value: `bots`, label: `Bots` },
    { value: `humans`, label: `Humans` },
];

export function ArenaScreen() {
    const [kind, setKind] = useState<LeaderboardKind>(`all`);
    return (
        <>
            <h1 className="screen-title">Arena</h1>
            <div className="toolbar">
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

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence="the board did not load" onRetry={reload} />;
    if (data === null) return null;
    if (data.length === 0) return <DayOneEmpty />;

    return (
        <>
            <Podium entries={data.slice(0, 3)} />
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th className="num" scope="col">
                                #
                            </th>
                            <th scope="col">player</th>
                            <th className="num" scope="col">
                                rating
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((entry) => (
                            <tr key={entry.name}>
                                <td className="num">{String(entry.rank)}</td>
                                <td>
                                    <span className="player-cell">
                                        <PlayerName name={entry.name} kind={entry.kind} />
                                        {entry.kind === `bot` ? <BotBadge /> : null}
                                    </span>
                                </td>
                                <td className="num">
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

function Podium({ entries }: { entries: readonly { rank: number; name: string; kind: `bot` | `human`; rating: number }[] }) {
    if (entries.length === 0) return null;
    const byRank = new Map(entries.map((entry) => [entry.rank, entry]));
    const order = entries.length === 3 ? [2, 1, 3] : entries.map((entry) => entry.rank);
    return (
        <section aria-label="Podium, top three of the filtered board">
            <div className="podium">
                {order.map((rank) => {
                    const entry = byRank.get(rank);
                    if (entry === undefined) return null;
                    return (
                        <div key={rank} className={`podium-step p${String(rank)}`}>
                            <div className="rank">#{String(rank)}</div>
                            <div className="name">
                                <PlayerName name={entry.name} kind={entry.kind} />
                                {entry.kind === `bot` ? <BotBadge /> : null}
                            </div>
                            <div className="rating">{String(entry.rating)}</div>
                        </div>
                    );
                })}
            </div>
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
