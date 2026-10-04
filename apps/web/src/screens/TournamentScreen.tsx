import { useCallback, useEffect, useState } from 'react';
import { clockText, deletedPlayerName, notFoundMeta, tournamentMeta, tournamentMinPresent, tournamentRunningPollMs, tournamentWaitingPollMs, type TournamentDetail, type TournamentSummary } from '@hexo-arena/contract';
import { ApiError, fetchTournament, limitedFor } from '../api/client';
import { BotBadge, PlayerName, PresenceDot } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { PodiumStand } from '../ladder/Podium';
import { LiveGameGrid } from '../live/LiveGameCard';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { Crosstable } from '../tournaments/Crosstable';
import { EntryControl } from '../tournaments/EntryControl';
import { Estimates, NextRound, PairsTable, RoundRobinActions, RoundRobinStatus, RoundRobinTerms, Waits } from '../tournaments/RoundRobinParts';
import { RoundSteps } from '../tournaments/RoundSteps';
import { TournamentTag } from '../tournaments/TournamentRow';
import { Rounds } from '../tournaments/Rounds';
import { Standings } from '../tournaments/Standings';
import { absentees, currentRound, roundBegun } from '../tournaments/view';
import { useDocumentMeta } from '../use-document-meta';
import './DuelScreen.css';
import './TournamentScreen.css';

type Load = { kind: `loading` } | { kind: `ready`; detail: TournamentDetail; at: number } | { kind: `missing` } | { kind: `failed`; limited: number | null };

// A running tournament is read again every few seconds while its page is in
// view, a waiting one every minute, and one that is over never.
function useTournament(id: string): { load: Load; retry: () => void } {
    const [load, setLoad] = useState<Load>({ kind: `loading` });
    const [attempt, setAttempt] = useState(0);
    const status = load.kind === `ready` ? load.detail.status : null;
    useEffect(() => {
        let cancelled = false;
        const read = async () => {
            try {
                const detail = await fetchTournament(id);
                if (!cancelled) setLoad({ kind: `ready`, detail, at: Date.now() });
            } catch (cause) {
                if (cancelled) return;
                if (cause instanceof ApiError && cause.status === 404) setLoad({ kind: `missing` });
                else setLoad((held) => (held.kind === `ready` ? held : { kind: `failed`, limited: limitedFor(cause) }));
            }
        };
        if (status === null) void read();
        const every = status === `running` ? tournamentRunningPollMs : status === `scheduled` ? tournamentWaitingPollMs : null;
        if (every === null) {
            return () => {
                cancelled = true;
            };
        }
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void read();
        }, every);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [id, status, attempt]);
    const retry = useCallback(() => {
        setLoad({ kind: `loading` });
        setAttempt((count) => count + 1);
    }, []);
    return { load, retry };
}

function summaryOf(detail: TournamentDetail): TournamentSummary {
    const top = detail.standings[0];
    return {
        id: detail.id,
        name: detail.name,
        origin: detail.origin,
        createdBy: detail.createdBy,
        rated: detail.rated,
        test: detail.test,
        gamesPerPair: detail.gamesPerPair,
        status: detail.status,
        startsAt: detail.startsAt,
        timeControl: detail.timeControl,
        openingPlies: detail.openingPlies,
        entrants: detail.startedAt === null ? detail.entries.length : detail.standings.length,
        maxEntrants: detail.maxEntrants,
        winner: detail.status === `finished` && top !== undefined ? { name: top.bot, ownerName: top.ownerName } : null,
        round: detail.status === `running` && detail.rounds.length > 0 ? { current: currentRound(detail) ?? detail.rounds.length, of: detail.rounds.length } : null,
    };
}

function localTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

