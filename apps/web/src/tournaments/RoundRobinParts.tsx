import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clockText, tournamentRoundGapMs, type TournamentDetail } from '@hexo-arena/contract';
import { createTournament, stopTournament, tournamentExportUrl, withdrawFromTournament } from '../api/client';
import { BotBadge, PlayerName } from '../components/player';
import { pointsText, signed } from '../duels/words';
import { Socket } from '../duels/Slots';
import { tournamentGamesPath } from '../games/filters';
import { Link } from '../router/Link';
import { navigate } from '../router/use-route';
import { text } from '../text';
import { tournamentRefusal } from './NewTournament';
import { againSetupOf, scheduleOf, tournamentSetupPath } from './setup';
import { currentRound, roundBegun, tournamentPagePath } from './view';
import { verdictOf } from './words';
import '../duels/Duels.css';
import './RoundRobin.css';

type Pairing = TournamentDetail[`rounds`][number][`pairings`][number];

// Whether a game is over, so the export and the games under Games hold one.
function anyGameOver(detail: TournamentDetail): boolean {
    return detail.rounds.some((round) => round.pairings.some((pairing) => pairing.games.some((game) => game.gameId !== null && (game.outcome === `played` || game.outcome === `aborted`))));
}

// A wait under a minute in seconds, as a round's gap and a bot's grace run; longer in the usual words.
const secondsLeft = (seconds: number) => (seconds < 60 ? text.play.seconds(seconds) : text.time.until(seconds));

const over = (detail: TournamentDetail) => detail.status !== `running` && detail.status !== `scheduled`;

/** The id of a tournament page's status sentence, where focus lands once a change leaves no action to hold it. */
export const tournamentStatusId = `tournament-status`;

// The bots first in the standings with a point, and their points; none before a point is scored.
function leaders(detail: TournamentDetail): { bots: string[]; points: number } | null {
    const top = detail.standings.filter((line) => line.rank === 1);
    const points = top[0]?.points ?? 0;
    return points === 0 ? null : { bots: top.map((line) => line.bot), points };
}

// A bot's games over in the round robin, its points among them counted as the standings count them.
function gamesOf(detail: TournamentDetail, key: number): number {
    return detail.rounds.reduce(
        (sum, round) =>
            sum +
            round.pairings
                .filter((pairing) => pairing.first.key === key || pairing.second.key === key)
                .reduce((count, pairing) => count + pairing.games.filter((game) => game.outcome === `played` || game.outcome === `no_show` || game.outcome === `forfeit`).length, 0),
        0,
    );
}

function playedGames(detail: TournamentDetail): number {
    return detail.rounds.reduce((sum, round) => sum + round.pairings.reduce((count, pairing) => count + pairing.games.filter((game) => game.outcome === `played`).length, 0), 0);
}

/** A person's round robin's status in one sentence: the round and who leads, how it ended, or a test's estimate. */
export function RoundRobinStatus({ detail, readAt }: { detail: TournamentDetail; readAt: number }) {
    const words = text.roundRobins.page.status;
    const lead = leaders(detail);
    const field = detail.standings.length;
    const others = field === 3 ? text.roundRobins.page.otherTwo : text.roundRobins.page.others;
    const schedule = scheduleOf(field, detail.gamesPerPair);
    if (detail.test && (detail.status === `running` || detail.status === `finished` || detail.status === `stopped`)) {
        const top = detail.standings[0];
        if (top === undefined || playedGames(detail) === 0) return <>{detail.status === `running` ? words.testFirst(schedule.games) : words.testLevel(schedule.games)}</>;
        if (detail.status === `running`) return <>{words.testLive(top.bot, pointsText(top.points), gamesOf(detail, top.key), playedGames(detail), schedule.games)}</>;
        const estimate = detail.estimates?.find((each) => each.key === top.key)?.estimate;
        if (estimate === undefined) return <>{words.testLevel(schedule.games)}</>;
        return <>{words.testOver(top.bot, pointsText(estimate.points.first), estimate.games, others, text.roundRobins.estimates.verdicts[verdictOf(estimate)])}</>;
    }
    const leadNow = lead === null ? null : words.leads(lead.bots, lead.points);
    const leadThen = lead === null ? null : words.led(lead.bots, lead.points);
    switch (detail.status) {
        case `running`: {
            const round = currentRound(detail) ?? detail.rounds.length;
            if (roundBegun(detail)) return <>{words.live(round, detail.rounds.length, leadNow)}</>;
            const at = detail.nextRoundAt === null ? null : Date.parse(detail.nextRoundAt);
            const wait = at === null ? tournamentRoundGapMs / 1000 : Math.max(0, Math.ceil((at - readAt) / 1000));
            return <>{words.gap(round, detail.rounds.length, secondsLeft(wait), leadNow)}</>;
        }
        case `finished`:
            if (lead === null) return <>{words.none}</>;
            return <>{lead.bots.length > 1 ? words.shared(lead.bots, lead.points) : words.won(lead.bots[0] ?? ``, lead.points, schedule.gamesPerBot)}</>;
        case `stopped`: {
            const round = detail.end?.round ?? null;
            if (detail.end?.reason === `deleted`) return <>{words.stoppedGone(round, leadThen)}</>;
            const by = detail.end?.reason === `creator` ? (detail.createdBy ?? words.operator) : words.operator;
            return <>{words.stopped(by, round, leadThen)}</>;
        }
        case `cut_short`:
            return <>{text.tournamentDuel.cutShortField(detail.end?.round ?? null, detail.entries.filter((entry) => entry.state === `playing`).map((entry) => entry.bot))}</>;
        case `canceled`:
            return <>{words.canceled(detail.end?.round ?? null)}</>;
        case `scheduled`:
        case `called_off`:
            return null;
    }
}

