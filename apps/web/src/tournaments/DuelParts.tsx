import { useState, type ReactNode } from 'react';
import { clockText, pagePath, resultSentence, turnsOnBoard, type Side, type TournamentDetail, type TournamentEntry, type TournamentGame } from '@hexo-arena/contract';
import { hexPoints } from '../board/geometry';
import { BotBadge, PlayerName, Rating, seatName, Swatch } from '../components/player';
import { Estimate } from '../duels/Estimate';
import { OpeningStones } from '../duels/OpeningStones';
import { countdown, otherSide, pointsText, signed, sweptBy, type DuelSide } from '../duels/words';
import { tournamentGamesPath } from '../games/filters';
import { FeaturedBoard } from '../home/FeaturedBoard';
import { Link } from '../router/Link';
import { text } from '../text';
import { Hex } from './Crosstable';
import { hexOf } from './view';
import '../duels/Duels.css';
import '../screens/HomeScreen.css';
import '../screens/PlayScreen.css';
import './DuelParts.css';

// The games list shows this many openings until the reader asks for every game.
const openingsShown = 3;

// One game of a duel: its number among the duel's games, the opening it plays, and how it stands.
interface NumberedGame {
    readonly n: number;
    readonly opening: number;
    readonly game: TournamentGame;
}

/** A duel as its page reads it: its two bots in the order named, its games in order, and each bot's points. */
export interface DuelView {
    readonly first: TournamentEntry;
    readonly second: TournamentEntry;
    readonly games: readonly NumberedGame[];
    readonly points: Readonly<Record<DuelSide, number>>;
    readonly kind: `duel` | `test`;
}

/** A tournament of two as a duel's page reads it; null for any other. */
export function duelViewOf(detail: TournamentDetail): DuelView | null {
    const [first, second] = detail.entries;
    if (detail.format !== `duel` || first === undefined || second === undefined) return null;
    const games = (detail.rounds[0]?.pairings[0]?.games ?? []).map((game, index) => ({ n: index + 1, opening: detail.gamesPerPair === 1 ? 1 : Math.floor(index / 2) + 1, game }));
    const points = (key: number) => games.filter((each) => each.game.point === key).length;
    return { first, second, games, points: { first: points(first.key), second: points(second.key) }, kind: detail.test ? `test` : `duel` };
}

function sideIn(game: TournamentGame, key: number): Side {
    return game.x === key ? `x` : `o`;
}

const overGame = (each: NumberedGame) => each.game.outcome !== `pending` && each.game.outcome !== `live`;

function noWinnerCount(view: DuelView): number {
    return view.games.filter((each) => each.game.outcome === `played` && each.game.point === null).length;
}

// The score with the leader's points first, and the games without a winner that it leaves out.
function scoreLine(view: DuelView): string {
    const high = Math.max(view.points.first, view.points.second);
    const low = Math.min(view.points.first, view.points.second);
    return `${text.duels.row.score(String(high), String(low))}${text.duels.noWinner(noWinnerCount(view))}`;
}

function leaderOf(view: DuelView): DuelSide | null {
    if (view.points.first === view.points.second) return null;
    return view.points.first > view.points.second ? `first` : `second`;
}

// Who leads by how much, or that it stands level.
function standing(view: DuelView): string {
    const words = text.duels.page.status;
    const leader = leaderOf(view);
    return leader === null ? words.level(scoreLine(view)) : words.leads(view[leader].bot, scoreLine(view));
}

/** Why a tournament a person set up was cut short, in a few words naming the bot whose leaving did it; none for any other end. */
export function cutWhy(detail: Pick<TournamentDetail, `end`>): string {
    const end = detail.end;
    if (end === undefined) return ``;
    const words = text.tournamentDuel.cut;
    const bot = end.bot?.name ?? text.tournamentDuel.aBot;
    switch (end.reason) {
        case `missed`:
        case `owner`:
        case `refused`:
        case `tournament`:
        case `banned`:
        case `delisted`:
        case `deleted`:
        case `offline`:
        case `closed`:
        case `clock`:
        case `busy`:
            return words[end.reason](bot);
        case `daily_cap`:
        case `aborted`:
            return words[end.reason]();
        case `creator`:
        case `operator`:
            return ``;
    }
}

/**
 * How a duel stands, as a game's drawer says it beside the game's place:
 * who leads and by how much, or a test's estimate so far; null for any
 * other tournament, and before a game is over.
 */
