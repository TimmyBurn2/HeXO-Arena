import { Fragment, useCallback } from 'react';
import { botMeta, nameKeyOf, notFoundMeta, type BotListing, type LiveGameEntry } from '@hexo-arena/contract';
import { fetchBots } from '../api/client';
import { useAsync } from '../api/use-async';
import { OwnerPanel } from '../components/OwnerPanel';
import { LiveGameGrid } from '../live/LiveGameCard';
import { useLiveReplay } from '../live/use-live-replay';
import { BotBadge, OpenTag, PresenceDot, Rating } from '../components/player';
import { useMe } from '../me';
import { turnWindowOf } from '../play/accepts';
import { playBotPath, readinessOf } from '../play/setup';
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
    const { data, error, limited, loading, reload } = useAsync(load);
    const bot = data?.find((entry) => nameKeyOf(entry.name) === nameKeyOf(name));

    // A bot the list does not hold reads as any missing page, as the
    // server's preview of it does.
    const meta = bot !== undefined ? botMeta(bot) : data !== null ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);

    if (loading && data === null) return <SkeletonRows />;
    if (error && data === null) {
        return (
            <>
                <h1 className="screen-title">{name}</h1>
                <ErrorFrame sentence={text.bot.failed} onRetry={reload} wait={limited} />
            </>
        );
    }
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
    const me = useMe();
    const owned = me.status === `ready` && me.me?.kind === `user` && me.me.name === bot.ownerName;
    const readiness = readinessOf(bot);
    const blockedReasons = {
        busy: text.play.busy,
        offline: text.bot.offlineReason,
        closed: text.bot.closedReason,
        nothing: text.bot.noClockReason,
    };

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
                {readiness === `ready` ? (
                    <Link to={playBotPath(bot.name)} className="btn btn-primary">
                        {text.bot.play(bot.name)}
                    </Link>
                ) : (
                    <>
                        <button type="button" className="btn btn-primary" disabled>
                            {text.bot.play(bot.name)}
                        </button>
                        <span className="note play-reason">{blockedReasons[readiness]}</span>
                    </>
                )}
            </p>
            <PlayingNow bot={bot.name} />
            {owned ? <OwnerPanel bot={bot.name} /> : null}
        </>
    );
}

// Bot names are unique across users and bots, so a bot seat with the name
// is this bot.
function playing(entry: LiveGameEntry, bot: string): boolean {
    return [entry.players.x, entry.players.o].some((player) => player.kind === `bot` && player.name === bot);
}

// Every game the bot plays right now, as boards, from the list the live
// pages read.
function PlayingNow({ bot }: { bot: string }) {
    const games = (useLiveReplay().games ?? []).filter((game) => playing(game.entry, bot));
    if (games.length === 0) return null;
    return (
        <section className="bot-live" aria-labelledby="playing-title">
            <h2 id="playing-title" className="section-title">
                {text.bot.playingNow}
            </h2>
            <LiveGameGrid games={games} level={3} />
        </section>
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
