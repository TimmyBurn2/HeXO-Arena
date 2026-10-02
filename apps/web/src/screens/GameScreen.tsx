import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { clockText, gameMeta, levelFacts, turnsOnBoard, type FinishedGamesRecord, type GameHeadline, type GameSnapshot } from '@hexo-arena/contract';
import { useSeatBroadcast } from '../analysis/seat-channel';
import { gameLink } from '../analysis/links';
import { fetchFinishedGames } from '../api/client';
import { BotBadge, PlayerName, seatName, seatsRateNobody, Swatch } from '../components/player';
import { useWait, WaitText } from '../components/wait';
import { gamesPathOf } from '../games/filters';
import { Link } from '../router/Link';
import { useBorrowFrame } from '../frame';
import { routeMeta } from '../route-meta';
import { useRoute } from '../router/use-route';
import { text } from '../text';
import { useDocumentMeta } from '../use-document-meta';
import { GameBoard, type TurnStatus } from '../game/GameBoard';
import { FeedLabel, GameDrawer } from '../game/GameDrawer';
import { clockOf, Pips, SeatChip, TurnChip, YouChip } from '../game/GameHud';
import { PeekGraph, PeekReadout, ReadingHead, type Asker } from '../game/DrawerAnalysis';
import { lastTurnOf, turnOf, useReplay, type Replay } from '../game/replay';
import { Scrubber } from '../game/Scrubber';
import { Rundown } from '../game/Rundown';
import { useRundown } from '../game/rundown';
import { useDrawer } from '../game/use-drawer';
import { useGameReading } from '../game/use-game-reading';
import { selfName, useMe, type MeState } from '../me';
import { useGame, type GameLink, type GameSend, type Refusal } from '../game/use-game';
import { feedOf, matchName, otherSide, positionOf, resultLine, seatNames, stonesOf, winLineOf } from '../game/snapshot-views';
import { NotFoundScreen } from './NotFoundScreen';
import './GameScreen.css';

export function GameScreen({ gameId }: { gameId: string }) {
    const game = useGame(gameId);

    if (game.state === `loading`) return <LoadingStage />;
    if (game.state === `missing`) return <MissingGame />;
    if (game.state === `error`) return <FailedStage retry={game.retry} wait={game.wait} />;
    return <GameView snapshot={game.snapshot} send={game.send} link={game.link} />;
}

// The stage has no nav, so a game that did not load also offers the way out.
function FailedStage({ retry, wait }: { retry: () => void; wait: Refusal | null }) {
    const limited = useWait();
    const { start } = limited;
    useEffect(() => {
        if (wait !== null) start(wait.seconds);
    }, [wait, start]);
    const holding = limited.wait !== null;
    return (
        <div className="stage-message">
            <div className="empty">
                <h1>{text.game.failed}</h1>
                <div role="status">{limited.wait === null ? null : <p className="note"><WaitText wait={limited.wait} line={text.states.tooMany} /></p>}</div>
                <div className="actions">
                    <button
                        type="button"
                        className="btn btn-primary"
                        aria-disabled={holding ? `true` : undefined}
                        onClick={() => {
                            if (!holding) retry();
                        }}
                    >
                        {text.states.tryAgain}
                    </button>
                    <Link to="/" className="btn btn-ghost">
                        {text.game.home}
                    </Link>
                </div>
            </div>
        </div>
    );
}

// The stage's shape before the snapshot lands, so nothing jumps when it does.
function LoadingStage() {
    return (
        <div className="stage" aria-busy="true">
            <div className="hud-lift hud-top-left">
                <div className="hud-chip hud-skeleton" />
            </div>
            <div className="hud-lift hud-bottom-left">
                <div className="hud-chip hud-skeleton" />
            </div>
        </div>
    );
}

// A game that does not exist has no board to show, so it takes the frame
// and reads as any other missing page.
function MissingGame() {
    const route = useRoute();
    const meta = routeMeta({ name: `not-found` });
    useBorrowFrame();
    useDocumentMeta(route, meta.title, meta.description);
    return <NotFoundScreen heading={text.game.missingHeading} sentence={text.game.missingSentence} />;
}

