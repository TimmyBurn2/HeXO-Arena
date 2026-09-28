import { Fragment, useCallback, useState } from 'react';
import { botMeta, nameKeyOf, notFoundMeta, type BotListing, type LiveGameEntry } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { useLiveGames } from '../api/use-live-games';
import { OwnerPanel } from '../components/OwnerPanel';
import { BotBadge, OpenTag, PresenceDot, Rating } from '../components/player';
import { useMe } from '../me';
import { coveredModes, PlayDialog, turnWindowOf } from '../components/PlayDialog';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { botApiRepository } from '../site-links';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import './BotScreen.css';

export function BotScreen({ name }: { name: string }) {
    const route = useRoute();
    const load = useCallback(async () => fetchBots(false), []);
    const { data, error, loading, reload } = useAsync(load);
    const bot = data?.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name));

    // A bot the list does not hold reads as any missing page, as the
    // server's preview of it does.
    const meta = bot !== undefined ? botMeta(bot) : data !== null ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) return <ErrorFrame sentence={text.bot.failed} onRetry={reload} />;
    if (data !== null && bot === undefined) return <MissingBot name={name} />;
    if (bot === undefined) return null;

    return <BotProfile bot={bot} />;
}

function MissingBot({ name }: { name: string }) {
    return (
        <div className="empty">
            <h1>{text.bot.missing(name)}</h1>
            <div className="actions">
                <Link to="/bots" className="btn btn-ghost">
                    {text.bot.browse}
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
        ? text.bot.offlineReason
        : !bot.openForChallenges
          ? text.bot.closedReason
          : text.bot.noClockReason;

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
                        <span className="note">{bot.provisional ? text.bot.provisionalRating : text.bot.rating}</span>
                    </div>
                    <div className="bot-facts">
                        <span className="player-cell">
                            <PresenceDot online={bot.online} />
                            {bot.online ? text.bot.online : text.bot.offline}
                        </span>
                        <OpenTag open={bot.openForChallenges} />
                        {bot.ownerName === null ? null : <span>{text.bot.by(bot.ownerName)}</span>}
                    </div>
                </header>
            </div>

            <LiveLinks bot={bot.name} />

            {bot.about !== undefined ? <p className="about">{bot.about}</p> : null}

            <div className="bot-columns">
                <section className="card" aria-labelledby="accepts-title">
                    <h2 id="accepts-title" className="card-title">
                        {text.bot.accepts}
                    </h2>
                    {bot.accepts === undefined ? (
                        <p className="note">
                            {owned
                                ? text.bot.acceptsNothingOwner((words) => (
                                      <a href={botApiRepository} rel="noreferrer" target="_blank">
                                          {words}
                                      </a>
                                  ))
                                : text.bot.acceptsNothing}
                        </p>
                    ) : (
                        <dl className="kv">
                            <dt>{text.bot.turnClock}</dt>
                            <dd>
                                {(() => {
                                    const window = turnWindowOf(bot.accepts);
                                    return window === null ? text.bot.no : text.bot.turnWindow(window[0] / 1000, window[1] / 1000);
                                })()}
                            </dd>
                            <dt>{text.bot.matchClock}</dt>
                            <dd>{bot.accepts.match ? text.bot.yes : text.bot.no}</dd>
                            <dt>{text.bot.unlimited}</dt>
                            <dd>{bot.accepts.unlimited ? text.bot.yes : text.bot.no}</dd>
                        </dl>
                    )}
                </section>
                {bot.version !== undefined || (bot.repoUrl !== undefined && bot.repoUrl !== ``) ? (
                    <section className="card" aria-labelledby="build-title">
                        <h2 id="build-title" className="card-title">
                            {text.bot.source}
                        </h2>
                        <dl className="kv">
                            {bot.version !== undefined ? (
                                <>
                                    <dt>{text.bot.version}</dt>
                                    <dd>{bot.version}</dd>
                                </>
                            ) : null}
                            {bot.repoUrl !== undefined && bot.repoUrl !== `` ? (
                                <>
                                    <dt>{text.bot.repository}</dt>
                                    <dd>
                                        <a href={bot.repoUrl} rel="noreferrer" target="_blank">
                                            <ShortRepo url={bot.repoUrl} />
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
                    {text.bot.play(bot.name)}
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

// Bot names are unique across users and bots, so a bot seat with the name
// is this bot.
function playing(entry: LiveGameEntry, bot: string): boolean {
    return [entry.players.x, entry.players.o].some((player) => player.kind === `bot` && player.name === bot);
}

// Every game the bot plays right now, from the same list the ladder rail
// reads, so the page needs no read of its own.
function LiveLinks({ bot }: { bot: string }) {
    const games = (useLiveGames().data ?? []).filter((entry) => playing(entry, bot));
    if (games.length === 0) return null;
    return (
        <p className="bot-live">
            <span className="dot" aria-hidden="true" />
            <span>{text.bot.playingNow}</span>
            {games.map((entry) => {
                const opponent = entry.players.x.name === bot ? entry.players.o : entry.players.x;
                return (
                    <Link key={entry.gameId} to={`/game/${encodeURIComponent(entry.gameId)}`} className="btn btn-ghost btn-sm">
                        {text.bot.watchVs(opponent.name)}
                    </Link>
                );
            })}
        </p>
    );
}

// A narrow card breaks the path after a slash, never inside a name.
function ShortRepo({ url }: { url: string }) {
    return url
        .replace(/^https?:\/\//, ``)
        .split(`/`)
        .map((part, index) => (
            <Fragment key={`${String(index)}-${part}`}>
                {index > 0 ? (
                    <>
                        /<wbr />
                    </>
                ) : null}
                {part}
            </Fragment>
        ));
}
