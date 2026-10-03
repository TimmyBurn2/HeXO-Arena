import { useCallback, useEffect, useState } from 'react';
import type { BotListing } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PresenceDot, OpenTag, PlayerName, Rating, summarizeAccepts } from '../components/player';
import { useMe } from '../me';
import { playBotPath, readinessOf } from '../play/setup';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { text } from '../text';
import './BotsScreen.css';

export function BotsScreen() {
    const [onlineOnly, setOnlineOnly] = useState(false);
    const [analyzersOnly, setAnalyzersOnly] = useState(false);
    // Day one's empty state leads with Build a bot itself, so the head leaves it out then.
    const [dayOne, setDayOne] = useState(false);
    return (
        <>
            <div className="bots-head">
                <h1 className="screen-title">{text.bots.title}</h1>
                {dayOne ? null : (
                    <Link to="/connect" className="btn btn-ghost">
                        {text.bots.build}
                    </Link>
                )}
            </div>
            <div className="toolbar bots-filters">
                <label className="checkline">
                    <input
                        type="checkbox"
                        checked={onlineOnly}
                        onChange={(event) => {
                            setOnlineOnly(event.target.checked);
                        }}
                    />
                    {text.bots.onlineOnly}
                </label>
                <label className="checkline">
                    <input
                        type="checkbox"
                        checked={analyzersOnly}
                        onChange={(event) => {
                            setAnalyzersOnly(event.target.checked);
                        }}
                    />
                    {text.bots.analyzersOnly}
                </label>
            </div>
            <Directory key={`${String(onlineOnly)}-${String(analyzersOnly)}`} onlineOnly={onlineOnly} analyzersOnly={analyzersOnly} onDayOne={setDayOne} />
        </>
    );
}

function Directory({ onlineOnly, analyzersOnly, onDayOne }: { onlineOnly: boolean; analyzersOnly: boolean; onDayOne: (dayOne: boolean) => void }) {
    const load = useCallback(async () => fetchBots(onlineOnly, analyzersOnly), [onlineOnly, analyzersOnly]);
    const { data, error, limited, loading, reload } = useAsync(load);
    const dayOne = data !== null && data.length === 0 && !onlineOnly && !analyzersOnly;
    useEffect(() => {
        onDayOne(dayOne);
    }, [dayOne, onDayOne]);

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence={text.bots.failed} onRetry={reload} wait={limited} />;
    if (data === null) return null;
    if (dayOne) return <NoBotsEmpty />;

    return (
        <>
            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th scope="col">{text.bots.bot}</th>
                            <th scope="col" className="col-optional">
                                {text.bots.owner}
                            </th>
                            <th scope="col" className="col-narrow-optional">
                                {text.bots.challenges}
                            </th>
                            <th className="num" scope="col">
                                {text.bots.rating}
                            </th>
                            <th scope="col" className="col-optional">
                                {text.bots.accepts}
                            </th>
                            <th scope="col" className="col-optional">
                                {text.bots.version}
                            </th>
                            <th scope="col">
                                <span className="sr-only">{text.bots.playColumn}</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr>
                                <td className="table-note" colSpan={7}>
                                    {analyzersOnly ? (onlineOnly ? text.bots.noAnalyzerOnline : text.bots.noAnalyzer) : text.bots.noneOnline}
                                </td>
                            </tr>
                        ) : (
                            data.map((bot) => <BotRow bot={bot} key={bot.name} />)
                        )}
                    </tbody>
                </table>
            </div>
            <div className="legend">
                <span className="player-cell">
                    <PresenceDot online />
                    {text.bots.online}
                </span>
                <span className="player-cell">
                    <PresenceDot online={false} />
                    {text.bots.offline}
                </span>
                <span>{text.bots.openKey}</span>
                <span>{text.bots.analyzerKey}</span>
                <span>{text.bots.provisionalKey}</span>
            </div>
            {error ? <ErrorFrame sentence={text.bots.failed} onRetry={reload} wait={limited} /> : null}
        </>
    );
}

function BotRow({ bot }: { bot: BotListing }) {
    const me = useMe();
    // An owner plays their own bot while it is online, open to others or not.
    const readiness = readinessOf(bot, undefined, me.status === `ready` && me.me?.kind === `user` ? me.me.name : null);
    return (
        <tr>
            <td>
                <span className="player-cell">
                    <PresenceDot online={bot.online} />
                    <PlayerName name={bot.name} kind="bot" />
                    <BotBadge />
                    {bot.analyzer === null ? null : <span className="tag tag-analyzer">{text.bots.analyzerTag}</span>}
                </span>
            </td>
            <td className="col-optional">{bot.ownerName === null ? null : <PlayerName name={bot.ownerName} kind="human" />}</td>
            <td className="col-narrow-optional">
                <OpenTag open={bot.openForChallenges} />
            </td>
            <td className="num rating-cell">
                <Rating value={bot.rating} provisional={bot.provisional} />
            </td>
            <td className="col-optional">{summarizeAccepts(bot.accepts)}</td>
            <td className="col-optional">{bot.version ?? ``}</td>
            <td>
                {readiness === `ready` ? (
                    <Link to={playBotPath(bot.name)} className="btn btn-primary btn-sm" ariaLabel={text.bots.playBot(bot.name)}>
                        {text.bots.play}
                    </Link>
                ) : readiness === `busy` ? (
                    <span className="note">{text.bots.busy}</span>
                ) : null}
            </td>
        </tr>
    );
}

function NoBotsEmpty() {
    return (
        <div className="empty">
            <h2>{text.bots.empty.heading}</h2>
            <p>{text.bots.empty.body}</p>
            <div className="actions">
                <Link to="/connect" className="btn btn-primary">
                    {text.bots.empty.build}
                </Link>
            </div>
        </div>
    );
}