const idleStatus: TurnStatus = { placed: 0, note: null, wait: null };

// The camera frames the latest position while the board follows it; a
// watcher who steps back holds the frame they left, so stones landing
// meanwhile never move the board under them, and it widens only as they
// step past it.
function useHeldFrame<T>(stones: readonly T[], replay: Replay): readonly T[] {
    const [heldAt, setHeldAt] = useState(stones.length);
    if (replay.following && heldAt !== stones.length) setHeldAt(stones.length);
    const length = replay.following ? stones.length : Math.max(heldAt, replay.shown);
    return length === stones.length ? stones : stones.slice(0, length);
}

// A result wraps to as many rows as its names need, so under a finished
// game the game screen measures its chip: one that would come nearer the
// seat chip than the seat chip sits to the edge stacks above it, and the
// camera clears the chip's reach when that passes the fixed allowance.
// A running game keeps the allowance, so a note never moves the board
// under the player's hand.
function useResultReach(finished: boolean) {
    const ref = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const host = ref.current;
        if (!finished || host === null || typeof ResizeObserver === `undefined`) return;
        const chip = host.querySelector(`.hud-bottom-center`);
        if (chip === null) return;
        const observer = new ResizeObserver(() => {
            const area = host.getBoundingClientRect();
            const seat = host.querySelector(`.hud-bottom-left`)?.getBoundingClientRect();
            // Stacking only lifts the chip, so the reading holds once stacked.
            const own = chip.getBoundingClientRect();
            const meets = seat !== undefined && seat.width > 0 && own.left < seat.right + (seat.left - area.left);
            host.toggleAttribute(`data-stacked`, meets);
            const reach = area.bottom - chip.getBoundingClientRect().top;
            host.style.setProperty(`--hud-reach`, `${String(Math.ceil(reach))}px`);
        });
        observer.observe(host);
        observer.observe(chip);
        return () => {
            observer.disconnect();
            host.removeAttribute(`data-stacked`);
            host.style.removeProperty(`--hud-reach`);
        };
    }, [finished]);
    return ref;
}

// The rundown's card floats under the top chips before the first turn, so
// the camera measures where it ends and keeps the position below it.
// A card reaching past half the stage, as large text makes it, would
// leave the board too little room, so it gives the stage up.
// The reach lands a frame later, so the board's own observer never sees
// its camera change inside the frame that measured the card.
function useRundownReach(host: RefObject<HTMLDivElement | null>, shown: boolean, crowded: () => void) {
    useLayoutEffect(() => {
        const stage = host.current;
        if (!shown || stage === null || typeof ResizeObserver === `undefined`) return;
        const card = stage.querySelector(`.hud-rundown`);
        if (card === null) return;
        let frame = 0;
        const observer = new ResizeObserver(() => {
            const area = stage.getBoundingClientRect();
            const reach = card.getBoundingClientRect().bottom - area.top;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                if (reach > area.height / 2) crowded();
                else stage.style.setProperty(`--rundown-reach`, `${String(Math.ceil(reach))}px`);
            });
        });
        observer.observe(stage);
        observer.observe(card);
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            stage.style.removeProperty(`--rundown-reach`);
        };
    }, [host, shown, crowded]);
}

// Typing into a field never opens the drawer.
function typingInto(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || [`INPUT`, `TEXTAREA`, `SELECT`].includes(target.tagName));
}

