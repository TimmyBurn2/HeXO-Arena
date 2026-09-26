import { useCallback, useState } from 'react';
import { nameKeyOf, type BotListing } from '@hexarena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { OwnerPanel } from '../components/OwnerPanel';
import { BotBadge, OpenTag, PresenceDot, Rating } from '../components/player';
import { useMe } from '../me';
import { coveredModes, PlayDialog, turnWindowOf } from '../components/PlayDialog';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';
import './BotScreen.css';

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
    if (error && data === null) return <ErrorFrame sentence="The bot did not load" onRetry={reload} />;
    if (data !== null && bot === undefined) return <MissingBot name={name} />;
    if (bot === undefined) return null;

    return <BotProfile bot={bot} />;
}

function MissingBot({ name }: { name: string }) {
    return (
        <div className="empty">
            <h1>No bot named {name}</h1>
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
    const me = useMe();
    const owned = me.status === `ready` && me.me?.kind === `user` && me.me.name === bot.ownerName;
    const accepts = bot.accepts;
    const covered = coveredModes(accepts);
    const anyClock = covered.turn || covered.match || covered.unlimited;
    const playPossible = bot.online && bot.openForChallenges && anyClock;
    const blockedReason = !bot.online
        ? `Offline`
        : !bot.openForChallenges
          ? `Closed for challenges`
          : `Accepts no clock yet`;

    return (
        <>
            {/* The lift sits on a wrapper because the cut clips it. */}
            <div className="bot-lift">
                <header className="bot-plate">
                    <div className="bot-title">
                        <h1>{bot.name}</h1>
                        <BotBadge />
                    </div>
                    <div className="bot-rating">
                        <span className="bot-rating-number">
                            <Rating value={bot.rating} provisional={bot.provisional} />
                        </span>
                        <span className="note">{bot.provisional ? `Provisional rating` : `Rating`}</span>
                    </div>
                    <div className="bot-facts">
                        <span className="player-cell">
                            <PresenceDot online={bot.online} />
                            {bot.online ? `Online` : `Offline`}
                        </span>
                        <OpenTag open={bot.openForChallenges} />
                        <span>By {bot.ownerName ?? `someone`}</span>
                    </div>
                </header>
            </div>

            {bot.about !== undefined ? <p className="about">{bot.about}</p> : null}

            <div className="bot-columns">
                <section className="card" aria-labelledby="accepts-title">
                    <h2 id="accepts-title" className="card-title">
                        Accepts
                    </h2>
                    {bot.accepts === undefined ? (
                        <p className="note">Accepts nothing yet.</p>
                    ) : (
                        <dl className="kv">
                            <dt>Turn clock</dt>
                            <dd>
                                {(() => {
                                    const window = turnWindowOf(bot.accepts);
                                    return window === null
                                        ? `No`
                                        : `${String(window[0] / 1000)} to ${String(window[1] / 1000)} s`;
                                })()}
                            </dd>
                            <dt>Match clock</dt>
                            <dd>{bot.accepts.match ? `Yes` : `No`}</dd>
                            <dt>Unlimited</dt>
                            <dd>{bot.accepts.unlimited ? `Yes` : `No`}</dd>
                        </dl>
                    )}
                </section>
                {bot.version !== undefined || (bot.repoUrl !== undefined && bot.repoUrl !== ``) ? (
                    <section className="card" aria-labelledby="build-title">
                        <h2 id="build-title" className="card-title">
                            Build
                        </h2>
                        <dl className="kv">
                            {bot.version !== undefined ? (
                                <>
                                    <dt>Version</dt>
                                    <dd>{bot.version}</dd>
                                </>
                            ) : null}
                            {bot.repoUrl !== undefined && bot.repoUrl !== `` ? (
                                <>
                                    <dt>Repository</dt>
                                    <dd>
                                        <a href={bot.repoUrl} rel="noreferrer" target="_blank">
                                            {shortRepo(bot.repoUrl)}
                                        </a>
                                    </dd>
                                </>
                            ) : null}
                        </dl>
                    </section>
                ) : null}
            </div>

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
            {owned ? <OwnerPanel bot={bot.name} /> : null}
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