export function duelLead(detail: TournamentDetail): string | null {
    const view = duelViewOf(detail);
    if (view === null || !view.games.some(overGame)) return null;
    const estimate = detail.estimates?.find((each) => each.key === view.first.key)?.estimate;
    if (view.kind === `test` && estimate !== undefined && estimate.favored !== null) {
        const lead = estimate.favored;
        if (sweptBy(estimate) === lead) return text.drawer.testSwept(view[lead].bot, estimate.games);
        const rating = lead === `first` ? estimate.rating : -estimate.rating;
        const score = text.duels.row.score(pointsText(estimate.points[lead]), pointsText(estimate.points[otherSide(lead)]));
        return text.drawer.testSoFar(view[lead].bot, score, text.duels.noWinner(noWinnerCount(view)), signed(rating));
    }
    return standing(view);
}

/** The status sentence a duel's page leads with, a test over leaving its score to the head and the estimate. */
export function duelStatus(detail: TournamentDetail, view: DuelView, now: number, viewer: string | null): string {
    const words = text.duels.page.status;
    const duel = text.tournamentDuel;
    const kind = words.kinds[view.kind];
    const over = view.games.filter(overGame);
    const total = view.games.length;
    switch (detail.status) {
        case `running`: {
            const wait = detail.waiting[0];
            if (wait !== undefined) {
                const name = detail.entries.find((entry) => entry.key === wait.key)?.bot ?? ``;
                return duel.waiting(name, countdown(Math.max(0, Math.ceil((Date.parse(wait.until) - now) / 1000))));
            }
            const live = view.games.find((each) => each.game.outcome === `live`);
            if (live !== undefined) return over.length === 0 ? words.first(total) : words.live(live.n, total, standing(view));
            return words.next(over.length + 1, standing(view));
        }
        case `finished`: {
            if (view.kind === `test`) return words.testOver(total);
            const leader = leaderOf(view);
            return leader === null ? words.drawn(kind, scoreLine(view)) : words.won(view[leader].bot, kind, scoreLine(view));
        }
        case `cut_short`:
            return duel.cutShort(scoreLine(view), cutWhy(detail));
        case `stopped`: {
            const last = over.at(-1)?.n ?? null;
            if (detail.end?.reason !== `creator`) return duel.stoppedGone(kind, last);
            const who = viewer !== null && detail.createdBy === viewer ? words.you : (detail.createdBy ?? words.operator);
            return last === null ? words.stoppedAtOnce(who, kind) : words.stopped(who, kind, last, view.kind === `test` ? `` : `; ${standing(view)}`);
        }
        case `canceled`:
            return duel.canceled(over.at(-1)?.n ?? null);
        case `scheduled`:
        case `called_off`:
            return ``;
    }
}

/** The status a screen reader hears while a game waits, which holds still as the countdown ticks. */
export function duelWaitingQuiet(detail: TournamentDetail): string | null {
    const wait = detail.waiting[0];
    if (detail.status !== `running` || wait === undefined) return null;
    return text.tournamentDuel.waitingQuiet(detail.entries.find((entry) => entry.key === wait.key)?.bot ?? ``);
}

/** The terms under a duel's status: its games, clock, opening, strengths, never rated, and who set it up. */
export function duelTerms(detail: TournamentDetail, viewer: string | null): string {
    const words = text.duels.page.terms;
    const games = detail.gamesPerPair;
    const parts = [
        games === 1 ? words.single : games === 2 ? words.pair : words.pairs(games),
        clockText(detail.timeControl),
        words.openings(detail.openingPlies),
        ...detail.entries.flatMap((entry) => (entry.level === undefined ? [] : [words.strength(entry.bot, entry.level.label)])),
        detail.test ? words.test : text.tournamentDuel.neverRated,
    ];
    return words.line(parts, viewer !== null && viewer === detail.createdBy ? words.startedByYou : words.startedBy(detail.createdBy ?? text.duels.page.status.operator));
}

/** The two bots facing each other across the score. */
export function DuelHead({ detail, view, viewer }: { detail: TournamentDetail; view: DuelView; viewer: string | null }) {
    return (
        <div className="duel-head">
            <Plate entry={view.first} test={detail.test} right={false} viewer={viewer} />
            <ScoreCell detail={detail} view={view} />
            <Plate entry={view.second} test={detail.test} right viewer={viewer} />
        </div>
    );
}

