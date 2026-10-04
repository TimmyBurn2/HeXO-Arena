import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { clockText, nameKeyOf, playTournamentMeta, tournamentMinPresent, tournamentWaitingPollMs, type TournamentDetail, type TournamentList, type TournamentSummary } from '@hexo-arena/contract';
import { fetchTournament, fetchTournaments } from '../api/client';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { useSetupReads } from '../duels/use-duels';
import { useMe } from '../me';
import { PlayHead } from '../play/PlayHead';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { siteStatusStore } from '../site-status';
import { text } from '../text';
import { EntryControl } from '../tournaments/EntryControl';
import { NewRoundRobin } from '../tournaments/NewRoundRobin';
import { joinReason, roundRobinSetupFromParams } from '../tournaments/round-robin';
import { TournamentRow } from '../tournaments/TournamentRow';
import { gamesTournamentsPath, tournamentPagePath } from '../tournaments/view';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import '../games/Events.css';
import './DuelsScreen.css';
import './TournamentScreen.css';

type Weekly = { kind: `loading` } | { kind: `failed` } | { kind: `ready`; next: TournamentDetail | null; at: number };

// The next weekly in full, which its entry control and the setup's hints read,
// read again on a waiting tournament's beat while the page is in view.
function useWeekly(): { weekly: Weekly; reload: () => void } {
    const [weekly, setWeekly] = useState<Weekly>({ kind: `loading` });
    const load = useCallback(async () => {
        try {
            const list = await fetchTournaments();
            const first = list.scheduled[0];
            setWeekly({ kind: `ready`, next: first === undefined ? null : await fetchTournament(first.id), at: Date.now() });
        } catch {
            setWeekly((held) => (held.kind === `ready` ? held : { kind: `failed` }));
        }
    }, []);
    useEffect(() => {
        void load();
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void load();
        }, tournamentWaitingPollMs);
        return () => {
            clearInterval(timer);
        };
    }, [load]);
    return { weekly, reload: () => void load() };
}