// A watcher holds no seat: the same regions with the actions gone, x on
// the bottom chip and o on the top one.
// A finished game, and a live one to a watcher, replays: the board shows the
// position the reader steps to, inside the camera of the latest one.
function GameView({ snapshot, send, link }: { snapshot: GameSnapshot; send: GameSend; link: GameLink }) {
    const route = useRoute();
    const drawer = useDrawer();
    const me = useMe();
    const you = snapshot.you ?? null;
    const bottom = you ?? `x`;
    const running = snapshot.status === `in-progress`;
    useSeatBroadcast(running && you !== null ? snapshot.gameId : null);
    const yourMove = running && snapshot.toMove === you;
    const stones = useMemo(() => stonesOf(snapshot), [snapshot]);
    const feed = feedOf(snapshot);
    const replaying = !running || you === null;
    const opening = snapshot.openingPlies;
    const total = snapshot.board.cells.length;
    const range = useMemo(() => ({ opening, total }), [opening, total]);
    const replay = useReplay(range, replaying);
    const shownStones = useMemo(() => (replaying ? stones.slice(0, replay.shown) : stones), [replaying, stones, replay.shown]);
    const frameStones = useHeldFrame(stones, replay);
    const atEnd = replay.shown >= total;
    const winLine = atEnd ? (winLineOf(snapshot) ?? []) : [];
    // The feed's first line is the whole opening, then one line a turn.
    const currentLine = replay.shown <= opening ? 0 : turnOf(replay.shown) - turnOf(opening);
    const [status, setStatus] = useState<TurnStatus>(idleStatus);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const openedByHover = useRef(false);
    const finishedShown = useRef(!running);
    const host = useResultReach(!running);
    const meetings = useMeetings(snapshot);
    const rundown = useRundown(snapshot.players, running);
    const [rundownHidden, setRundownHidden] = useState(false);
    // Before the first turn only the opening stands on the board.
    const rundownShown = running && total <= opening && !rundownHidden;
    const crowdRundown = useCallback(() => {
        setRundownHidden(true);
    }, []);
    useRundownReach(host, rundownShown, crowdRundown);
    const meetingsLine =
        meetings === null || meetings.record.games === 0 ? null : (
            <>
                {text.games.meetings(
                    <PlayerName name={meetings.x.name} kind={meetings.x.kind} />,
                    <PlayerName name={meetings.o.name} kind={meetings.o.kind} />,
                    meetings.record.won,
                    meetings.record.lost,
                    (words) => <Link to={gamesPathOf(meetings.x.name, meetings.o.name)}>{words}</Link>,
                    meetings.record.games,
                )}
                {meetings.record.voided === 0 ? null : `; ${text.games.voidedLeftOut(meetings.record.voided)}`}
            </>
        );

    const reading = useGameReading({ snapshot, replay, shownStones, feedLines: feed.length, currentLine });
    const { line, head, active, view } = reading;
    const peekReading =
        line !== null && (view !== null || head?.card?.kind === `queued` || head?.card?.kind === `running`) ? (
            <PeekReadout card={head?.card ?? null} view={view} choice={active} turn={reading.turn} players={snapshot.players} />
        ) : null;

    const meta = gameMeta(headlineOf(snapshot));
    useDocumentMeta(route, meta.title, meta.description);

    const onStatus = useCallback((next: TurnStatus) => {
        setStatus(next);
    }, []);

    // The game's end opens the record once, so the result has its story;
    // a watcher stepped back is reading an earlier turn, so the record
    // stays as they left it.
    const show = drawer.show;
    const following = replay.following;
    useEffect(() => {
        if (!running && !finishedShown.current) {
            finishedShown.current = true;
            if (following) show(`moves`);
        }
    }, [running, following, show]);

    const toggle = drawer.toggle;
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if (event.key !== `m` || event.metaKey || event.ctrlKey || event.altKey || typingInto(event.target)) return;
            event.preventDefault();
            toggle();
        }
        window.addEventListener(`keydown`, onKey);
        return () => {
            window.removeEventListener(`keydown`, onKey);
        };
    }, [toggle]);

    // Your move puts the keyboard on the board.
    useEffect(() => {
        if (yourMove) document.querySelector<HTMLElement>(`.board-control`)?.focus({ preventScroll: true });
    }, [yourMove]);

    // A replay opens with the keyboard on its scrubber, whichever of the
    // chip's and the sheet's shows at this width.
    const openedReplaying = useRef(replaying);
    useEffect(() => {
        if (!openedReplaying.current) return;
        const shown = [...document.querySelectorAll<HTMLElement>(`.scrub-count`)].find((slider) => slider.offsetParent !== null);
        shown?.focus({ preventScroll: true });
    }, []);

    function hoverEdge() {
        if (drawer.visible) return;
        hoverTimer.current = setTimeout(() => {
            openedByHover.current = true;
            drawer.show(undefined, `hover`);
        }, 150);
    }

    function leaveEdge() {
        if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    }

    function leaveDrawer() {
        if (openedByHover.current) {
            openedByHover.current = false;
            drawer.hide();
        }
    }

    // On a phone the open sheet covers the result chip, so a finished game
    // puts its result in the peek while the sheet is up, and the last move
    // otherwise, as a running one does.
    // The Game tab states the result in its own row, so there the peek
    // keeps the last move and the sentence appears once.
    const last = feed.at(-1);
    const showResult = !running && drawer.visible && drawer.tab !== `game`;
    // A replay's peek holds its steps and its count, so a phone steps
    // through the game with the sheet up or down; a press there never
    // reaches the peek's own toggle.
    const peekLine = replaying ? (
        <>
            <span
                className="peek-scrub"
                onClick={(event) => {
                    event.stopPropagation();
                }}
            >
                <Scrubber replay={replay} live={running} compact />
            </span>
            {showResult ? <span className="peek-line peek-result">{resultLine(snapshot)}</span> : null}
        </>
    ) : showResult ? (
        <span className="peek-line peek-result">{resultLine(snapshot)}</span>
    ) : last === undefined ? null : (
        <span className="peek-line">
            <FeedLabel line={last} /> {last.groups.join(` `)}
        </span>
    );
    const peek = (
        <div className="peek-row">
            <span className="peek-who">
                <Swatch side={bottom} />
                {you === null ? (
                    <span className="hud-name">
                        <span className={snapshot.players[bottom].deleted === true ? `deleted-name` : undefined}>{seatName(snapshot.players[bottom])}</span>
                        {snapshot.players[bottom].kind === `bot` ? <BotBadge /> : null}
                    </span>
                ) : (
                    <span className="hud-name">{selfName(me)}</span>
                )}
            </span>
            {clockOf(snapshot, bottom)}
            {yourMove ? <Pips placed={status.placed} /> : null}
            {peekLine}
            {peekReading}
        </div>
    );
    const peekGraph =
        line !== null && view !== null && active !== null ? (
            <div className="peek-graph">
                <PeekGraph view={view} choice={active} line={line} cursor={reading.turn} />
            </div>
        ) : null;

    return (
        <div
            className="stage"
            data-pinned={drawer.pinned ? `` : undefined}
            data-open={drawer.visible && !drawer.pinned ? `` : undefined}
            data-replay={replaying ? `` : undefined}
            data-peek-reading={peekReading === null ? undefined : view === null ? `line` : `graph`}
        >
            <h1 className="sr-only">{headingOf(snapshot)}</h1>
            <div className="board-host" ref={host} data-rundown={rundownShown ? `` : undefined}>
                <GameBoard
                    stones={shownStones}
                    frameStones={replaying ? frameStones : undefined}
                    position={positionOf(snapshot)}
                    you={you}
                    lastMove={replaying ? (winLine.length === 0 ? lastTurnOf(stones, replay.shown, range) : []) : stones.slice(-2)}
                    winLine={winLine}
                    yourMove={yourMove}
                    finished={!running}
                    idleLabel={idleLabelOf(snapshot)}
                    lines={reading.board?.lines}
                    judgment={reading.board?.judgment}
                    onCommit={send.playMove}
                    onStatus={onStatus}
                />
                <SeatChip snapshot={snapshot} side={otherSide(bottom)} corner="top" />
                <div className="hud-lift hud-top-right">
                    <button
                        type="button"
                        id="drawer-toggle"
                        className="hud-chip hud-toggle"
                        aria-expanded={drawer.visible}
                        aria-controls="game-drawer"
                        aria-label={text.game.panelToggle}
                        onClick={drawer.toggle}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16M4 12h16M4 17h10" />
                        </svg>
                    </button>
                </div>
                {you === null ? (
                    <SeatChip snapshot={snapshot} side={bottom} corner="bottom" />
                ) : (
                    <YouChip snapshot={snapshot} you={you} me={me} />
                )}
                <TurnChip snapshot={snapshot} you={you} link={link} status={yourMove ? status : idleStatus} replay={replaying ? replay : null} />
                {rundownShown ? (
                    <div className="hud-lift hud-rundown">
                        <div className="hud-chip">
                            <Rundown
                                players={snapshot.players}
                                data={rundown}
                                meetings={
                                    meetings === null ? null : meetings.record.games === 0 ? (
                                        text.rundown.firstMeeting(
                                            <PlayerName name={meetings.x.name} kind={meetings.x.kind} />,
                                            <PlayerName name={meetings.o.name} kind={meetings.o.kind} />,
                                        )
                                    ) : (
                                        meetingsLine
                                    )
                                }
                                onHide={() => {
                                    // The button leaves with the card, so the keyboard goes back to the board.
                                    host.current?.querySelector<HTMLElement>(`.board-control`)?.focus({ preventScroll: true });
                                    setRundownHidden(true);
                                }}
                            />
                        </div>
                    </div>
                ) : null}
                <div className="hot-edge" aria-hidden="true" onMouseEnter={hoverEdge} onMouseLeave={leaveEdge} />
            </div>
            <div className="drawer-slot" onMouseLeave={leaveDrawer}>
                <GameDrawer
                    drawer={drawer}
                    feed={feed}
                    current={replaying ? currentLine : feed.length - 1}
                    notes={reading.notes}
                    onLine={line === null ? null : reading.goToLine}
                    onPoint={reading.point}
                    head={
                        line === null ? null : (
                            <ReadingHead
                                state={reading.state}
                                head={head}
                                active={active}
                                onChoose={reading.choose}
                                view={view}
                                line={line}
                                players={snapshot.players}
                                cursor={reading.turn}
                                asker={askerOf(me)}
                                onRequest={reading.request}
                                onRetry={reading.retry}
                                onTurn={reading.goToTurn}
                            />
                        )
                    }
                    facts={factsOf(snapshot)}
                    meetings={meetingsLine}
                    rundown={running && !rundownShown ? <Rundown players={snapshot.players} data={rundown} meetings={null} /> : null}
                    tournament={snapshot.tournament === undefined ? null : (
                        <Link to={`/tournaments/${encodeURIComponent(snapshot.tournament.id)}`}>
                            {text.drawer.tournamentGame(snapshot.tournament.name, snapshot.tournament.round, snapshot.tournament.game)}
                        </Link>
                    )}
                    analysis={running ? null : gameLink(snapshot.gameId, turnOf(replay.shown))}
                    running={running}
                    timed={snapshot.clock !== undefined && snapshot.clock.mode !== `unlimited`}
                    onResign={you === null ? null : send.resign}
                    peek={
                        <>
                            {peek}
                            {peekGraph}
                        </>
                    }
                />
            </div>
        </div>
    );
}

