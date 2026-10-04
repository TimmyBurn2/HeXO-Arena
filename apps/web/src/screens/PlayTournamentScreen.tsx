import { useCallback, useEffect, useState } from 'react';
import { clockText, playTournamentMeta, tournamentWaitingPollMs, type TournamentDetail, type TournamentList, type TournamentSummary } from '@hexo-arena/contract';
import { fetchTournament, fetchTournaments } from '../api/client';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { useMe } from '../me';
import { PlayHead } from '../play/PlayHead';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { EntryControl } from '../tournaments/EntryControl';
import { tournamentPagePath } from '../tournaments/view';
import { yoursText } from '../tournaments/words';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import '../games/Events.css';
import './TournamentScreen.css';

type Read = { kind: `loading` } | { kind: `failed`; wait: number | null } | { kind: `ready`; list: TournamentList; next: TournamentDetail | null; at: number };

// The list and the next tournament in full, which its entry control reads,
// read again on a waiting tournament's beat while the page is in view.
function useNext(): { read: Read; reload: () => void } {
    const [read, setRead] = useState<Read>({ kind: `loading` });
    const load = useCallback(async () => {
        try {
            const list = await fetchTournaments();
            const first = list.scheduled[0];
            const next = first === undefined ? null : await fetchTournament(first.id);
            setRead({ kind: `ready`, list, next, at: Date.now() });
        } catch {
            setRead((held) => (held.kind === `ready` ? held : { kind: `failed`, wait: null }));
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
    return { read, reload: () => void load() };
}

/**
 * The Tournament place under Play: an owner enters a bot in the next
 * tournament here, beside the tournaments their bots entered.
 */
export function PlayTournamentScreen() {
    const route = useRoute();
    useDocumentMeta(route, playTournamentMeta.title, playTournamentMeta.description);
    const { read, reload } = useNext();
    const me = useMe();
    const signedIn = me.status === `ready` && me.me?.kind === `user`;
    return (
        <>
            <PlayHead view="tournament" />
            <div className="events-columns">
                <div className="events-main">
                    {read.kind === `loading` ? <SkeletonRows /> : null}
                    {read.kind === `failed` ? <ErrorFrame sentence={text.tournaments.failed} onRetry={reload} wait={read.wait} /> : null}
                    {read.kind === `ready` ? read.next === null ? <NoneComing /> : <Next detail={read.next} at={read.at} onEntry={reload} /> : null}
                </div>
                <aside className="events-side">
                    <Yours list={read.kind === `ready` ? read.list : null} failed={read.kind === `failed`} signedIn={signedIn} signedOut={me.status === `ready` && !signedIn} />
                </aside>
            </div>
        </>
    );
}

function NoneComing() {
    const words = text.tournaments.play.none;
    return (
        <div className="empty">
            <h2>{words.heading}</h2>
            <p>{words.body}</p>
            <div className="actions">
                <Link to="/games/tournaments" className="btn btn-ghost">
                    {text.home.allTournaments}
                </Link>
            </div>
        </div>
    );
}

function Next({ detail, at, onEntry }: { detail: TournamentDetail; at: number; onEntry: () => void }) {
    const words = text.tournaments.play;
    const wait = Math.floor((Date.parse(detail.startsAt) - at) / 1000);
    return (
        <section className="next-tournament" aria-labelledby="next-tournament-title">
            <p className="next-tournament-kicker">{words.next}</p>
            <h2 id="next-tournament-title" className="next-tournament-name">
                <Link to={tournamentPagePath(detail.id)}>{detail.name}</Link>
            </h2>
            <p>{wait > 0 ? words.startsIn(text.time.until(wait), detail.entries.length, detail.maxEntrants) : words.startsSoon(detail.entries.length, detail.maxEntrants)}</p>
            <p className="note">
                {text.tournaments.rules(detail.entries.length, clockText(detail.timeControl), detail.openingPlies)} {text.tournaments.pairing(detail.openingPlies)}
            </p>
            <EntryControl detail={detail} onChange={onEntry} level={3} />
        </section>
    );
}

// The tournaments the reader's bots entered, as far as the list reaches: the live one, those coming up, and the latest past.
function Yours({ list, failed, signedIn, signedOut }: { list: TournamentList | null; failed: boolean; signedIn: boolean; signedOut: boolean }) {
    const words = text.tournaments.play;
    const mine = list === null ? [] : [...(list.running === null ? [] : [list.running]), ...list.scheduled, ...list.past].filter((tournament) => tournament.yours !== undefined);
    return (
        <section className="duel-list" aria-labelledby="your-tournaments-title">
            <div className="duel-list-head">
                <h2 id="your-tournaments-title" className="section-title">
                    {words.yours}
                </h2>
                <Link to="/games/tournaments">{text.home.allTournaments}</Link>
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
                            <YourRow tournament={tournament} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function day(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium` }).format(new Date(iso));
}

function YourRow({ tournament }: { tournament: TournamentSummary }) {
    return (
        <Link to={tournamentPagePath(tournament.id)} className="duel-row place-row">
            <span className="duel-row-who">{tournament.name}</span>
            <span className="duel-row-facts">
                {tournament.yours === undefined ? null : <span className={tournament.status === `running` ? `duel-row-live` : undefined}>{yoursText(tournament, tournament.yours)}</span>}
                {tournament.round === null ? null : <span>{text.tournaments.roundOf(tournament.round.current, tournament.round.of)}</span>}
                <span>{day(tournament.endedAt ?? tournament.startsAt)}</span>
            </span>
        </Link>
    );
}