/** What a person's round robin is: its field and who picked it, how pairs play, the clock, the opening, and any strength. */
export function RoundRobinTerms({ detail }: { detail: TournamentDetail }) {
    const words = text.roundRobins.page;
    const field = detail.standings.length > 0 ? detail.standings.length : detail.entries.length;
    const pairing = words.pairing(detail.gamesPerPair);
    const clock = clockText(detail.timeControl);
    const owner = detail.entries[0]?.ownerName ?? ``;
    const strengths = detail.entries.flatMap((entry) => (entry.level === undefined ? [] : [[entry.bot, entry.level.label] as const]));
    const ended = over(detail) && detail.endedAt !== null ? `${text.tournaments.status.finished(new Intl.DateTimeFormat(undefined, { dateStyle: `medium`, timeStyle: `short` }).format(new Date(detail.endedAt)))} ` : ``;
    const terms = detail.test
        ? words.termsTest(field, owner, detail.gamesPerPair, pairing, clock, detail.openingPlies)
        : words.terms(field, detail.createdBy ?? ``, pairing, clock, detail.openingPlies);
    return (
        <>
            {detail.status === `finished` ? ended : ``}
            {terms}
            {strengths.length === 0 ? null : ` ${words.strengths(strengths, over(detail))}`}
        </>
    );
}

type Asking = { kind: `none` } | { kind: `stop` } | { kind: `withdraw`; bot: string };

// Where focus goes after a render: the confirm's Keep playing once it opens,
// the control that opened it once kept, or past the change once confirmed,
// since each time the control that held focus is gone.
type Landing = `keep` | `stop` | `withdraw` | `changed` | null;

/**
 * The actions beside a round robin's crumb: its games under Games and as
 * one download once one is over; Stop for the person who set it up and
 * Withdraw for a bot's owner while it runs, one control choosing among
 * several bots, each confirmed in place with its consequence; and once
 * over, Set up again for anyone signed in and a test's Run more for the
 * person who set it up.
 */