function Plate({ entry, test, right, viewer }: { entry: TournamentEntry; test: boolean; right: boolean; viewer: string | null }) {
    const words = text.duels.page;
    return (
        <div className={right ? `duel-plate duel-plate-right` : `duel-plate`}>
            <p className="duel-plate-name">
                <PlayerName name={entry.bot} kind="bot" deleted={entry.deleted === true} />
                <BotBadge />
            </p>
            <p className="duel-plate-meta">
                <span>{viewer !== null && entry.ownerName === viewer ? words.yours : words.by(entry.ownerName)}</span>
                {test && entry.version !== undefined ? <span>{words.version(entry.version)}</span> : null}
                {entry.level === undefined ? null : <span>{entry.level.label}</span>}
            </p>
            {test ? (
                entry.now == null ? null : (
                    <p className="duel-plate-rating">
                        <Rating value={entry.now.rating} provisional={entry.now.provisional} /> <span className="note">{words.onLadder}</span>
                    </p>
                )
            ) : entry.ratingAtStart === null ? null : (
                <p className="duel-plate-rating">{String(entry.ratingAtStart)}</p>
            )}
        </div>
    );
}

// The score in a framed cell: the accent while it runs, quiet once over.
function ScoreCell({ detail, view }: { detail: TournamentDetail; view: DuelView }) {
    const words = text.duels.page;
    const running = detail.status === `running`;
    const total = view.games.length;
    const current = view.games.find((each) => each.game.outcome === `live`) ?? view.games.find((each) => each.game.outcome === `pending`);
    const place =
        view.kind === `test` || (running && current === undefined)
            ? words.of(total)
            : running
              ? words.gameOf(current?.n ?? total, total)
              : detail.status === `finished`
                ? words.final
                : detail.status === `stopped`
                  ? words.stopped
                  : detail.status === `canceled`
                    ? text.tournamentDuel.canceledWord
                    : words.cutShort;
    const first = String(view.points.first);
    const second = String(view.points.second);
    return (
        <div className={running ? `score-hex` : `score-hex score-hex-over`} role="img" aria-label={words.scoreLabel(first, second, place)}>
            <svg viewBox="-26 -30 52 60" aria-hidden="true">
                <polygon className="score-frame" points={hexPoints(28)} />
                <polygon className="score-cell" points={hexPoints(24)} />
            </svg>
            <span className="score-text" aria-hidden="true">
                <span className="score-digits">{text.duels.row.score(first, second)}</span>
                <span className="score-of">{place}</span>
            </span>
        </div>
    );
}

