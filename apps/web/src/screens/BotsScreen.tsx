import { useCallback, useState } from 'react';
import type { BotListing } from '@hexarena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PresenceDot, OpenTag, PlayerName, Rating, summarizeAccepts } from '../components/player';
import { coveredModes, PlayDialog } from '../components/PlayDialog';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';

export function BotsScreen() {
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [playing, setPlaying] = useState<BotListing | null>(null);
    return (
        <>
            <h1 className="screen-title">Bots</h1>
            <div className="toolbar">
                <span className="note">every listed bot, online or not</span>
                <label className="checkline">
                    <input
                        type="checkbox"
                        checked={onlineOnly}
                        onChange={(event) => {
                            setOnlineOnly(event.target.checked);
                        }}
                    />
                    online only
                </label>
            </div>
            <Directory key={onlineOnly ? `online` : `all`} onlineOnly={onlineOnly} onPlay={setPlaying} />
            {playing !== null ? (
                <PlayDialog
                    bot={{ name: playing.name, accepts: playing.accepts }}
                    open
                    onClose={() => {
                        setPlaying(null);
                    }}
                />
            ) : null}
        </>
    );
}

function Directory({ onlineOnly, onPlay }: { onlineOnly: boolean; onPlay: (bot: BotListing) => void }) {
    const load = useCallback(async () => fetchBots(onlineOnly), [onlineOnly]);
    const { data, error, loading, reload } = useAsync(load);

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence="the directory did not load" onRetry={reload} />;
    if (data === null) return null;
    if (data.length === 0 && !onlineOnly) return <NoBotsEmpty />;

    return (
        <>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">player</th>
                            <th scope="col">owner</th>
                            <th scope="col">state</th>
                            <th className="num" scope="col">
                                rating
                            </th>
                            <th scope="col">accepts</th>
                            <th scope="col" className="col-optional">
                                version
                            </th>
                            <th scope="col"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td className="table-note" colSpan={7}>
                                    no bots online right now; the toggle above shows every bot
                                </td>
                            </tr>
                        ) : (
                            data.map((bot) => <BotRow bot={bot} key={bot.name} onPlay={onPlay} />)
                        )}
                    </tbody>
                </table>
            </div>
            <div className="legend">
                <span className="player-cell">
                    <PresenceDot online />
                    online
                </span>
                <span className="player-cell">
                    <PresenceDot online={false} />
                    offline
                </span>
                <span>open = accepting challenges</span>
                <span>? = provisional rating</span>
            </div>
            {error ? <ErrorFrame sentence="the directory did not load" onRetry={reload} /> : null}
        </>
    );
}

function BotRow({ bot, onPlay }: { bot: BotListing; onPlay: (bot: BotListing) => void }) {
    const covered = coveredModes(bot.accepts);
    const playable = bot.online && bot.openForChallenges && (covered.turn || covered.match || covered.unlimited);
    return (
        <tr>
            <td>
                <span className="player-cell">
                    <PresenceDot online={bot.online} />
                    <PlayerName name={bot.name} kind="bot" />
                    <BotBadge />
                </span>
            </td>
            <td>{bot.ownerName ?? ``}</td>
            <td>
                <OpenTag open={bot.openForChallenges} />
            </td>
            <td className="num">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </td>
            <td>{summarizeAccepts(bot.accepts)}</td>
            <td className="col-optional">{bot.version ?? ``}</td>
            <td>
                {playable ? (
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                            onPlay(bot);
                        }}
                    >
                        Play
                    </button>
                ) : null}
            </td>
        </tr>
    );
}

function NoBotsEmpty() {
    return (
        <div className="empty">
            <h2>no bots yet</h2>
            <p>
                the ladder is whatever you bring: register a bot, let it dial in,
                and the first games make the board
            </p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    Connect a bot
                </Link>
            </div>
        </div>
    );
}