export function RoundRobinActions({ detail, viewer, onChange }: { detail: TournamentDetail; viewer: string | null; onChange: (detail: TournamentDetail) => void }) {
    const [asking, setAsking] = useState<Asking>({ kind: `none` });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const actions = useRef<HTMLDivElement>(null);
    const keep = useRef<HTMLButtonElement>(null);
    const stopper = useRef<HTMLButtonElement>(null);
    const withdrawer = useRef<HTMLButtonElement>(null);
    const landing = useRef<Landing>(null);
    useEffect(() => {
        const to = landing.current;
        landing.current = null;
        if (to === `keep`) keep.current?.focus();
        if (to === `stop`) stopper.current?.focus();
        if (to === `withdraw`) withdrawer.current?.focus();
        if (to === `changed`) (actions.current?.querySelector<HTMLElement>(`a, button`) ?? document.getElementById(tournamentStatusId))?.focus();
    });
    const words = text.roundRobins.page;
    const duelWords = text.tournamentDuel;
    const duel = detail.format === `duel`;
    const kind = detail.test ? `test` : detail.format;
    const running = detail.status === `running`;
    const person = detail.origin === `person`;
    const creator = person && viewer !== null && detail.createdBy === viewer;
    // A test's creator owns every bot, and Stop test ends the whole.
    const owned = running && person && viewer !== null && !(detail.test && creator) ? detail.entries.filter((entry) => entry.state === `playing` && entry.ownerName === viewer).map((entry) => entry.bot) : [];
    const gamesOver = anyGameOver(detail);
    const schedule = scheduleOf(detail.standings.length, detail.gamesPerPair);

    function ask(next: Asking) {
        landing.current = next.kind !== `none` ? `keep` : asking.kind === `stop` ? `stop` : `withdraw`;
        setAsking(next);
        setError(null);
    }

    async function act(run: () => Promise<TournamentDetail>) {
        setBusy(true);
        setError(null);
        try {
            const next = await run();
            landing.current = `changed`;
            setAsking({ kind: `none` });
            onChange(next);
        } catch {
            setError(words.failed);
        } finally {
            setBusy(false);
        }
    }

    async function runMore() {
        setBusy(true);
        setError(null);
        try {
            const created = await createTournament({
                bots: detail.entries.filter((entry) => entry.deleted !== true).map((entry) => ({ name: entry.bot, ...(entry.level === undefined ? {} : { level: entry.level.id }) })),
                gamesPerPair: detail.gamesPerPair,
                openingPlies: detail.openingPlies,
                timeControl: detail.timeControl,
            });
            navigate(tournamentPagePath(created.id));
        } catch (cause) {
            const refusal = tournamentRefusal(cause, () => null, `test`);
            setError(typeof refusal.line === `string` ? refusal.line : words.failed);
        } finally {
            setBusy(false);
        }
    }

    const [only] = owned;
    return (
        <>
            <div ref={actions} className="duel-actions rr-actions">
                {gamesOver ? (
                    <Link to={tournamentGamesPath(detail.id)} className="btn btn-ghost">
                        {text.tournaments.theseGames}
                    </Link>
                ) : null}
                {/* The export holds the games over; before the first, it would hold none. */}
                {gamesOver ? (
                    <a href={tournamentExportUrl(detail.id)} download className="btn btn-ghost">
                        {text.games.exportGames}
                    </a>
                ) : null}
                {creator && running && asking.kind === `none` ? (
                    <button ref={stopper} type="button" className="btn btn-ghost" onClick={() => { ask({ kind: `stop` }); }}>
                        {duelWords.stop[kind]}
                    </button>
                ) : null}
                {asking.kind === `none` && only !== undefined ? (
                    <button ref={withdrawer} type="button" className="btn btn-ghost" onClick={() => { ask({ kind: `withdraw`, bot: only }); }}>
                        {owned.length === 1 ? words.withdraw(only) : words.withdrawABot}
                    </button>
                ) : null}
                {person && over(detail) && viewer !== null ? (
                    <Link to={tournamentSetupPath(againSetupOf(detail))} className="btn btn-ghost">
                        {duel ? duelWords.again : words.setUpAgain}
                    </Link>
                ) : null}
                {detail.test && creator && over(detail) ? (
                    <button type="button" className="btn btn-ghost" aria-disabled={busy ? `true` : undefined} onClick={() => { if (!busy) void runMore(); }}>
                        {words.runMore(schedule.games)}
                    </button>
                ) : null}
            </div>
            {asking.kind === `none` ? null : (
                <div className="rr-confirm" role="group" aria-label={asking.kind === `stop` ? duelWords.stop[kind] : owned.length > 1 ? words.withdrawABot : words.withdraw(asking.bot)}>
                    {asking.kind === `withdraw` && owned.length > 1 ? (
                        <div className="pills" role="group" aria-label={words.whichBot}>
                            {owned.map((bot) => (
                                <button key={bot} type="button" className={asking.bot === bot ? `pill active` : `pill`} aria-pressed={asking.bot === bot} onClick={() => { setAsking({ kind: `withdraw`, bot }); }}>
                                    {bot}
                                </button>
                            ))}
                        </div>
                    ) : null}
                    <p>{asking.kind === `stop` ? (duel ? duelWords.stopAsk(detail.test) : words.stopAsk) : duel ? duelWords.withdrawAsk(asking.bot) : words.withdrawAsk(asking.bot)}</p>
                    <div className="actions">
                        <button
                            type="button"
                            className="btn btn-primary"
                            aria-disabled={busy ? `true` : undefined}
                            onClick={() => {
                                if (busy) return;
                                void act(async () => (asking.kind === `stop` ? stopTournament(detail.id) : withdrawFromTournament(detail.id, asking.bot)));
                            }}
                        >
                            {asking.kind === `stop` ? words.stopYes : duel ? duelWords.withdrawYes : words.withdrawYes(asking.bot)}
                        </button>
                        <button ref={keep} type="button" className="btn btn-ghost" onClick={() => { ask({ kind: `none` }); }}>
                            {words.keepPlaying}
                        </button>
                    </div>
                </div>
            )}
            {error === null ? null : (
                <p className="rr-error" role="status">
                    {error}
                </p>
            )}
        </>
    );
}