// Who may ask for a reading: a signed-in user, with the day's requests left; anyone else signs in first.
function askerOf(me: MeState): Asker {
    if (me.status === `loading`) return { kind: `unknown` };
    return me.me?.kind === `user` ? { kind: `user`, left: me.me.analysisLeft.games } : { kind: `signed-out` };
}

/** Two players' record against each other, as x's. */
interface Meetings {
    readonly x: { readonly name: string; readonly kind: `bot` | `human` };
    readonly o: { readonly name: string; readonly kind: `bot` | `human` };
    readonly record: FinishedGamesRecord;
}

// A guest or a deleted player is no name the history takes, so neither
// seat has a record to read; the record is read again at the finish,
// which adds this game to it.
function useMeetings(snapshot: GameSnapshot): Meetings | null {
    const { x, o } = snapshot.players;
    const seated = (player: typeof x) => ({ name: player.name, kind: player.kind === `bot` ? (`bot` as const) : (`human` as const) });
    const kept = [x, o].every((player) => player.kind !== `guest` && player.deleted !== true);
    const finished = snapshot.status === `finished`;
    const [meetings, setMeetings] = useState<Meetings | null>(null);
    useEffect(() => {
        if (!kept) return;
        let cancelled = false;
        fetchFinishedGames({ player: x.name, vs: o.name }).then(
            (page) => {
                if (!cancelled && page.record !== undefined) setMeetings({ x: seated(x), o: seated(o), record: page.record });
            },
            // The line is extra; a read that fails leaves it out.
            () => undefined,
        );
        return () => {
            cancelled = true;
        };
    }, [kept, x.name, o.name, finished]);
    return meetings;
}

