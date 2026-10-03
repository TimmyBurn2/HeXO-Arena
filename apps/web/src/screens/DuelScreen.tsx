import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { duelMeta, duelRunningPollMs, estimateMoreGames, nameKeyOf, notFoundMeta, resultSentence, turnsOnBoard, type DuelBot, type DuelDetail, type DuelGame, type DuelSide } from '@hexo-arena/contract';
import { ApiError, createDuel, fetchDuel, limitedFor, stopDuel } from '../api/client';
import { hexPoints } from '../board/geometry';
import { BotBadge, PlayerName, Rating, seatName, Swatch } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Estimate } from '../duels/Estimate';
import { OpeningStones } from '../duels/OpeningStones';
import { namesABot, refusalLine, refusalReads, refusedBot, type Refused } from '../duels/refusal';
import { pairsOf, Scoreboard, sideIn } from '../duels/Scoreboard';
import { againPath, duelPagePath, duelsPath } from '../duels/setup';
import { scoreText, statusSentence, termsLine, waitingQuiet } from '../duels/words';
import { FeaturedBoard } from '../home/FeaturedBoard';
import { useMe } from '../me';
import { Link } from '../router/Link';
import { navigate, useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import '../duels/Duels.css';
import './HomeScreen.css';
import './PlayScreen.css';
import './DuelScreen.css';

// The games list shows this many pairs until the reader asks for every game.
const pairsShown = 3;

// A countdown steps once a second.
const tickMs = 1000;

type Read = { kind: `loading` } | { kind: `missing` } | { kind: `failed`; wait: number | null } | { kind: `ready`; duel: DuelDetail; at: number };

// A running duel is read again on its beat while the page is in view; one over never changes.
function useDuel(id: string): { read: Read; reload: () => void; replace: (duel: DuelDetail) => void } {
    const [read, setRead] = useState<Read>({ kind: `loading` });
    const load = useCallback(async () => {
        try {
            const duel = await fetchDuel(id);
            setRead({ kind: `ready`, duel, at: Date.now() });
        } catch (cause) {
            setRead((held) =>
                held.kind === `ready` ? held : cause instanceof ApiError && cause.status === 404 ? { kind: `missing` } : { kind: `failed`, wait: limitedFor(cause) },
            );
        }
    }, [id]);
    useEffect(() => {
        void load();
    }, [load]);
    const running = read.kind === `ready` && read.duel.status === `running`;
    useEffect(() => {
        if (!running) return;
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void load();
        }, duelRunningPollMs);
        return () => {
            clearInterval(timer);
        };
    }, [running, load]);
    return { read, reload: () => void load(), replace: (duel) => { setRead({ kind: `ready`, duel, at: Date.now() }); } };
}

// The time now, stepping every second while on, so a countdown between two reads still ticks.
function useTicking(on: boolean, from: number): number {
    const [now, setNow] = useState(from);
    useEffect(() => {
        if (!on) return;
        setNow(Date.now());
        const timer = setInterval(() => {
            setNow(Date.now());
        }, tickMs);
        return () => {
            clearInterval(timer);
        };
    }, [on]);
    return on ? now : from;
}

/**
 * A duel's page: the two bots face each other across the score, then the
 * status and the terms, a test's estimate, the scoreboard, and the games
 * by pair beside the live game, the pair's opening, and what comes next.
 * The starter and the owners stop it here, confirmed inline.
 */
export function DuelScreen({ id }: { id: string }) {
    const route = useRoute();
    const { read, reload, replace } = useDuel(id);
    const meta = read.kind === `ready` ? duelMeta({ ...read.duel, played: 0, results: read.duel.games }) : read.kind === `missing` ? notFoundMeta : undefined;
    useDocumentMeta(route, meta?.title, meta?.description);
    if (read.kind === `loading`) return <SkeletonRows />;
    if (read.kind === `failed`) return <ErrorFrame sentence={text.duels.page.failed} onRetry={reload} wait={read.wait} />;
    if (read.kind === `missing`) {
        return (
            <div className="empty">
                <h1>{text.duels.page.notFound.heading}</h1>
                <p>{text.duels.page.notFound.body}</p>
                <div className="actions">
                    <Link to={duelsPath()} className="btn btn-ghost">
                        {text.duels.page.notFound.back}
                    </Link>
                </div>
            </div>
        );
    }
    return <DuelPage duel={read.duel} at={read.at} onStopped={replace} />;
}

