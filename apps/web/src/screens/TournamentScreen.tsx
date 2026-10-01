import { useCallback, useEffect, useState } from 'react';
import {
    clockText,
    tournamentMeta,
    tournamentMinPresent,
    tournamentRunningPollMs,
    tournamentWaitingPollMs,
    type TournamentDetail,
    type TournamentSummary,
} from '@hexo-arena/contract';
import { ApiError, fetchTournament, limitedFor } from '../api/client';
import { BotBadge, PlayerName, PresenceDot } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { LadderHead } from '../ladder/LadderHead';
import { PodiumStand } from '../ladder/Podium';
import { LiveGameGrid } from '../live/LiveGameCard';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { Crosstable } from '../tournaments/Crosstable';
import { EntryControl } from '../tournaments/EntryControl';
import { RoundSteps } from '../tournaments/RoundSteps';
import { Rounds } from '../tournaments/Rounds';
import { Standings } from '../tournaments/Standings';
import { absentees, currentRound, roundBegun } from '../tournaments/view';
import { useDocumentMeta } from '../use-document-meta';
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
        status: detail.status,
        startsAt: detail.startsAt,
        timeControl: detail.timeControl,
        openingPlies: detail.openingPlies,
        entrants: detail.startedAt === null ? detail.entries.length : detail.standings.length,
        maxEntrants: detail.maxEntrants,
        winner: detail.status === `finished` && top !== undefined ? { name: top.bot, ownerName: top.ownerName } : null,
    };
}

function localTime(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(iso));
}

function utcTime(iso: string): string {
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** One tournament: what it is, where it stands, and everything played in it. */
export function TournamentScreen({ id }: { id: string }) {
    const route = useRoute();
    const { load, retry } = useTournament(id);
    const meta = load.kind === `ready` ? tournamentMeta(summaryOf(load.detail)) : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);
    const title = load.kind === `ready` ? load.detail.name : text.tournaments.title;
    return (
        <>
            <LadderHead view="tournaments" title={title} />
            {load.kind === `loading` ? <SkeletonRows /> : null}
            {load.kind === `failed` ? <ErrorFrame sentence={text.tournaments.detailFailed} onRetry={retry} wait={load.limited} /> : null}
            {load.kind === `missing` ? (
                <div className="empty">
                    <h2>{text.tournaments.notFound}</h2>
                    <p>{text.tournaments.notFoundBody}</p>
                    <div className="actions">
                        <Link to="/tournaments" className="btn btn-primary">
                            {text.tournaments.title}
                        </Link>
                    </div>
                </div>
            ) : null}
            {load.kind === `ready` ? <Tournament detail={load.detail} readAt={load.at} onEntry={retry} /> : null}
        </>
    );
}

function Tournament({ detail, readAt, onEntry }: { detail: TournamentDetail; readAt: number; onEntry: () => void }) {
    const field = detail.startedAt === null ? detail.entries.length : detail.standings.length;
    return (
        <div className={`tournament tournament-${detail.status}`}>
            <div className="tournament-intro">
                <p className="tournament-status">
                    <StatusSentence detail={detail} readAt={readAt} />
                </p>
                <p className="note">
                    {text.tournaments.rules(field, clockText(detail.timeControl), detail.openingPlies)} {text.tournaments.pairing}
                </p>
                {detail.rounds.length > 0 ? <RoundSteps detail={detail} /> : null}
            </div>
            {detail.status === `scheduled` ? <Waiting detail={detail} onEntry={onEntry} /> : null}
            {detail.status === `running` ? <Running detail={detail} readAt={readAt} /> : null}
            {detail.status === `finished` ? <Finished detail={detail} /> : null}
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
            return <>{wait > 0 ? status.scheduled(when, text.time.until(wait)) : status.due(when)}</>;
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
    return (
        <>
            <div className="tournament-columns">
                <section className="tournament-block" aria-labelledby="tournament-live-title">
                    <h2 id="tournament-live-title" className="section-title">
                        {round === null ? text.tournaments.liveGames : text.tournaments.round(round)}
                    </h2>
                    {live.length === 0 ? null : <LiveGameGrid games={live} level={3} />}
                    {round === null ? null : <Rounds detail={detail} only={round} />}
                </section>
                <Standings detail={detail} />
            </div>
            <Crosstables detail={detail} />
            <Rounds detail={detail} except={round} />
            <Absentees detail={detail} />
        </>
    );
}

function Finished({ detail }: { detail: TournamentDetail }) {
    const top = detail.standings.slice(0, 3);
    const places = top.map((line) => ({ name: line.bot, kind: `bot` as const, figure: String(line.points), meta: text.tournaments.plateMeta(line.points, line.ownerName), play: null, rank: line.rank }));
    return (
        <>
            {detail.status === `finished` && top.length > 0 ? (
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
                        <li key={entry.bot}>
                            <PresenceDot online={entry.online} />
                            <PlayerName name={entry.bot} kind="bot" />
                            <BotBadge />
                            <span className="tournament-owner">{text.ladder.byOwner(entry.ownerName)}</span>
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
    const missing = absentees(detail);
    if (missing.length === 0) return null;
    return (
        <section className="tournament-block" aria-labelledby="tournament-absent-title">
            <h2 id="tournament-absent-title" className="section-title">
                {text.tournaments.didNotPlay}
            </h2>
            <ul className="tournament-entries">
                {missing.map((entry) => (
                    <li key={entry.bot}>
                        <PlayerName name={entry.bot} kind="bot" />
                        <BotBadge />
                        <span className="tournament-owner">{text.ladder.byOwner(entry.ownerName)}</span>
                        <span className="tournament-reason">{text.tournaments.reasons[entry.reason ?? `absent`]}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
