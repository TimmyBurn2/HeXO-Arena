import { useCallback, useEffect, useState } from 'react';
import { duelListMeta, duelRunningPollMs, type DuelSummary, type LiveGameEntry } from '@hexo-arena/contract';
import { fetchLiveGames } from '../api/client';
import { SkeletonRows } from '../components/states';
import { DuelRows } from '../duels/DuelRows';
import { LiveDuels } from '../duels/LiveDuels';
import { duelListViews, gamesDuelsPath } from '../duels/setup';
import { useBeat, useDuelLists, type DuelFilter } from '../duels/use-duels';
import { GamesHead } from '../games/GamesHead';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useRoute, useSearch } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import '../games/Events.css';
import './DuelsScreen.css';

// The past list shows this many until the reader asks for the rest.
const pastShown = 10;

const filters = [`all`, ...duelListViews] as const satisfies readonly DuelFilter[];

/** The view and the bot an address names; a view it does not know is every duel. */
function listOf(search: string): { filter: DuelFilter; bot: string | null } {
    const params = new URLSearchParams(search);
    return { filter: duelListViews.find((view) => view === params.get(`list`)) ?? `all`, bot: params.get(`bot`) };
}

// Live duels draw their live games, which the live list holds with tests among them.
function useLiveGames(): { games: readonly LiveGameEntry[]; at: number } {
    const [read, setRead] = useState<{ games: readonly LiveGameEntry[]; at: number }>({ games: [], at: Date.now() });
    const load = useCallback(async () => {
        try {
            setRead({ games: await fetchLiveGames(true), at: Date.now() });
        } catch {
            // The cards stand without their boards until a read lands.
        }
    }, []);
    useEffect(() => {
        void load();
    }, [load]);
    useBeat(load, duelRunningPollMs);
    return read;
}

/**
 * The duels under Games: what a duel is and where one starts, then those
 * live, each drawn with its live game, and those over, filtered to every
 * one, the reader's own, or tests, and for one bot when a link names it.
 * The filter lives in the address, so a link opens the list on it.
 */
export function GamesDuelsScreen() {
    const route = useRoute();
    useDocumentMeta(route, duelListMeta.title, duelListMeta.description);
    const { filter, bot } = listOf(useSearch());
    const [more, setMore] = useState(false);
    const [now] = useState(() => Date.now());
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const lists = useDuelLists(filter, bot, viewer !== null);
    const live = useLiveGames();
    const words = text.duels.lists;
    const shown = lists.recent;
    const signIn = filter === `yours` && viewer === null && me.status === `ready`;

    return (
        <>
            <GamesHead view="duels" />
            <div className="events-lead">
                <p className="note">{words.lead}</p>
                <Link to="/play/duels" className="btn btn-ghost">
                    {words.start}
                </Link>
            </div>
            {bot === null ? null : (
                <p className="duels-for">
                    <span>{words.forBot(bot)}</span>
                    <Link to={gamesDuelsPath(filter === `all` ? null : filter)}>{words.everyBot}</Link>
                </p>
            )}
            <div className="pills" role="group" aria-label={words.filters}>
                {filters.map((each) => (
                    <button
                        key={each}
                        type="button"
                        className={filter === each ? `pill active` : `pill`}
                        aria-pressed={filter === each}
                        onClick={() => {
                            setMore(false);
                            navigate(gamesDuelsPath(each === `all` ? null : each, bot), { replace: true });
                        }}
                    >
                        {words[each]}
                    </button>
                ))}
            </div>
            {signIn ? (
                <p className="note events-sign-in">{words.signIn}</p>
            ) : (
                <>
                    <section className="events-section" aria-labelledby="live-duels">
                        <h2 id="live-duels" className="section-title">
                            {words.live}
                        </h2>
                        {shown === null ? (
                            lists.failed ? <p className="note">{words.failed}</p> : <SkeletonRows />
                        ) : shown.running.length === 0 ? (
                            <p className="note">{words.noLive}</p>
                        ) : (
                            <LiveDuels duels={shown.running} live={live.games} now={now} readAt={live.at} />
                        )}
                    </section>
                    <section className="events-section" aria-labelledby="past-duels">
                        <h2 id="past-duels" className="section-title">
                            {words.past}
                        </h2>
                        <PastList
                            filter={filter}
                            duels={shown === null ? null : shown.past}
                            more={more}
                            now={now}
                            onMore={() => {
                                setMore(true);
                            }}
                        />
                    </section>
                </>
            )}
        </>
    );
}

function PastList({ filter, duels, more, now, onMore }: { filter: DuelFilter; duels: readonly DuelSummary[] | null; more: boolean; now: number; onMore: () => void }) {
    if (duels === null) return <SkeletonRows />;
    if (duels.length === 0) return <p className="note">{text.duels.lists.none[filter]}</p>;
    const shown = more ? duels : duels.slice(0, pastShown);
    return (
        <>
            <DuelRows duels={shown} now={now} starter />
            {shown.length < duels.length ? (
                <button type="button" className="text-button duels-more" onClick={onMore}>
                    {text.duels.lists.showMore(duels.length - shown.length)}
                </button>
            ) : null}
        </>
    );
}