function DuelPage({ duel, at, onStopped }: { duel: DuelDetail; at: number; onStopped: (duel: DuelDetail) => void }) {
    const me = useMe();
    const viewer = me.status === `ready` && me.me?.kind === `user` ? me.me.name : null;
    const words = text.duels.page;
    const test = duel.kind === `test`;
    const running = duel.status === `running`;
    // The starter and either bot's owner may stop it.
    const mayStop = running && viewer !== null && (viewer === duel.startedBy || viewer === duel.first.ownerName || viewer === duel.second.ownerName);
    const mayAgain = !running && viewer !== null;
    const live = duel.live[0];
    const liveGame = duel.games.find((game) => game.state === `live`) ?? null;
    const now = useTicking(running && duel.waiting !== undefined, at);
    const quiet = waitingQuiet(duel);
    const sentence = statusSentence(duel, now, viewer);
    const actions = useRef<HTMLDivElement>(null);
    const status = useRef<HTMLParagraphElement>(null);
    // Once stopped, the Stop control is gone, so focus moves to what took its place, else to the status that says so.
    const stopped = useRef(false);
    useEffect(() => {
        if (!stopped.current) return;
        stopped.current = false;
        (actions.current?.querySelector<HTMLElement>(`a, button`) ?? status.current)?.focus();
    });
    return (
        <>
            <div className="duel-title-row">
                <p className="duel-kicker">
                    <Link to={duelsPath()}>{words.crumb}</Link>
                    <span>{test ? words.test : words.duel}</span>
                    <span className="tag muted">{test ? words.neverRated : duel.terms.rated ? words.rated : words.unrated}</span>
                </p>
                <div ref={actions} className="duel-actions">
                    {mayStop ? (
                        <StopDuel
                            duel={duel}
                            onStopped={(next) => {
                                stopped.current = true;
                                onStopped(next);
                            }}
                        />
                    ) : mayAgain ? (
                        <Again duel={duel} viewer={viewer} />
                    ) : null}
                </div>
            </div>
            <h1 className="sr-only">{words.title(duel.first.name, duel.second.name)}</h1>
            <div className="duel-head">
                <Plate duel={duel} side="first" viewer={viewer} />
                <ScoreCell duel={duel} />
                <Plate duel={duel} side="second" viewer={viewer} />
            </div>
            <div className="duel-intro">
                {/* A screen reader hears the waiting once, not every tick of its countdown. */}
                <p ref={status} className="duel-status" role="status" tabIndex={-1}>
                    {quiet === null ? (
                        sentence
                    ) : (
                        <>
                            <span aria-hidden="true">{sentence}</span>
                            <span className="sr-only">{quiet}</span>
                        </>
                    )}
                </p>
                <p className="duel-terms">{termsLine(duel, viewer)}</p>
            </div>
            <div className="duel-grid">
                <div className="duel-main">
                    {test ? (
                        duel.estimate === undefined ? (
                            <div className="estimate">
                                <p className="note">{text.duels.estimate.waiting}</p>
                            </div>
                        ) : (
                            <Estimate duel={duel} estimate={duel.estimate} />
                        )
                    ) : null}
                    {test ? (
                        <section className="duel-section" aria-labelledby="every-game">
                            <h2 id="every-game" className="section-title">
                                {words.everyGame}
                            </h2>
                            <Scoreboard duel={duel} compact={duel.games.length > 10} label={words.score} />
                            <p className="note">{words.everyGameNote}</p>
                        </section>
                    ) : (
                        <Scoreboard duel={duel} label={words.score} />
                    )}
                    <Games duel={duel} />
                </div>
                <aside className="duel-side">
                    {live === undefined || liveGame === null ? null : (
                        <section className="duel-section" aria-labelledby="live-game">
                            <h2 id="live-game" className="section-title">
                                {words.gameLive(liveGame.game)}
                            </h2>
                            <FeaturedBoard featured={{ kind: `live`, view: { entry: live, cells: live.cells, toMove: live.toMove, readAt: at } }} />
                        </section>
                    )}
                    <Opening duel={duel} />
                    {running && liveGame !== null && liveGame.game < duel.terms.games ? (
                        <section className="duel-section" aria-labelledby="next-game">
                            <h2 id="next-game" className="section-title">
                                {words.next}
                            </h2>
                            <p className="note">
                                {liveGame.game % 2 === 1 ? words.nextSame(liveGame.game + 1, words.status.kinds[duel.kind]) : words.nextNew(liveGame.game + 1, words.status.kinds[duel.kind])}
                            </p>
                        </section>
                    ) : null}
                    {test ? <Versions duel={duel} /> : null}
                    {!running && duel.terms.rated ? <Ratings duel={duel} /> : null}
                </aside>
            </div>
        </>
    );
}

