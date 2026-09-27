import { useCallback, useState } from 'react';
import type { BotListing } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PresenceDot, OpenTag, PlayerName, Rating, summarizeAccepts } from '../components/player';
import { coveredModes, PlayDialog } from '../components/PlayDialog';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import './BotsScreen.css';

export function BotsScreen() {
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [playing, setPlaying] = useState<BotListing | null>(null);
    return (
        <>
            <h1 className="screen-title">Bots</h1>
            <div className="toolbar">
                <span className="note">Every listed bot, online or not</span>
                <label className="checkline">
                    <input
                        type="checkbox"
                        checked={onlineOnly}
                        onChange={(event) => {
                            setOnlineOnly(event.target.checked);
                        }}
                    />
                    Online only
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
    if (error && data === null) return <ErrorFrame sentence="The directory did not load" onRetry={reload} />;
    if (data === null) return null;
    if (data.length === 0 && !onlineOnly) return <NoBotsEmpty />;

    return (
        <>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">Player</th>
                            <th scope="col" className="col-optional">
                                Owner
                            </th>
                            <th scope="col" className="col-narrow-optional">
                                State
                            </th>
                            <th className="num" scope="col">
                                Rating
                            </th>
                            <th scope="col" className="col-optional">
                                Accepts
                            </th>
                            <th scope="col" className="col-optional">
                                Version
                            </th>
                            <th scope="col">
                                <span className="sr-only">Play</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td className="table-note" colSpan={7}>
                                    No bots online right now; the toggle above shows every bot.
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
                    Online
                </span>
                <span className="player-cell">
                    <PresenceDot online={false} />
                    Offline
                </span>
                <span>Open = accepting challenges</span>
                <span>? = provisional rating</span>
            </div>
            {error ? <ErrorFrame sentence="The directory did not load" onRetry={reload} /> : null}
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
            <td className="col-optional">{bot.ownerName ?? ``}</td>
            <td className="col-narrow-optional">
                <OpenTag open={bot.openForChallenges} />
            </td>
            <td className="num rating-cell">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </td>
            <td className="col-optional">{summarizeAccepts(bot.accepts)}</td>
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
            <h2>No bots yet</h2>
            <p>
                The ladder is whatever you bring: register a bot, let it dial in,
                and the first games fill it.
            </p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    Build a bot
                </Link>
            </div>
        </div>
    );
}