function utcTime(iso: string): string {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * One tournament under Games: a crumb to the list with the export beside
 * it, what it is, where it stands, and everything played in it.
 */
export function TournamentScreen({ id }: { id: string }) {
    const route = useRoute();
    const { load, retry } = useTournament(id);
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const meta = load.kind === `ready` ? tournamentMeta(summaryOf(load.detail)) : load.kind === `missing` ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);
    if (load.kind === `missing`) {
        return (
            <div className="empty">
                <h1>{text.tournaments.notFound.heading}</h1>
                <p>{text.tournaments.notFound.body}</p>
                <div className="actions">
                    <Link to="/games/tournaments" className="btn btn-ghost">
                        {text.tournaments.notFound.back}
                    </Link>
                </div>
            </div>
        );
    }
    const title = load.kind === `ready` ? load.detail.name : text.tournaments.title;
    const detail = load.kind === `ready` ? load.detail : null;
    return (
        <>
            <div className="duel-title-row">
                <p className="duel-kicker">
                    <Link to="/games/tournaments">{text.tournaments.crumb}</Link>
                    {detail?.origin === `person` ? (
                        <>
                            <span>{text.roundRobins.kind}</span>
                            <TournamentTag tournament={detail} />
                        </>
                    ) : null}
                </p>
                {detail === null ? null : <RoundRobinActions detail={detail} viewer={viewer} onChange={retry} />}
            </div>
            <h1 className="screen-title tournament-title">{title}</h1>
            {load.kind === `loading` ? <SkeletonRows /> : null}
            {load.kind === `failed` ? <ErrorFrame sentence={text.tournaments.detailFailed} onRetry={retry} wait={load.limited} /> : null}
            {load.kind === `ready` ? <Tournament detail={load.detail} readAt={load.at} onEntry={retry} /> : null}
        </>
    );
}

function Tournament({ detail, readAt, onEntry }: { detail: TournamentDetail; readAt: number; onEntry: () => void }) {
    const field = detail.startedAt === null ? detail.entries.length : detail.standings.length;
    const person = detail.origin === `person`;
    return (
        <div className={`tournament tournament-${detail.status}`}>
            <div className="tournament-intro">
                <p className="tournament-status">{person ? <RoundRobinStatus detail={detail} readAt={readAt} /> : <StatusSentence detail={detail} readAt={readAt} />}</p>
                <p className="note">
                    {person ? (
                        <RoundRobinTerms detail={detail} />
                    ) : (
                        <>
                            {text.tournaments.rules(field, clockText(detail.timeControl), detail.openingPlies)} {text.tournaments.pairing(detail.openingPlies)}
                        </>
                    )}
                </p>
                {detail.rounds.length > 0 ? <RoundSteps detail={detail} /> : null}
            </div>
            {person && detail.test ? <Estimates detail={detail} /> : null}
            {detail.status === `scheduled` ? <Waiting detail={detail} onEntry={onEntry} /> : null}
            {detail.status === `running` ? <Running detail={detail} readAt={readAt} /> : null}
            {detail.status === `finished` || detail.status === `stopped` ? <Finished detail={detail} /> : null}
            {detail.status === `called_off` || (detail.status === `canceled` && detail.rounds.length === 0) ? <Entries detail={detail} /> : null}
            {detail.status === `canceled` && detail.rounds.length > 0 ? <Finished detail={detail} /> : null}
        </div>
    );
}

function StatusSentence({ detail, readAt }: { detail: TournamentDetail; readAt: number }) {
    const status = text.tournaments.status;
    switch (detail.status) {
        case `scheduled`: {
            const wait = Math.floor((Date.parse(detail.startsAt) - readAt) / 1000);
            const when = `${localTime(detail.startsAt)} (${utcTime(detail.startsAt)})`;
            return <>{wait > 0 ? status.scheduled(when, text.time.untilInProse(wait)) : status.due(when)}</>;
        }
        case `running`: {
            const round = currentRound(detail) ?? detail.rounds.length;
            return <>{roundBegun(detail) ? status.live(round, detail.rounds.length) : status.gap(round, detail.rounds.length)}</>;
        }
        case `finished`:
            return <>{status.finished(localTime(detail.endedAt ?? detail.startsAt))}</>;
        case `called_off`: {
            const could = detail.entries.filter((entry) => entry.state === `entered`).length;
            return <>{status.calledOff(could, detail.entries.length, tournamentMinPresent)}</>;
        }
        case `canceled`:
            return <>{status.canceled}</>;
        // The weekly is never stopped, only canceled.
        case `stopped`:
            return null;
    }
}

function Waiting({ detail, onEntry }: { detail: TournamentDetail; onEntry: () => void }) {
    return (
        <div className="tournament-columns">
            <Entries detail={detail} />
            <EntryControl detail={detail} onChange={onEntry} />
        </div>
    );
}