// The pairing a bot plays in a round, by its key.
function pairingOf(detail: TournamentDetail, round: number, key: number): Pairing | undefined {
    return detail.rounds.find((each) => each.round === round)?.pairings.find((pairing) => pairing.first.key === key || pairing.second.key === key);
}

/** The bots the round's games wait for, each a card in the live grid: an empty cell, the pair it plays, and the seconds left. */
export function Waits({ detail, readAt }: { detail: TournamentDetail; readAt: number }) {
    const round = currentRound(detail);
    if (detail.waiting.length === 0 || round === null) return null;
    const words = text.roundRobins.page;
    return (
        <>
            {detail.waiting.map((wait) => {
                const entry = detail.entries.find((each) => each.key === wait.key);
                const pairing = pairingOf(detail, round, wait.key);
                const left = Math.max(0, Math.ceil((Date.parse(wait.until) - readAt) / 1000));
                const name = entry?.bot ?? ``;
                return (
                    <li key={wait.key} className="rr-wait">
                        <Socket />
                        <div>
                            {pairing === undefined ? null : <p className="rr-wait-pair">{text.tournaments.pairingLine(pairing.first.name, pairing.second.name)}</p>}
                            <p className="rr-wait-line">{left > 0 ? words.waitingFor(name, secondsLeft(left)) : words.waitingNow(name)}</p>
                            <p className="note">{words.waitGrace}</p>
                        </div>
                    </li>
                );
            })}
        </>
    );
}

/** The next round's pairs while one is live, or the round about to start while the gap runs. */
export function NextRound({ detail }: { detail: TournamentDetail }) {
    const words = text.roundRobins.page;
    const round = currentRound(detail);
    if (round === null) return null;
    const begun = roundBegun(detail);
    const shown = begun ? round + 1 : round;
    const pairs = detail.rounds.find((each) => each.round === shown);
    if (pairs === undefined) return null;
    return (
        <section className="tournament-block rr-next" aria-labelledby="rr-next-title">
            <h2 id="rr-next-title" className="section-title">
                {words.next(shown)}
            </h2>
            <p className="note">{begun ? words.nextNote(round) : words.nextNow}</p>
            <ul>
                {pairs.pairings.map((pairing) => (
                    <li key={`${String(pairing.first.key)} ${String(pairing.second.key)}`}>{text.tournaments.pairingLine(pairing.first.name, pairing.second.name)}</li>
                ))}
            </ul>
            {pairs.rest === null ? null : <p className="note">{text.tournaments.rest(pairs.rest.name)}</p>}
        </section>
    );
}

// Each bot's points against one other over their whole meeting, and the round they met in.
function meetingScore(detail: TournamentDetail, bot: number, opponent: number): { score: readonly [number, number]; round: number } | null {
    for (const round of detail.rounds) {
        for (const pairing of round.pairings) {
            const pair = [pairing.first.key, pairing.second.key];
            if (bot === opponent || !pair.includes(bot) || !pair.includes(opponent)) continue;
            const points = (key: number) => pairing.games.filter((game) => game.point === key).length;
            return { score: [points(bot), points(opponent)], round: round.round };
        }
    }
    return null;
}

