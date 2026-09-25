import { useCallback, useState } from 'react';
import { nameKeyOf, type BotListing } from '@hexarena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, OpenTag, PresenceDot, provisionalNote } from '../components/player';
import { coveredModes, PlayDialog, turnWindowOf } from '../components/PlayDialog';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';

export function BotScreen({ name }: { name: string }) {
    const route = useRoute();
    const load = useCallback(async () => fetchBots(false), []);
    const { data, error, loading, reload } = useAsync(load);
    const bot = data?.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name));

    useDocumentMeta(
        route,
        bot === undefined ? undefined : `${bot.name} (${String(bot.rating)}) - hexarena`,
        bot === undefined
            ? undefined
            : `bot by ${bot.ownerName ?? `someone`}, ${bot.online ? `online` : `offline`}, ${bot.openForChallenges ? `accepting challenges` : `closed for challenges`}`,
    );

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence="the bot did not load" onRetry={reload} />;
    if (data !== null && bot === undefined) return <MissingBot name={name} />;
    if (bot === undefined) return null;

    return <BotProfile bot={bot} />;
}

function MissingBot({ name }: { name: string }) {
    return (
        <div className="empty">
            <h1>no bot named {name}</h1>
            <div className="actions">
                <Link to="/bots" className="btn btn-ghost">
                    Browse bots
                </Link>
            </div>
        </div>
    );
}

function BotProfile({ bot }: { bot: BotListing }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const accepts = bot.accepts;
    const covered = coveredModes(accepts);
    const anyClock = covered.turn || covered.match || covered.unlimited;
    const playPossible = bot.online && bot.openForChallenges && anyClock;
    const blockedReason = !bot.online
        ? `offline`
        : !bot.openForChallenges
          ? `closed for challenges`
          : `accepts no clock yet`;

    return (
        <>
            <div className="bot-head">
                <h1>{bot.name}</h1>
                <BotBadge />
                <span className="player-cell">
                    <PresenceDot online={bot.online} />
                    <OpenTag open={bot.openForChallenges} />
                </span>
            </div>
            <div className="bot-meta">
                <span>
                    rating <span className="num">{String(bot.rating)}</span>
                    {bot.provisional ? (
                        <span className="prov" title={provisionalNote}>
                            ?
                        </span>
                    ) : null}
                </span>
                <span>owner: {bot.ownerName ?? `someone`}</span>
            </div>

            {bot.about !== undefined ? <p className="about">{bot.about}</p> : null}
            <dl className="kv">
                {bot.version !== undefined ? (
                    <>
                        <dt>version</dt>
                        <dd>{bot.version}</dd>
                    </>
                ) : null}
                {bot.repoUrl !== undefined && bot.repoUrl !== `` ? (
                    <>
                        <dt>repo</dt>
                        <dd>
                            <a href={bot.repoUrl} rel="noreferrer" target="_blank">
                                {shortRepo(bot.repoUrl)}
                            </a>
                        </dd>
                    </>
                ) : null}
            </dl>

            <h2 className="section-title">Accepts</h2>
            {bot.accepts === undefined ? (
                <p className="note">accepts nothing yet</p>
            ) : (
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th scope="col">clock</th>
                                <th scope="col">window</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>turn</td>
                                <td className="num">
                                    {(() => {
                                        const window = turnWindowOf(bot.accepts);
                                        return window === null
                                            ? `no`
                                            : `${String(window[0] / 1000)} - ${String(window[1] / 1000)} s`;
                                    })()}
                                </td>
                            </tr>
                            <tr>
                                <td>match</td>
                                <td className="num">{bot.accepts.match ? `yes` : `no`}</td>
                            </tr>
                            <tr>
                                <td>unlimited</td>
                                <td className="num">{bot.accepts.unlimited ? `yes` : `no`}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            )}

            <p className="play-row">
                <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!playPossible}
                    onClick={() => {
                        setDialogOpen(true);
                    }}
                >
                    Play {bot.name}
                </button>
                {playPossible ? null : <span className="note play-reason">{blockedReason}</span>}
            </p>
            {playPossible && accepts !== undefined ? (
                <PlayDialog
                    bot={{ name: bot.name, accepts }}
                    open={dialogOpen}
                    onClose={() => {
                        setDialogOpen(false);
                    }}
                />
            ) : null}
        </>
    );
}

function shortRepo(url: string): string {
    return url.replace(/^https?:\/\//, ``);
}