function Running({ detail, readAt }: { detail: TournamentDetail; readAt: number }) {
    const round = currentRound(detail);
    const live = detail.live.map((entry) => ({ entry, cells: entry.cells, toMove: entry.toMove, readAt }));
    const liveRound = (
        <section className="tournament-block" aria-labelledby="tournament-live-title">
            <h2 id="tournament-live-title" className="section-title">
                {round === null ? text.tournaments.liveGames : text.tournaments.round(round)}
            </h2>
            {live.length === 0 && detail.waiting.length === 0 ? null : (
                <LiveGameGrid games={live} level={3}>
                    <Waits detail={detail} readAt={readAt} />
                </LiveGameGrid>
            )}
            {round === null ? null : <Rounds detail={detail} only={round} />}
        </section>
    );
    return (
        <>
            {/* A person's round robin draws its round's boards across the page, its standings beside the round to come. */}
            {detail.origin === `person` ? (
                <>
                    {liveRound}
                    <div className="tournament-columns">
                        <Standings detail={detail} />
                        <NextRound detail={detail} />
                    </div>
                </>
            ) : (
                <div className="tournament-columns">
                    {liveRound}
                    <Standings detail={detail} />
                </div>
            )}
            <Crosstables detail={detail} />
            <Rounds detail={detail} except={round} />
            <Absentees detail={detail} />
        </>
    );
}

function Finished({ detail }: { detail: TournamentDetail }) {
    const top = detail.standings.slice(0, 3);
    const places = top.map((line) => ({ name: line.bot, kind: `bot` as const, deleted: line.deleted, figure: String(line.points), meta: text.tournaments.plateMeta(line.points, <PlayerName name={line.ownerName} kind="human" deleted={line.ownerName === deletedPlayerName} />), play: null, rank: line.rank }));
    return (
        <>
            {detail.status === `finished` && !detail.test && top.length > 0 ? (
                <PodiumStand places={places} label={text.tournaments.podium(top.map((line) => ({ name: line.bot, points: line.points, rank: line.rank })))} title={text.tournaments.podiumTitle} />
            ) : null}
            <Standings detail={detail} />
            <Crosstables detail={detail} />
            <Rounds detail={detail} />
            <Absentees detail={detail} />
        </>
    );
}

function Crosstables({ detail }: { detail: TournamentDetail }) {
    // Past two games a pair, the stones would crowd a cell; each meeting's score says it.
    if (detail.gamesPerPair > 2) return <PairsTable detail={detail} />;
    return (
        <section className="tournament-block">
            <h2 className="section-title">{text.tournaments.crosstable}</h2>
            <p className="note">{text.tournaments.crosstableNote}</p>
            <Crosstable detail={detail} />
        </section>
    );
}

function Entries({ detail }: { detail: TournamentDetail }) {
    return (
        <section className="tournament-block" aria-labelledby="tournament-entries-title">
            <h2 id="tournament-entries-title" className="section-title">
                {text.tournaments.enteredTitle(detail.entries.length, detail.maxEntrants)}
            </h2>
            {detail.entries.length === 0 ? (
                <p className="note">{text.tournaments.noEntries}</p>
            ) : (
                <ul className="tournament-entries">
                    {detail.entries.map((entry) => (
                        <li key={entry.key}>
                            {/* Presence is today's, which says nothing of a tournament that is over. */}
                            {detail.status === `scheduled` || detail.status === `running` ? <PresenceDot online={entry.online} /> : null}
                            <PlayerName name={entry.bot} kind="bot" deleted={entry.deleted} />
                            <BotBadge />
                            <span className="tournament-owner">{text.ladder.byOwner(<PlayerName name={entry.ownerName} kind="human" deleted={entry.ownerName === deletedPlayerName} />)}</span>
                            {entry.state === `absent` || entry.state === `left_out` ? (
                                <span className="tournament-reason">{text.tournaments.reasons[entry.reason ?? `absent`]}</span>
                            ) : null}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

function Absentees({ detail }: { detail: TournamentDetail }) {
    const { never, withdrew } = absentees(detail);
    return (
        <>
            <Gone entries={never} title={text.tournaments.didNotPlay} id="tournament-absent-title" />
            <Gone entries={withdrew} title={text.tournaments.withdrawnTitle} id="tournament-withdrawn-title" />
        </>
    );
}

function Gone({ entries, title, id }: { entries: TournamentDetail[`entries`]; title: string; id: string }) {
    if (entries.length === 0) return null;
    return (
        <section className="tournament-block" aria-labelledby={id}>
            <h2 id={id} className="section-title">
                {title}
            </h2>
            <ul className="tournament-entries">
                {entries.map((entry) => (
                    <li key={entry.key}>
                        <PlayerName name={entry.bot} kind="bot" deleted={entry.deleted} />
                        <BotBadge />
                        <span className="tournament-owner">{text.ladder.byOwner(<PlayerName name={entry.ownerName} kind="human" deleted={entry.ownerName === deletedPlayerName} />)}</span>
                        <span className="tournament-reason">{text.tournaments.reasons[entry.reason ?? `absent`]}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