function Plate({ duel, side, viewer }: { duel: DuelDetail; side: DuelSide; viewer: string | null }) {
    const bot = duel[side];
    const words = text.duels.page;
    const over = duel.status !== `running`;
    return (
        <div className={side === `second` ? `duel-plate duel-plate-right` : `duel-plate`}>
            <p className="duel-plate-name">
                <PlayerName name={bot.name} kind="bot" deleted={bot.deleted === true} />
                <BotBadge />
            </p>
            <p className="duel-plate-meta">
                <span>{viewer !== null && bot.ownerName === viewer ? words.yours : words.by(bot.ownerName)}</span>
                {duel.kind === `test` && bot.version !== undefined ? <span>{words.version(bot.version)}</span> : null}
                {bot.level === undefined ? null : <span>{bot.level.label}</span>}
            </p>
            <PlateRating bot={bot} test={duel.kind === `test`} movedOver={over && duel.terms.rated} />
        </div>
    );
}

function PlateRating({ bot, test, movedOver }: { bot: DuelBot; test: boolean; movedOver: boolean }) {
    const words = text.duels.page;
    if (test) {
        return bot.now === null ? null : (
            <p className="duel-plate-rating">
                <Rating value={bot.now.rating} provisional={bot.now.provisional} /> <span className="note">{words.onLadder}</span>
            </p>
        );
    }
    if (bot.ratingAtStart === null) return null;
    return (
        <p className="duel-plate-rating">
            {String(bot.ratingAtStart)}
            {movedOver && bot.now !== null ? (
                <>
                    {` `}
                    <span className="note">{words.nowAt(<Rating value={bot.now.rating} provisional={bot.now.provisional} />)}</span>
                </>
            ) : null}
        </p>
    );
}

// The score in a framed cell: the accent while it runs, quiet once over.
function ScoreCell({ duel }: { duel: DuelDetail }) {
    const words = text.duels.page;
    const running = duel.status === `running`;
    const test = duel.kind === `test`;
    // Wins alone, as the scoreboard counts them; the estimate counts a game without a winner as halves.
    const digits = scoreText(duel);
    const live = duel.games.find((game) => game.state === `live`);
    const next = duel.games.find((game) => game.state === `pending`);
    const place = test
        ? words.of(duel.terms.games)
        : running
          ? words.gameOf(live?.game ?? next?.game ?? duel.terms.games, duel.terms.games)
          : duel.status === `finished`
            ? words.final
            : duel.status === `stopped`
              ? words.stopped
              : words.cutShort;
    const [first, second] = digits.split(`-`);
    return (
        <div className={running ? `score-hex` : `score-hex score-hex-over`} role="img" aria-label={words.scoreLabel(first ?? ``, second ?? ``, place)}>
            <svg viewBox="-26 -30 52 60" aria-hidden="true">
                <polygon className="score-frame" points={hexPoints(28)} />
                <polygon className="score-cell" points={hexPoints(24)} />
            </svg>
            <span className="score-text" aria-hidden="true">
                <span className="score-digits">{digits}</span>
                <span className="score-of">{place}</span>
            </span>
        </div>
    );
}