/** Pairs: where each pair plays more than two games, a crosstable of each meeting's score, each cell linking its round's games. */
export function PairsTable({ detail }: { detail: TournamentDetail }) {
    const words = text.roundRobins.page;
    const bots = detail.standings;
    return (
        <section className="tournament-block" aria-labelledby="rr-pairs-title">
            <h2 id="rr-pairs-title" className="section-title">
                {words.pairs}
            </h2>
            <p className="note">{words.pairsNote(detail.gamesPerPair)}</p>
            <div className="xt-frame" tabIndex={0} role="region" aria-label={words.pairsLabel}>
                <table className="xt rr-pairs">
                    <thead>
                        <tr>
                            <th scope="col" className="xt-name">
                                {text.tournaments.columns.bot}
                            </th>
                            {bots.map((bot, index) => (
                                <th key={bot.key} scope="col" className="xt-col">
                                    <span aria-hidden="true">{String(index + 1)}</span>
                                    <span className="sr-only">{bot.bot}</span>
                                </th>
                            ))}
                            <th scope="col" className="num">
                                {text.tournaments.total}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {bots.map((line, row) => (
                            <tr key={line.key}>
                                <th scope="row" className="xt-name">
                                    <span className="xt-rank" aria-hidden="true">
                                        {String(row + 1)}
                                    </span>
                                    <PlayerName name={line.bot} kind="bot" deleted={line.deleted} />
                                    <BotBadge />
                                </th>
                                {bots.map((opponent) => {
                                    const met = meetingScore(detail, line.key, opponent.key);
                                    if (met === null) return <td key={opponent.key} className="xt-cell xt-self" />;
                                    const score = text.tournaments.score(met.score[0], met.score[1]);
                                    return (
                                        <td key={opponent.key} className="xt-cell">
                                            <Link to={tournamentGamesPath(detail.id, met.round)} ariaLabel={words.pairsCell(line.bot, opponent.bot, score)}>
                                                {score}
                                            </Link>
                                        </td>
                                    );
                                })}
                                <td className="num xt-total">{String(line.points)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

// The axis runs this far either way, in rating points; an estimate past it sits at its end.
const axisReach = 400;
const ticks = [-400, -200, 0, 200, 400] as const;

function at(value: number): string {
    const clamped = Math.min(axisReach, Math.max(-axisReach, value));
    return `${String(((clamped + axisReach) / (2 * axisReach)) * 100)}%`;
}

/**
 * A test's estimates first on its page: each bot against all the others
 * together, its score, its rating points on an axis around zero with the
 * 95% range, the value, and the verdict with the chance it is the stronger.
 */
export function Estimates({ detail }: { detail: TournamentDetail }) {
    const words = text.roundRobins.estimates;
    const duelWords = text.duels.estimate;
    const field = detail.standings.length;
    const rows = detail.standings.flatMap((line) => {
        const estimate = detail.estimates?.find((each) => each.key === line.key)?.estimate;
        const entry = detail.entries.find((each) => each.key === line.key);
        return estimate === undefined ? [] : [{ line, estimate, version: entry?.version }];
    });
    return (
        <section className="rr-estimates" aria-labelledby="rr-estimates-title">
            <h2 id="rr-estimates-title" className="estimate-title">
                {words.title(field)}
            </h2>
            <p>{words.lead(field)}</p>
            {rows.length === 0 ? (
                <p className="note">{words.none}</p>
            ) : (
                <ul className="rr-est-rows">
                    <li className="rr-est-row rr-est-head" aria-hidden="true">
                        <span>{words.columns.bot}</span>
                        <span>{words.columns.score}</span>
                        <div className="est-axis">
                            <div className="est-track">
                                {ticks.map((tick) => (
                                    <span key={tick} className="est-tick" style={{ [`--at` as string]: at(tick) }}>
                                        {duelWords.tick(tick)}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <span>{words.columns.rating}</span>
                        <span>{words.columns.verdict}</span>
                    </li>
                    {rows.map(({ line, estimate, version }) => {
                        const value = signed(estimate.rating);
                        const range = words.range(estimate.low === null ? words.open : signed(estimate.low), estimate.high === null ? words.open : signed(estimate.high));
                        const from = estimate.low ?? -axisReach;
                        const to = estimate.high ?? axisReach;
                        const band: CSSProperties = { [`--from` as string]: at(from), [`--span` as string]: `calc(${at(to)} - ${at(from)})` };
                        const verdict = verdictOf(estimate);
                        return (
                            <li key={line.key} className="rr-est-row">
                                <span className="rr-est-who">
                                    <span className="player-cell">
                                        <PlayerName name={line.bot} kind="bot" deleted={line.deleted} />
                                        <BotBadge />
                                    </span>
                                    {version === undefined ? null : <span className="note">{text.duels.slot.version(version)}</span>}
                                </span>
                                <span className="rr-est-score">{words.score(pointsText(estimate.points.first), estimate.games)}</span>
                                <div className="est-axis" role="img" aria-label={words.axis(line.bot, `${value}, ${range}`)}>
                                    <div className="est-track">
                                        <span className="est-line" />
                                        <span className="est-band" style={band} />
                                        <span className="est-zero" style={{ [`--at` as string]: at(0) }} />
                                        <span className="est-mark" style={{ [`--at` as string]: at(estimate.rating) }} />
                                    </div>
                                </div>
                                <span className="rr-est-value">
                                    <strong>{value}</strong>
                                    <span className="note">{range}</span>
                                </span>
                                <span className="rr-est-verdict">
                                    <span className={verdict === `too_close` ? `tag muted` : `tag`}>{words.verdicts[verdict]}</span>
                                    <span className="note">{words.percent(estimate.chance)}</span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}
            <p className="note">{words.note}</p>
        </section>
    );
}
