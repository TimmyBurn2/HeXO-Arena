import { useCallback, useMemo } from 'react';
import type { TournamentList, TournamentSummary } from '@hexo-arena/contract';
import { fetchBots, fetchTournaments } from '../api/client';
import { useAsync } from '../api/use-async';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { GamesHead } from '../games/GamesHead';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useSearch } from '../router/use-route';
import { text } from '../text';
import { TournamentRow } from '../tournaments/TournamentRow';
import { gamesTournamentsPath, tournamentListViews, type TournamentListView } from '../tournaments/view';
import '../games/Events.css';
import './TournamentScreen.css';

type Filter = `all` | TournamentListView;

const filters = [`all`, ...tournamentListViews] as const satisfies readonly Filter[];

/** The view an address names; one it does not know is every tournament. */
function filterOf(search: string): Filter {
    return tournamentListViews.find((view) => view === new URLSearchParams(search).get(`list`)) ?? `all`;
}

// Every tournament leaves tests to their own view; the reader's own and the tests come from the list narrowed for them.
// Narrowed to one bot, the list is that bot's, the reader's own then those they set up.
function readFor(filter: Filter, bot: string | null, viewer: string | null): () => Promise<TournamentList> {
    const forBot = bot === null ? {} : { bot };
    if (filter === `tests`) return async () => fetchTournaments({ ...forBot, kind: `test` });
    return async () => {
        const list = await fetchTournaments(filter === `yours` && bot === null ? { mine: `1` } : forBot);
        const kept = (tournament: TournamentSummary) => (filter === `yours` ? bot === null || tournament.createdBy === viewer : !tournament.test);
        const shown = (tournaments: readonly TournamentSummary[]) => tournaments.filter(kept);
        return { ...list, running: shown(list.running), scheduled: filter === `yours` && bot !== null ? [] : list.scheduled, past: shown(list.past) };
    };
}

/**
 * The tournaments under Games: every live one, the weekly first, those
 * coming up, and the latest past ones, each tagged and naming the
 * reader's own bot's part; every one but tests, the reader's own, or
 * tests alone, the view kept in the address. An owner who has not
 * entered one coming up is offered its entry.
 */
export function TournamentsScreen() {
    const search = useSearch();
    const filter = filterOf(search);
    const bot = new URLSearchParams(search).get(`bot`);
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const load = useMemo(() => readFor(filter, bot, viewer), [filter, bot, viewer]);
    const { data, error, limited, reload } = useAsync(load);
    const loadRoster = useCallback(async () => (viewer === null ? [] : fetchBots(false)), [viewer]);
    const roster = useAsync(loadRoster);
    const owner = viewer !== null && (roster.data ?? []).some((bot) => bot.ownerName === viewer);
    const words = text.roundRobins.lists;
    const signIn = filter === `yours` && me.status === `ready` && viewer === null;
    return (
        <>
            <GamesHead view="tournaments" />
            <div className="events-lead">
                <p className="note">{words.lead}</p>
                <Link to="/play/tournament" className="btn btn-ghost">
                    {words.setUp}
                </Link>
            </div>
            {bot === null ? null : (
                <p className="events-for">
                    <span>{words.forBot(bot)}</span>
                    <Link to={gamesTournamentsPath(filter === `all` ? null : filter)}>{words.everyBot}</Link>
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
                            navigate(gamesTournamentsPath(each === `all` ? null : each, bot), { replace: true });
                        }}
                    >
                        {words[each]}
                    </button>
                ))}
            </div>
            {signIn ? (
                <p className="note events-sign-in">{words.signIn}</p>
            ) : data === null ? (
                error ? (
                    <ErrorFrame sentence={text.tournaments.failed} onRetry={reload} wait={limited} />
                ) : (
                    <SkeletonRows />
                )
            ) : (
                <>
                    <Listed title={text.tournaments.running} id="running" tournaments={data.running} owner={owner} none={words.noLive} />
                    {data.scheduled.length === 0 ? null : <Listed title={text.tournaments.waiting} id="waiting" tournaments={data.scheduled} owner={owner} none={null} />}
                    <Listed title={text.tournaments.past} id="past" tournaments={data.past} owner={owner} none={words.noPast[filter]} />
                    {filter === `all` ? <p className="note">{words.testsNote}</p> : null}
                </>
            )}
        </>
    );
}

function Listed({ title, id, tournaments, owner, none }: { title: string; id: string; tournaments: readonly TournamentSummary[]; owner: boolean; none: string | null }) {
    return (
        <section className="tournament-block events-section" aria-labelledby={`tournaments-${id}`}>
            <h2 id={`tournaments-${id}`} className="section-title">
                {title}
            </h2>
            {tournaments.length === 0 ? (
                <p className="note">{none}</p>
            ) : (
                <ul className="tournament-list">
                    {tournaments.map((tournament) => (
                        <li key={tournament.id}>
                            <TournamentRow tournament={tournament} owner={owner} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