/** The games by opening as score cells: a row per bot, an opening's games in a column, each bot's points at the end. */
export function DuelScores({ view, label }: { view: DuelView; label: string }) {
    const words = text.duels.page;
    const openings = groupByOpening(view.games);
    const compact = view.games.length > 10;
    const leader = leaderOf(view);
    return (
        <div className="sb-frame" tabIndex={0} role="region" aria-label={label}>
            <table className={compact ? `sb sb-xs` : `sb`}>
                <thead>
                    <tr>
                        <th scope="col" className="sb-name">
                            <span className="sr-only">{words.bot}</span>
                        </th>
                        {openings.map((games, index) => (
                            <th key={games[0]?.n ?? index} scope="col">
                                {view.games.length === 1
                                    ? words.game
                                    : compact
                                      ? index % 5 === 0
                                          ? String(index + 1)
                                          : <span className="sr-only">{String(index + 1)}</span>
                                      : text.tournamentDuel.opening(index + 1)}
                            </th>
                        ))}
                        <th scope="col" className="sb-points-head">
                            {words.points}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {([`first`, `second`] as const).map((side) => {
                        const entry = view[side];
                        const other = view[otherSide(side)];
                        return (
                            <tr key={side} className={leader === side ? `sb-lead` : undefined}>
                                <th scope="row" className="sb-name">
                                    <PlayerName name={entry.bot} kind="bot" deleted={entry.deleted === true} />
                                    <BotBadge />
                                </th>
                                {openings.map((games, index) => (
                                    <td key={games[0]?.n ?? index} className="sb-cell">
                                        <span className="xt-pair">
                                            {games.map((each) => {
                                                const cell = hexOf(each.game, entry.key);
                                                // Drawn too small to press, a compact cell links nowhere; the games list links each game.
                                                return <Hex key={each.n} view={compact ? { ...cell, gameId: null } : cell} side={sideIn(each.game, entry.key)} bot={entry.bot} opponent={other.bot} />;
                                            })}
                                        </span>
                                    </td>
                                ))}
                                <td className="sb-points num">{String(view.points[side])}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function groupByOpening(games: readonly NumberedGame[]): NumberedGame[][] {
    const openings: NumberedGame[][] = [];
    for (const each of games) {
        const group = openings[each.opening - 1] ?? [];
        group.push(each);
        openings[each.opening - 1] = group;
    }
    return openings;
}

/** A test of two's estimate, the first bot's against the second, or a note until a game is over. */
export function DuelEstimate({ detail, view }: { detail: TournamentDetail; view: DuelView }) {
    const estimate = detail.estimates?.find((each) => each.key === view.first.key)?.estimate;
    if (estimate === undefined) {
        return (
            <div className="estimate">
                <p className="note">{text.duels.estimate.waiting}</p>
            </div>
        );
    }
    const bot = (entry: TournamentEntry) => ({ name: entry.bot, now: entry.now ?? null });
    return <Estimate duel={{ first: bot(view.first), second: bot(view.second), running: detail.status === `running`, games: view.games.length, noWinner: noWinnerCount(view) }} estimate={estimate} />;
}

/** The games by opening: the first few, and past them the opening under way and the next, the rest a press away. */
export function DuelGames({ detail, view }: { detail: TournamentDetail; view: DuelView }) {
    const words = text.duels.page;
    const duel = text.tournamentDuel;
    const [all, setAll] = useState(false);
    const openings = groupByOpening(view.games);
    const live = openings.findIndex((games) => games.some((each) => each.game.outcome === `live`));
    const at = live !== -1 ? live : detail.status === `running` ? openings.findIndex((games) => games.some((each) => each.game.outcome === `pending`)) : -1;
    const showAll = (label: string) => (
        <button type="button" className="text-button duel-all" onClick={() => { setAll(true); }}>
            {label}
        </button>
    );
    const openingView = (index: number) => {
        const games = openings[index] ?? [];
        return (
            <div key={games[0]?.n ?? index}>
                {view.games.length > 1 ? <h3 className="pair-title">{duel.opening(index + 1)}</h3> : null}
                <ol className="duel-games">
                    {games.map((each) => (
                        <li key={each.n}>
                            <GameRow detail={detail} view={view} each={each} />
                        </li>
                    ))}
                </ol>
            </div>
        );
    };
    const range = (from: number, to: number) => Array.from({ length: Math.max(0, Math.min(to, openings.length) - from) }, (_, index) => from + index);
    // The opening under way past the first few stands apart from them, the openings between folded.
    const apart = !all && at >= openingsShown;
    const head = all ? range(0, openings.length) : range(0, apart ? openingsShown : Math.max(openingsShown, at + 2));
    const tail = apart ? range(at, at + 2) : [];
    const earlier = apart ? at - openingsShown : 0;
    const later = all ? 0 : openings.length - (apart ? Math.min(openings.length, at + 2) : head.length);
    const over = view.games.some((each) => each.game.outcome === `played` || each.game.outcome === `aborted`);
    return (
        <section className="duel-section" aria-labelledby="duel-games">
            <div className="duel-section-head">
                <h2 id="duel-games" className="section-title">
                    {words.games}
                </h2>
                {over ? <Link to={tournamentGamesPath(detail.id)}>{words.theseGames}</Link> : null}
            </div>
            {head.map(openingView)}
            {earlier > 0 ? <p className="note">{duel.earlier(earlier, showAll)}</p> : null}
            {tail.map(openingView)}
            {later > 0 ? <p className="note">{earlier > 0 ? duel.later(later) : duel.more(later, showAll)}</p> : null}
        </section>
    );
}

function GameRow({ detail, view, each }: { detail: TournamentDetail; view: DuelView; each: NumberedGame }) {
    const words = text.duels.page;
    const duel = text.tournamentDuel;
    const { game } = each;
    const nameOf = (key: number) => (view.first.key === key ? view.first.bot : view.second.bot);
    const xKey = game.x;
    const oKey = view.first.key === xKey ? view.second.key : view.first.key;
    const names = { x: nameOf(xKey), o: nameOf(oKey) };
    const live = detail.live.find((entry) => entry.gameId === game.gameId);
    const result: ReactNode =
        game.outcome === `played` && game.reason != null
            ? resultSentence({ winner: game.point === null ? null : game.point === xKey ? `x` : `o`, reason: game.reason, turns: game.turns ?? 0 }, names)
            : game.outcome === `live`
              ? live === undefined
                  ? words.liveWord
                  : (
                      <>
                          <strong>{words.liveWord}</strong>, {words.liveGame(turnsOnBoard(live.cells.length), seatName(live.players[live.toMove]))}
                      </>
                  )
              : game.outcome === `pending`
                ? each.n % 2 === 0 && detail.gamesPerPair > 1
                    ? words.pendingSame
                    : words.pending
                : game.outcome === `no_show`
                  ? duel.noShow(game.missing.map(nameOf), game.point === null ? null : nameOf(game.point))
                  : game.outcome === `forfeit`
                    ? duel.forfeit(game.missing.map(nameOf), game.point === null ? null : nameOf(game.point))
                    : game.outcome === `aborted`
                      ? words.aborted
                      : words.notPlayed;
    const body = (
        <>
            <span className="duel-game-n">{String(each.n)}</span>
            <span className="duel-game-seats">
                <span>
                    <Swatch side="x" />
                    {names.x}
                </span>
                <span>
                    <Swatch side="o" />
                    {names.o}
                </span>
            </span>
            <span className="duel-game-result">{result}</span>
            <span className="note">{game.outcome === `live` ? words.watch : game.turns == null ? null : words.turns(game.turns)}</span>
        </>
    );
    const rowClass = game.outcome === `live` ? `duel-game duel-game-live` : game.outcome === `played` ? `duel-game` : `duel-game duel-game-todo`;
    return game.gameId === null || game.outcome === `pending` ? (
        <div className={rowClass}>{body}</div>
    ) : (
        <Link to={pagePath(`game`, { gameId: game.gameId })} className={rowClass}>
            {body}
        </Link>
    );
}

/** Beside the games: the live board, the opening under way, what comes next, and a test's versions. */
export function DuelAside({ detail, view, readAt }: { detail: TournamentDetail; view: DuelView; readAt: number }) {
    const words = text.duels.page;
    const duel = text.tournamentDuel;
    const live = detail.live[0];
    const liveGame = view.games.find((each) => each.game.outcome === `live`) ?? null;
    const running = detail.status === `running`;
    const total = view.games.length;
    return (
        <aside className="duel-side">
            {live === undefined || liveGame === null ? null : (
                <section className="duel-section" aria-labelledby="live-game">
                    <h2 id="live-game" className="section-title">
                        {words.gameLive(liveGame.n)}
                    </h2>
                    <FeaturedBoard featured={{ kind: `live`, view: { entry: live, cells: live.cells, toMove: live.toMove, readAt } }} />
                </section>
            )}
            <Opening detail={detail} view={view} />
            {running && liveGame !== null && liveGame.n < total ? (
                <section className="duel-section" aria-labelledby="next-game">
                    <h2 id="next-game" className="section-title">
                        {words.next}
                    </h2>
                    <p className="note">{detail.gamesPerPair > 1 && liveGame.n % 2 === 1 ? duel.nextSame(liveGame.n + 1) : duel.nextNew(liveGame.n + 1)}</p>
                </section>
            ) : null}
            {detail.test ? (
                <section className="duel-section" aria-labelledby="duel-versions">
                    <h2 id="duel-versions" className="section-title">
                        {words.versions}
                    </h2>
                    <dl className="duel-pairs">
                        {[view.first, view.second].map((entry) => (
                            <div key={entry.key}>
                                <dt>{entry.bot}</dt>
                                <dd>{entry.version ?? words.noVersion}</dd>
                            </div>
                        ))}
                    </dl>
                    <p className="note">{words.versionsNote}</p>
                </section>
            ) : null}
        </aside>
    );
}

// The opening under way, else the last drawn; none before any is drawn.
function Opening({ detail, view }: { detail: TournamentDetail; view: DuelView }) {
    const words = text.duels.page;
    const duel = text.tournamentDuel;
    const drawn = [...view.games].reverse().find((each) => each.game.opening != null && each.game.outcome !== `pending`) ?? view.games.find((each) => each.game.opening != null);
    const cells = drawn?.game.opening;
    if (drawn === undefined || cells == null) return null;
    const single = detail.gamesPerPair === 1;
    const firstOf = single ? drawn.n : drawn.n % 2 === 1 ? drawn.n : drawn.n - 1;
    const live = view.games.some((each) => each.game.outcome === `live` && each.opening === drawn.opening);
    const sentence = single ? words.openingSingle : live ? duel.openingLive(firstOf) : words.openingPlayed(firstOf);
    return (
        <section className="duel-section" aria-labelledby="duel-opening">
            <h2 id="duel-opening" className="section-title">
                {words.opening}
            </h2>
            <div className="opening-item">
                <OpeningStones cells={cells} label={duel.openingLabel(drawn.opening, cells.length)} />
                <p className="note">{sentence}</p>
            </div>
        </section>
    );
}