function factsOf(snapshot: GameSnapshot): (readonly [string, string])[] {
    // A finished game whose clock went with its process has no clock to name.
    const facts: (readonly [string, string])[] =
        snapshot.clock === undefined ? [] : [[text.drawer.clock, text.drawer.clockValue(clockText(snapshot.clock.mode))]];
    facts.push([text.drawer.opening, text.drawer.openingStones(snapshot.openingPlies)]);
    for (const player of [snapshot.players.x, snapshot.players.o]) {
        if (player.level !== undefined) facts.push([text.drawer.strength, text.drawer.strengthValue(player.level.label, levelFacts(player.level))]);
    }
    const voided = snapshot.status === `finished` && snapshot.voided;
    const guest = snapshot.players.x.kind === `guest` || snapshot.players.o.kind === `guest`;
    const practice = !guest && seatsRateNobody(snapshot.players);
    if (snapshot.you === undefined) {
        const unratedGuest = snapshot.status === `finished` ? text.drawer.ratedNoGuestPlayed : text.drawer.ratedNoGuest;
        facts.push([text.drawer.rated, guest ? unratedGuest : practice ? text.drawer.ratedNoPractice : voided ? text.drawer.ratedNoVoided : text.drawer.ratedYes]);
    } else {
        facts.push([text.drawer.yourSide, snapshot.you]);
        // A seated player's own game needs no Rated row until the operator
        // voids it, unless a bot level made it practice.
        if (practice) facts.push([text.drawer.rated, text.drawer.ratedNoPractice]);
        else if (voided) facts.push([text.drawer.rated, text.drawer.ratedNoVoided]);
    }
    if (snapshot.status === `finished`) facts.push([text.drawer.result, resultLine(snapshot)]);
    return facts;
}

