import { useCallback } from 'react';
import { clockText, deletedPlayerName, notFoundMeta, tournamentMeta, tournamentMinPresent, tournamentRunningPollMs, tournamentWaitingPollMs, type TournamentDetail, type TournamentSummary } from '@hexo-arena/contract';
import { fetchTournament } from '../api/client';
import { useAsync } from '../api/use-async';
import { BotBadge, PlayerName, PresenceDot } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { PodiumStand } from '../ladder/Podium';
import { LiveGameGrid } from '../live/LiveGameCard';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { Crosstable } from '../tournaments/Crosstable';
import { DuelAside, DuelEstimate, DuelGames, DuelHead, DuelScores, duelStatus, duelTerms, duelViewOf, duelWaitingQuiet, type DuelView } from '../tournaments/DuelParts';
import { EntryControl } from '../tournaments/EntryControl';
import { Estimates, NextRound, PairsTable, RoundRobinActions, RoundRobinStatus, RoundRobinTerms, tournamentStatusId, Waits } from '../tournaments/RoundRobinParts';
import { RoundSteps } from '../tournaments/RoundSteps';
import { TournamentTag } from '../tournaments/TournamentRow';
import { Rounds } from '../tournaments/Rounds';
import { Standings } from '../tournaments/Standings';
import { absentees, currentRound, roundBegun } from '../tournaments/view';
import { useDocumentMeta } from '../use-document-meta';
import { useNow } from '../use-now';
import '../tournaments/DuelParts.css';
import './TournamentScreen.css';

// A tournament as read, with when, which its waits count from.
interface Read {
    readonly detail: TournamentDetail;
    readonly at: number;
}

// A running tournament is read again every few seconds while its page is in
// view, a waiting one every minute, and one that is over never.
function tournamentBeat(read: Read): number | null {
    const { status } = read.detail;
    return status === `running` ? tournamentRunningPollMs : status === `scheduled` ? tournamentWaitingPollMs : null;
}

function summaryOf(detail: TournamentDetail): TournamentSummary {
    const top = detail.standings[0];
    const view = duelViewOf(detail);
    return {
        id: detail.id,
        name: detail.name,
        origin: detail.origin,
        format: detail.format,
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
        ...(view === null
            ? {}
            : {
                  pair: {
                      first: { key: view.first.key, name: view.first.bot, points: view.points.first },
                      second: { key: view.second.key, name: view.second.bot, points: view.points.second },
                      games: view.games.map((each) => each.game),
                  },
              }),
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
    const load = useCallback(async () => ({ detail: await fetchTournament(id), at: Date.now() }), [id]);
    const read = useAsync(load, { every: tournamentBeat });
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const detail = read.data?.detail ?? null;
    const meta = read.missing ? notFoundMeta : detail === null ? undefined : tournamentMeta(summaryOf(detail));
    useDocumentMeta(route, meta?.title, meta?.description);
    // A change the reader made answers with the tournament as it now stands, which takes the old one's place without a read.
    const replace = (next: TournamentDetail) => {
        read.replace(() => ({ detail: next, at: Date.now() }));
    };
    if (read.missing) {
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
    const view = detail === null ? null : duelViewOf(detail);
    const title = view === null ? (detail?.name ?? text.tournaments.title) : text.duels.page.title(view.first.bot, view.second.bot);
    return (
        <>
            <div className="duel-title-row">
                <p className="duel-kicker">
                    <Link to="/games/tournaments">{text.tournaments.crumb}</Link>
                    {detail?.origin === `person` ? (
                        <>
                            <span>{text.tournamentDuel.crumb[detail.test ? `test` : detail.format]}</span>
                            <TournamentTag tournament={detail} />
                        </>
                    ) : null}
                </p>
                {detail === null ? null : <RoundRobinActions detail={detail} viewer={viewer} onChange={replace} />}
            </div>
            <h1 className={view === null ? `screen-title tournament-title` : `sr-only`}>{title}</h1>
            {read.loading ? <SkeletonRows /> : null}
            {detail === null && read.error ? <ErrorFrame sentence={text.tournaments.detailFailed} onRetry={read.reload} wait={read.limited} /> : null}
            {read.data === null ? null : view === null ? (
                <Tournament detail={read.data.detail} readAt={read.data.at} onEntry={read.reload} />
            ) : (
                <Duel detail={read.data.detail} view={view} readAt={read.data.at} viewer={viewer} />
            )}
        </>
    );
}

// A tournament of two as a duel's page: the bots facing each other across
// the score, the status and the terms, a test's estimate, the score cells
// by opening and the games grouped by opening beside the live game, its
// opening, and what comes next.
function Duel({ detail, view, readAt, viewer }: { detail: TournamentDetail; view: DuelView; readAt: number; viewer: string | null }) {
    const running = detail.status === `running`;
    const ticking = running && detail.waiting.length > 0;
    const tick = useNow(ticking);
    const now = ticking ? Math.max(tick, readAt) : readAt;
    const quiet = duelWaitingQuiet(detail);
    const sentence = duelStatus(detail, view, now, viewer);
    return (
        <>
            <DuelHead detail={detail} view={view} viewer={viewer} />
            <div className="duel-intro">
                {/* A screen reader hears the waiting once, not every tick of its countdown. */}
                <p id={tournamentStatusId} className="duel-status" role="status" tabIndex={-1}>
                    {quiet === null ? (
                        sentence
                    ) : (
                        <>
                            <span aria-hidden="true">{sentence}</span>
                            <span className="sr-only">{quiet}</span>
                        </>
                    )}
                </p>
                <p className="duel-terms">{duelTerms(detail, viewer)}</p>
            </div>
            <div className="duel-grid">
                <div className="duel-main">
                    {detail.test ? <DuelEstimate detail={detail} view={view} /> : null}
                    <DuelScores view={view} label={text.duels.page.score} />
                    <DuelGames detail={detail} view={view} />
                </div>
                <DuelAside detail={detail} view={view} readAt={readAt} />
            </div>
        </>
    );
}

function Tournament({ detail, readAt, onEntry }: { detail: TournamentDetail; readAt: number; onEntry: () => void }) {
    const field = detail.startedAt === null ? detail.entries.length : detail.standings.length;
    const person = detail.origin === `person`;
    return (
        <div className={`tournament tournament-${detail.status}`}>
            <div className="tournament-intro">
                <p id={tournamentStatusId} className="tournament-status" tabIndex={-1}>
                    {person ? <RoundRobinStatus detail={detail} readAt={readAt} /> : <StatusSentence detail={detail} readAt={readAt} />}
                </p>
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
            {detail.status === `finished` || detail.status === `stopped` || detail.status === `cut_short` ? <Finished detail={detail} /> : null}
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
        // The weekly is never stopped or cut short, only canceled.
        case `stopped`:
        case `cut_short`:
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
            {/* A person's round robin draws its round's boards across the page, its standings beside the round to come;
                between rounds nothing is live, and the round to come is that block's alone. */}
            {detail.origin === `person` ? (
                <>
                    {round !== null && !roundBegun(detail) ? null : liveRound}
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
