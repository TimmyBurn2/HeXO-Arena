import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameSnapshot } from '@hexarena/contract';
import { BotBadge, Swatch } from '../components/player';
import { ErrorFrame } from '../components/states';
import { useBorrowFrame } from '../frame';
import { routeMeta } from '../route-meta';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';
import { GameBoard, type TurnStatus } from '../game/GameBoard';
import { FeedLabel, GameDrawer } from '../game/GameDrawer';
import { clockModeText, clockOf, Pips, SeatChip, TurnChip, YouChip } from '../game/GameHud';
import { useDrawer } from '../game/use-drawer';
import { selfName, useMe } from '../me';
import { useGame, type GameLink, type GameSend } from '../game/use-game';
import {
    feedOf,
    matchName,
    otherSide,
    positionOf,
    reasonText,
    resultLine,
    resultSentence,
    stonesOf,
    winLineOf,
} from '../game/snapshot-views';
import { NotFoundScreen } from './NotFoundScreen';
import './GameScreen.css';

export function GameScreen({ gameId }: { gameId: string }) {
    const game = useGame(gameId);

    if (game.state === `loading`) return <LoadingStage />;
    if (game.state === `missing`) return <MissingGame />;
    if (game.state === `error`) {
        return (
            <div className="stage-message">
                <ErrorFrame sentence="The game did not load" onRetry={game.retry} />
            </div>
        );
    }
    return <GameView snapshot={game.snapshot} send={game.send} link={game.link} />;
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
    return <NotFoundScreen heading="No such game" sentence="That game does not exist." />;
}

const idleStatus: TurnStatus = { placed: 0, note: null };

// Typing into a field never opens the drawer.
function typingInto(target: EventTarget | null): boolean {
    return target instanceof HTMLElement && (target.isContentEditable || [`INPUT`, `TEXTAREA`, `SELECT`].includes(target.tagName));
}

// A watcher holds no seat: the same regions with the actions gone, x on
// the bottom chip and o on the top one.
function GameView({ snapshot, send, link }: { snapshot: GameSnapshot; send: GameSend; link: GameLink }) {
    const route = useRoute();
    const drawer = useDrawer();
    const me = useMe();
    const you = snapshot.you ?? null;
    const bottom = you ?? `x`;
    const running = snapshot.status === `in-progress`;
    const yourMove = running && snapshot.toMove === you;
    const stones = stonesOf(snapshot);
    const feed = feedOf(snapshot);
    const [status, setStatus] = useState<TurnStatus>(idleStatus);
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const openedByHover = useRef(false);
    const finishedShown = useRef(!running);

    useDocumentMeta(route, titleOf(snapshot), descriptionOf(snapshot));

    const onStatus = useCallback((next: TurnStatus) => {
        setStatus(next);
    }, []);

    // The game's end opens the record once, so the result has its story.
    const show = drawer.show;
    useEffect(() => {
        if (!running && !finishedShown.current) {
            finishedShown.current = true;
            show(`moves`);
        }
    }, [running, show]);

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
    const peekLine = showResult ? (
        <span className="peek-line peek-result">{resultLine(snapshot)}</span>
    ) : last === undefined ? null : (
        <span className="peek-line">
            <FeedLabel line={last} /> {last.groups.join(` `)}
        </span>
    );
    const peek = (
        <div className="peek-row">
            <Swatch side={bottom} />
            {you === null ? (
                <span className="hud-name">
                    {snapshot.players[bottom].name}
                    {snapshot.players[bottom].kind === `bot` ? <BotBadge /> : null}
                </span>
            ) : (
                <span className="hud-name">{selfName(me)}</span>
            )}
            {clockOf(snapshot, bottom)}
            {yourMove ? <Pips placed={status.placed} /> : null}
            {peekLine}
        </div>
    );

    return (
        <div
            className="stage"
            data-pinned={drawer.pinned ? `` : undefined}
            data-open={drawer.visible && !drawer.pinned ? `` : undefined}
        >
            <h1 className="sr-only">{headingOf(snapshot)}</h1>
            <div className="board-host">
                <GameBoard
                    stones={stones}
                    position={positionOf(snapshot)}
                    you={you}
                    lastMove={running ? stones.slice(-2) : []}
                    winLine={winLineOf(snapshot) ?? []}
                    yourMove={yourMove}
                    idleLabel={idleLabelOf(snapshot)}
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
                        aria-label="Moves and game"
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
                <TurnChip
                    snapshot={snapshot}
                    you={you}
                    link={link}
                    status={yourMove ? status : idleStatus}
                    onMoves={() => {
                        drawer.show(`moves`);
                    }}
                />
                <div className="hot-edge" aria-hidden="true" onMouseEnter={hoverEdge} onMouseLeave={leaveEdge} />
            </div>
            <div className="drawer-slot" onMouseLeave={leaveDrawer}>
                <GameDrawer
                    drawer={drawer}
                    feed={feed}
                    facts={factsOf(snapshot)}
                    running={running}
                    onResign={you === null ? null : send.resign}
                    peek={peek}
                />
            </div>
        </div>
    );
}

function factsOf(snapshot: GameSnapshot): (readonly [string, string])[] {
    const facts: (readonly [string, string])[] = [
        [`Clock`, clockModeText(snapshot)],
        [`Opening`, snapshot.openingPlies === 1 ? `origin only` : `${String(snapshot.openingPlies)} stones, origin included`],
    ];
    if (snapshot.you === undefined) {
        const guest = snapshot.players.x.kind === `guest` || snapshot.players.o.kind === `guest`;
        facts.push([`Rated`, guest ? `no, a guest plays` : `yes`]);
    } else {
        facts.push([`You play`, snapshot.you]);
    }
    if (snapshot.status === `finished`) facts.push([`Result`, resultLine(snapshot)]);
    return facts;
}

// The seated player reads the game from their own side; a watcher reads it
// as x against o.
function headingOf(snapshot: GameSnapshot): string {
    const you = snapshot.you;
    if (you === undefined) return matchName(snapshot);
    const opponent = snapshot.players[otherSide(you)].name;
    return you === `x` ? `you vs ${opponent}` : `${opponent} vs you`;
}

function idleLabelOf(snapshot: GameSnapshot): string {
    const state =
        snapshot.status === `finished`
            ? `game finished`
            : snapshot.you === undefined
              ? `${snapshot.players[snapshot.toMove].name} to move`
              : `waiting for ${snapshot.players[snapshot.toMove].name}`;
    return snapshot.you === undefined ? `watching ${matchName(snapshot)}, ${state}` : state;
}

function titleOf(snapshot: GameSnapshot): string {
    if (snapshot.status === `finished`) {
        const winner = snapshot.winner;
        const who = winner === null ? `nobody` : winner === snapshot.you ? `you` : snapshot.players[winner].name;
        return `${who} won (${reasonText(snapshot.reason)}) - hexarena`;
    }
    return `${headingOf(snapshot)} - hexarena`;
}

function descriptionOf(snapshot: GameSnapshot): string {
    if (snapshot.status === `finished`) {
        return resultSentence(snapshot);
    }
    const you = snapshot.you;
    return you === undefined
        ? `${snapshot.clock.mode} clock game, ${matchName(snapshot)}`
        : `${snapshot.clock.mode} clock game against ${snapshot.players[otherSide(you)].name}`;
}