// The games by pair: the first few, and past them the pair under way and the next, the rest a press away.
function Games({ duel }: { duel: DuelDetail }) {
    const words = text.duels.page;
    const [all, setAll] = useState(false);
    const pairs = pairsOf(duel.games);
    const live = pairs.findIndex((pair) => pair.some((game) => game.state === `live`));
    const at = live !== -1 ? live : duel.status === `running` ? pairs.findIndex((pair) => pair.some((game) => game.state === `pending`)) : -1;
    const showAll = (label: string) => (
        <button type="button" className="text-button duel-all" onClick={() => { setAll(true); }}>
            {label}
        </button>
    );
    const pairView = (index: number) => {
        const pair = pairs[index] ?? [];
        return (
            <div key={pair[0]?.game ?? index}>
                {duel.games.length > 1 ? <h3 className="pair-title">{words.pair(index + 1)}</h3> : null}
                <ol className="duel-games">
                    {pair.map((game) => (
                        <li key={game.game}>
                            <GameRow duel={duel} game={game} />
                        </li>
                    ))}
                </ol>
            </div>
        );
    };
    const range = (from: number, to: number) => Array.from({ length: Math.max(0, Math.min(to, pairs.length) - from) }, (_, index) => from + index);
    // The pair under way past the first few stands apart from them, the pairs between folded.
    const apart = !all && at >= pairsShown;
    const head = all ? range(0, pairs.length) : range(0, apart ? pairsShown : Math.max(pairsShown, at + 2));
    const tail = apart ? range(at, at + 2) : [];
    const earlier = apart ? at - pairsShown : 0;
    const later = all ? 0 : pairs.length - (apart ? Math.min(pairs.length, at + 2) : head.length);
    return (
        <section className="duel-section" aria-labelledby="duel-games">
            <h2 id="duel-games" className="section-title">
                {words.games}
            </h2>
            {head.map(pairView)}
            {earlier > 0 ? <p className="note">{words.earlierPairs(earlier, showAll)}</p> : null}
            {tail.map(pairView)}
            {later > 0 ? <p className="note">{earlier > 0 ? words.laterPairs(later) : words.morePairs(later, showAll)}</p> : null}
        </section>
    );
}

function GameRow({ duel, game }: { duel: DuelDetail; game: DuelGame }) {
    const words = text.duels.page;
    const x: DuelSide = game.x;
    const o: DuelSide = x === `first` ? `second` : `first`;
    const names = { x: duel[x].name, o: duel[o].name };
    const live = duel.live.find((entry) => entry.gameId === game.gameId);
    const result: ReactNode =
        game.state === `played` && game.reason !== null
            ? resultSentence({ winner: game.winner === null ? null : sideIn(game, game.winner), reason: game.reason, turns: game.turns ?? 0 }, names)
            : game.state === `live`
              ? live === undefined
                  ? words.liveWord
                  : (
                      <>
                          <strong>{words.liveWord}</strong>, {words.liveGame(turnsOnBoard(live.cells.length), seatName(live.players[live.toMove]))}
                      </>
                  )
              : game.state === `pending`
                ? game.game % 2 === 0
                    ? words.pendingSame
                    : words.pending
                : game.state === `aborted`
                  ? words.aborted
                  : words.notPlayed;
    const body = (
        <>
            <span className="duel-game-n">{String(game.game)}</span>
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
            <span className="note">{game.state === `live` ? words.watch : game.turns === null ? null : words.turns(game.turns)}</span>
        </>
    );
    const kind = game.state === `live` ? `duel-game duel-game-live` : game.state === `played` ? `duel-game` : `duel-game duel-game-todo`;
    return game.gameId === null || game.state === `pending` ? (
        <div className={kind}>{body}</div>
    ) : (
        <Link to={`/game/${encodeURIComponent(game.gameId)}`} className={kind}>
            {body}
        </Link>
    );
}

