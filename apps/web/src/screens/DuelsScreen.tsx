import { useState, useSyncExternalStore } from 'react';
import { duelsMeta, type DuelSummary } from '@hexo-arena/contract';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { DuelRows } from '../duels/DuelRows';
import { NewDuel } from '../duels/NewDuel';
import { pickReason, setupFromParams, type DuelSetup } from '../duels/setup';
import { useDuelLists, useSetupReads, type DuelFilter } from '../duels/use-duels';
import { useMe } from '../me';
import { PlayHead } from '../play/PlayHead';
import { playBotPath } from '../play/setup';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { siteStatusStore } from '../site-status';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import './DuelsScreen.css';

// The recent list shows this many until the reader asks for the rest.
const recentShown = 5;

function readParams(): { setup: DuelSetup; bot: string | null } {
    const params = new URLSearchParams(window.location.search);
    return { setup: setupFromParams(params), bot: params.get(`bot`) };
}

/**
 * Bot duels: a new duel's setup beside the duels live now and those just
 * over, filtered to every one, the reader's own, or tests; a link may set
 * the setup up, as a duel's Duel again does, or narrow the lists to one
 * bot's duels.
 */
export function DuelsScreen() {
    const route = useRoute();
    useDocumentMeta(route, duelsMeta.title, duelsMeta.description);
    const [params] = useState(readParams);
    const [filter, setFilter] = useState<DuelFilter>(`all`);
    const [more, setMore] = useState(false);
    const [now] = useState(() => Date.now());
    const me = useMe();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read) === `paused`;
    const self = me.status === `ready` ? me.me : undefined;
    const viewer = self?.kind === `user` ? self.name : null;
    const setup = useSetupReads();
    const lists = useDuelLists(filter, params.bot, viewer !== null);
    const running = lists.all?.running ?? null;
    const reads = { reserved: setup.reserved, states: setup.states, viewer };
    const ready = setup.bots?.filter((bot) => pickReason(bot, null, reads) === null) ?? [];
    const recent = lists.recent?.past ?? [];

    return (
        <>
            {/* Lists narrowed to one bot leave the place's count of every live duel to the head's own read. */}
            <PlayHead view="duels" {...(params.bot === null ? { live: running?.length ?? null } : {})} />
            <div className="duels-layout">
                <div className="duels-main">
                    {setup.bots === null || self === undefined ? (
                        setup.failed ? (
                            <ErrorFrame sentence={text.duels.picker.listFailed} onRetry={setup.reload} wait={setup.limited} />
                        ) : (
                            <SkeletonRows />
                        )
                    ) : ready.length < 2 ? (
                        <div className="empty">
                            <h2>{text.duels.noneReady.heading}</h2>
                            <p>{text.duels.noneReady.body(ready.length)}</p>
                            <div className="actions">
                                {ready[0] === undefined ? null : (
                                    <Link to={playBotPath(ready[0].name)} className="btn btn-primary">
                                        {text.duels.noneReady.play(ready[0].name)}
                                    </Link>
                                )}
                                <Link to="/bots" className={ready[0] === undefined ? `btn btn-primary` : `btn btn-ghost`}>
                                    {text.duels.noneReady.browse}
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <NewDuel bots={setup.bots} reads={reads} me={self} quota={lists.quota} paused={paused} initial={params.setup} onRefused={setup.reload} />
                    )}
                </div>
                <aside className="duels-side">
                    {params.bot === null ? null : (
                        <p className="duels-for">
                            <span>{text.duels.lists.forBot(params.bot)}</span>
                            <Link to="/play/duels">{text.duels.lists.everyBot}</Link>
                        </p>
                    )}
                    <section className="duel-list" aria-labelledby="live-duels">
                        <h2 id="live-duels" className="section-title">
                            {text.duels.lists.live}
                        </h2>
                        {running === null ? lists.failed ? <p className="note">{text.duels.lists.failed}</p> : <SkeletonRows /> : running.length === 0 ? <p className="note">{text.duels.lists.noLive}</p> : <DuelRows duels={running} now={now} />}
                    </section>
                    <section className="duel-list" aria-labelledby="recent-duels">
                        <div className="duel-list-head">
                            <h2 id="recent-duels" className="section-title">
                                {text.duels.lists.recent}
                            </h2>
                            <div className="pills" role="group" aria-label={text.duels.lists.filters}>
                                {([`all`, `yours`, `tests`] as const).map((each) => (
                                    <button
                                        key={each}
                                        type="button"
                                        className={filter === each ? `pill active` : `pill`}
                                        aria-pressed={filter === each}
                                        onClick={() => {
                                            setFilter(each);
                                            setMore(false);
                                        }}
                                    >
                                        {text.duels.lists[each]}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <RecentList filter={filter} signedIn={viewer !== null} duels={lists.recent === null ? null : recent} more={more} now={now} onMore={() => { setMore(true); }} />
                    </section>
                </aside>
            </div>
        </>
    );
}

function RecentList({ filter, signedIn, duels, more, now, onMore }: { filter: DuelFilter; signedIn: boolean; duels: readonly DuelSummary[] | null; more: boolean; now: number; onMore: () => void }) {
    if (filter === `yours` && !signedIn) return <p className="note">{text.duels.lists.signIn}</p>;
    if (duels === null) return <SkeletonRows />;
    if (duels.length === 0) return <p className="note">{text.duels.lists.none[filter]}</p>;
    const shown = more ? duels : duels.slice(0, recentShown);
    return (
        <>
            <DuelRows duels={shown} now={now} />
            {shown.length < duels.length ? (
                <button type="button" className="text-button duels-more" onClick={onMore}>
                    {text.duels.lists.showMore(duels.length - shown.length)}
                </button>
            ) : null}
        </>
    );
}