// The seated player reads the game from their own side; a watcher reads it
// as x against o.
function headingOf(snapshot: GameSnapshot): string {
    const you = snapshot.you;
    if (you === undefined) return matchName(snapshot);
    const opponent = seatName(snapshot.players[otherSide(you)]);
    return you === `x` ? text.game.vs(text.game.you, opponent) : text.game.vs(opponent, text.game.you);
}

function idleLabelOf(snapshot: GameSnapshot): string {
    const state =
        snapshot.status === `finished`
            ? text.drawer.boardFinished
            : snapshot.you === undefined
              ? text.drawer.boardToMove(seatName(snapshot.players[snapshot.toMove]))
              : text.drawer.boardWaiting(seatName(snapshot.players[snapshot.toMove]));
    return snapshot.you === undefined ? text.drawer.boardWatching(matchName(snapshot), state) : state;
}

// The game as its preview reads it: names only, then the live state or
// the result; the snapshot names the clock's mode, not its settings.
function headlineOf(snapshot: GameSnapshot): GameHeadline {
    const names = seatNames(snapshot);
    return snapshot.status === `finished`
        ? { status: `finished`, names, winner: snapshot.winner, reason: snapshot.reason, turns: turnsOnBoard(snapshot.board.cells.length) }
        : { status: `live`, names, toMove: snapshot.toMove, timeControl: snapshot.timeControl };
}