// The opening of the pair under way, else the last pair's; none before any is drawn.
function Opening({ duel }: { duel: DuelDetail }) {
    const words = text.duels.page;
    const drawn = [...duel.games].reverse().find((game) => game.opening !== null && game.state !== `pending`) ?? duel.games.find((game) => game.opening !== null);
    if (drawn === undefined || drawn.opening === null) return null;
    const first = drawn.game % 2 === 1 ? drawn.game : drawn.game - 1;
    const pair = Math.ceil(drawn.game / 2);
    const live = duel.games.some((game) => game.state === `live` && Math.ceil(game.game / 2) === pair) && duel.games.length > 1;
    const sentence = duel.games.length === 1 ? words.openingSingle : first + 1 > duel.games.length ? words.openingAlone(first) : live ? words.openingLive(pair, first) : words.openingPlayed(first);
    return (
        <section className="duel-section" aria-labelledby="duel-opening">
            <h2 id="duel-opening" className="section-title">
                {words.opening}
            </h2>
            <div className="opening-item">
                <OpeningStones cells={drawn.opening} label={words.openingLabel(pair, drawn.opening.length)} />
                <p className="note">{sentence}</p>
            </div>
        </section>
    );
}

function Versions({ duel }: { duel: DuelDetail }) {
    const words = text.duels.page;
    return (
        <section className="duel-section" aria-labelledby="duel-versions">
            <h2 id="duel-versions" className="section-title">
                {words.versions}
            </h2>
            <dl className="duel-pairs">
                {([`first`, `second`] as const).map((side) => (
                    <div key={side}>
                        <dt>{duel[side].name}</dt>
                        <dd>{duel[side].version ?? words.noVersion}</dd>
                    </div>
                ))}
            </dl>
            <p className="note">{words.versionsNote}</p>
        </section>
    );
}

function Ratings({ duel }: { duel: DuelDetail }) {
    const words = text.duels.page;
    return (
        <section className="duel-section" aria-labelledby="duel-ratings">
            <h2 id="duel-ratings" className="section-title">
                {words.ratings}
            </h2>
            <dl className="duel-pairs">
                {([`first`, `second`] as const).map((side) => {
                    const bot = duel[side];
                    if (bot.ratingAtStart === null || bot.now === null) return null;
                    const moved = bot.now.rating - bot.ratingAtStart;
                    return (
                        <div key={side}>
                            <dt>{bot.name}</dt>
                            <dd>
                                {words.ratingMove(String(bot.ratingAtStart), <Rating value={bot.now.rating} provisional={bot.now.provisional} />)}{` `}
                                <span className={moved > 0 ? `gain` : moved < 0 ? `loss` : undefined}>{moved >= 0 ? words.gain(moved) : words.loss(-moved)}</span>
                            </dd>
                        </div>
                    );
                })}
            </dl>
            <p className="note">{words.ratingsNote}</p>
        </section>
    );
}