// The reader's own round robins and their quota, read again with the setup's reads.
function useMine(signedIn: boolean): { mine: TournamentList | null; failed: boolean; reload: () => void } {
    const [mine, setMine] = useState<TournamentList | null>(null);
    const [failed, setFailed] = useState(false);
    const load = useCallback(async () => {
        if (!signedIn) return;
        try {
            setMine(await fetchTournaments({ mine: `1` }));
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [signedIn]);
    useEffect(() => {
        void load();
    }, [load]);
    return { mine, failed, reload: () => void load() };
}

/**
 * The Tournament place under Play: a round robin of picked bots set up
 * here, beside the weekly tournament with its entry in place and the
 * reader's own round robins, where one just set up is found again.
 */
export function PlayTournamentScreen() {
    const route = useRoute();
    useDocumentMeta(route, playTournamentMeta.title, playTournamentMeta.description);
    const [initial] = useState(() => roundRobinSetupFromParams(new URLSearchParams(window.location.search)));
    const me = useMe();
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read) === `paused`;
    const self = me.status === `ready` ? me.me : undefined;
    const viewer = self?.kind === `user` ? self.name : null;
    const setup = useSetupReads();
    const { weekly, reload } = useWeekly();
    const mine = useMine(viewer !== null);
    const reads = { reserved: setup.reserved, states: setup.states, viewer };
    const ready = setup.bots?.filter((bot) => joinReason(bot, [], reads) === null) ?? [];
    const next = weekly.kind === `ready` ? weekly.next : null;
    const at = weekly.kind === `ready` ? weekly.at : 0;
    // A bot entered in the coming weekly leaves a round robin as the weekly starts, which its plate says.
    const weeklyHint = (bot: string): string | null => {
        if (next === null || !next.entries.some((entry) => nameKeyOf(entry.bot) === nameKeyOf(bot))) return null;
        return text.roundRobins.weekly(text.time.until(Math.max(0, Math.floor((Date.parse(next.startsAt) - at) / 1000))));
    };

    return (
        <>
            <PlayHead view="tournament" />
            <div className="duels-layout">
                <div className="duels-main">
                    {setup.bots === null || self === undefined ? (
                        setup.failed ? (
                            <ErrorFrame sentence={text.duels.picker.listFailed} onRetry={setup.reload} wait={setup.limited} />
                        ) : (
                            <SkeletonRows />
                        )
                    ) : viewer !== null && ready.length < tournamentMinPresent && initial.bots.length === 0 ? (
                        <div className="empty">
                            <h2>{text.roundRobins.noneReady.heading}</h2>
                            <p>{text.roundRobins.noneReady.body(ready.length)}</p>
                            <div className="actions">
                                <Link to="/bots" className="btn btn-primary">
                                    {text.duels.noneReady.browse}
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <NewRoundRobin
                            bots={setup.bots}
                            reads={reads}
                            me={self}
                            quota={mine.mine?.quota ?? null}
                            paused={paused}
                            initial={initial}
                            weekly={weeklyHint}
                            onRefused={() => {
                                setup.reload();
                                mine.reload();
                            }}
                        />
                    )}
                </div>
                <aside className="duels-side">
                    <WeeklyBlock weekly={weekly} onEntry={reload} />
                    <YourRoundRobins list={mine.mine} failed={mine.failed} signedIn={viewer !== null} signedOut={me.status === `ready` && viewer === null} />
                </aside>
            </div>
        </>
    );
}

function WeeklyBlock({ weekly, onEntry }: { weekly: Weekly; onEntry: () => void }) {
    const words = text.roundRobins.side;
    return (
        <section className="duel-list weekly-block" aria-labelledby="weekly-title">
            <div className="duel-list-head">
                <h2 id="weekly-title" className="section-title">
                    {words.weekly}
                </h2>
                <Link to="/games/tournaments">{text.home.allTournaments}</Link>
            </div>
            {weekly.kind === `loading` ? <SkeletonRows /> : null}
            {weekly.kind === `failed` ? <p className="note">{text.tournaments.failed}</p> : null}
            {weekly.kind === `ready` ? weekly.next === null ? <p className="note">{words.noWeekly}</p> : <Next detail={weekly.next} at={weekly.at} onEntry={onEntry} /> : null}
        </section>
    );
}

function Next({ detail, at, onEntry }: { detail: TournamentDetail; at: number; onEntry: () => void }) {
    const words = text.roundRobins.side;
    const wait = Math.floor((Date.parse(detail.startsAt) - at) / 1000);
    const clock = clockText(detail.timeControl);
    return (
        <div className="next-tournament">
            <p className="tournament-tag-row next-tournament-name">
                <Link to={tournamentPagePath(detail.id)}>{detail.name}</Link>
                <span className="tag">{text.roundRobins.tags.rated}</span>
            </p>
            <p className="note">{wait > 0 ? words.when(text.time.until(wait), detail.entries.length, detail.maxEntrants, clock) : words.whenSoon(detail.entries.length, detail.maxEntrants, clock)}</p>
            <EntryControl detail={detail} onChange={onEntry} level={3} />
        </div>
    );
}

// The round robins the reader set up or their bots play, the live first, then the latest over.
function YourRoundRobins({ list, failed, signedIn, signedOut }: { list: TournamentList | null; failed: boolean; signedIn: boolean; signedOut: boolean }) {
    const words = text.roundRobins.side;
    const mine: TournamentSummary[] = list === null ? [] : [...list.running, ...list.past].filter((tournament) => tournament.origin === `person`).slice(0, 5);
    return (
        <section className="duel-list" aria-labelledby="your-round-robins-title">
            <div className="duel-list-head">
                <h2 id="your-round-robins-title" className="section-title">
                    {words.yours}
                </h2>
                <Link to={gamesTournamentsPath(`yours`)}>{words.allYours}</Link>
            </div>
            {signedOut ? (
                <p className="note">{words.signIn}</p>
            ) : !signedIn || list === null ? (
                failed ? <p className="note">{words.failed}</p> : <SkeletonRows />
            ) : mine.length === 0 ? (
                <p className="note">{words.noneYours}</p>
            ) : (
                <ul className="duel-rows">
                    {mine.map((tournament) => (
                        <li key={tournament.id}>
                            <TournamentRow tournament={tournament} compact />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