// Stop, confirmed inline with its consequence: no further game, the live one plays on.
// Focus stays on a control that is there: Keep playing once armed, Stop again once kept.
function StopDuel({ duel, onStopped }: { duel: DuelDetail; onStopped: (duel: DuelDetail) => void }) {
    const words = text.duels.page;
    const ids = useId();
    const [armed, setArmed] = useState(false);
    const [sending, setSending] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const keep = useRef<HTMLButtonElement>(null);
    const stop = useRef<HTMLButtonElement>(null);
    const moved = useRef<`armed` | `kept` | null>(null);
    useEffect(() => {
        const to = moved.current;
        moved.current = null;
        if (to === `armed`) keep.current?.focus();
        if (to === `kept`) stop.current?.focus();
    });
    function arm(next: boolean) {
        moved.current = next ? `armed` : `kept`;
        setArmed(next);
    }
    async function confirm() {
        setSending(true);
        setFailure(null);
        try {
            onStopped(await stopDuel(duel.id));
            return;
        } catch (cause) {
            const wait = limitedFor(cause);
            setFailure(wait === null ? words.stopFailed : text.states.tooMany(wait));
        }
        setSending(false);
        arm(false);
    }
    return (
        <div className="duel-stop">
            {armed ? (
                <>
                    <div className="stop-line">
                        <button type="button" className="btn btn-danger" aria-disabled={sending ? `true` : undefined} aria-describedby={`${ids}-note`} onClick={() => { if (!sending) void confirm(); }}>
                            {words.stop}
                        </button>
                        <button ref={keep} type="button" className="btn btn-ghost" onClick={() => { arm(false); }}>
                            {words.keepPlaying}
                        </button>
                    </div>
                    <p className="note" id={`${ids}-note`}>
                        {words.stopNote}
                    </p>
                </>
            ) : (
                <button ref={stop} type="button" className="btn btn-ghost" onClick={() => { arm(true); }}>
                    {duel.kind === `test` ? words.stopTest : words.stopDuel}
                </button>
            )}
            {failure === null ? null : <p className="field-error">{failure}</p>}
        </div>
    );
}

// After the end: the same bots and terms in the setup again, or, for the test's owner, the same test run once more.
function Again({ duel, viewer }: { duel: DuelDetail; viewer: string | null }) {
    const words = text.duels.page;
    const [failure, setFailure] = useState<ReactNode>(null);
    const [sending, setSending] = useState(false);
    if (duel.kind !== `test`) {
        return (
            <Link to={againPath(duel)} className="btn btn-ghost">
                {words.again}
            </Link>
        );
    }
    // Only the owner of both bots may run a test between them, closed to others or not.
    if (viewer === null || viewer !== duel.first.ownerName) return null;
    async function run() {
        setSending(true);
        setFailure(null);
        try {
            const created = await createDuel({
                first: duel.first.name,
                second: duel.second.name,
                games: estimateMoreGames,
                openingPlies: duel.terms.openingPlies,
                timeControl: duel.terms.timeControl,
                levels: { ...(duel.first.level === undefined ? {} : { first: duel.first.level.id }), ...(duel.second.level === undefined ? {} : { second: duel.second.level.id }) },
                rated: false,
            });
            navigate(duelPagePath(created.id));
        } catch (cause) {
            const found = namesABot(cause) ? await refusalReads(viewer) : null;
            const listed = (name: string) => found?.bots.find((bot) => nameKeyOf(bot.name) === nameKeyOf(name));
            const one = listed(duel.first.name);
            const two = listed(duel.second.name);
            const terms = { clock: duel.terms.timeControl, levelled: duel.first.level !== undefined ? (`first` as const) : duel.second.level !== undefined ? (`second` as const) : null };
            const named = (code: string): Refused => (found === null || one === undefined || two === undefined ? { bot: duel.second.name, why: null } : refusedBot(code, [one, two], terms, found.reads));
            setFailure(await refusalLine(cause, { first: duel.first.name, second: duel.second.name }, named, text.duels.errors.failedTest));
            setSending(false);
        }
    }
    return (
        <div className="duel-stop">
            <button type="button" className="btn btn-ghost" aria-disabled={sending ? `true` : undefined} onClick={() => { if (!sending) void run(); }}>
                {words.runMore(estimateMoreGames)}
            </button>
            {failure === null ? null : (
                <p className="field-error" role="alert">
                    {failure}
                </p>
            )}
        </div>
    );
}
