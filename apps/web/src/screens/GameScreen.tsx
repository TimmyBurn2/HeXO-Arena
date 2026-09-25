import { useState } from 'react';
import type { GameSnapshot, Side } from '@hexarena/contract';
import { BotBadge, provisionalNote } from '../components/player';
import { ErrorFrame, SkeletonRows } from '../components/states';
import { Link } from '../router/Link';
import { useRoute } from '../router/use-route';
import { useDocumentMeta } from '../use-document-meta';
import { Clock } from '../game/Clock';
import { GameBoard } from '../game/GameBoard';
import { useGame, type GameSend } from '../game/use-game';
import { feedOf, positionOf, reasonText, resultSentence, stonesOf, winLineOf } from '../game/snapshot-views';
import './GameScreen.css';

export function GameScreen({ gameId }: { gameId: string }) {
    const game = useGame(gameId);

    if (game.state === `loading`) return <SkeletonRows />;
    if (game.state === `missing`) return <MissingGame />;
    if (game.state === `error`) return <ErrorFrame sentence="the game did not load" onRetry={game.retry} />;
    return <GameView snapshot={game.snapshot} send={game.send} />;
}

function MissingGame() {
    return (
        <div className="empty">
            <h1>no such game of yours</h1>
            <div className="actions">
                <Link to="/" className="btn btn-ghost">
                    Arena
                </Link>
            </div>
        </div>
    );
}

function GameView({ snapshot, send }: { snapshot: GameSnapshot; send: GameSend }) {
    const route = useRoute();
    const running = snapshot.status === `in-progress`;
    const you = snapshot.you;
    const yourMove = running && snapshot.toMove === you;
    const stones = stonesOf(snapshot);
    const feed = feedOf(snapshot);
    const [resignArmed, setResignArmed] = useState(false);
    const [resigning, setResigning] = useState(false);

    useDocumentMeta(route, titleOf(snapshot), descriptionOf(snapshot));

    async function confirmResign() {
        if (!resignArmed) {
            setResignArmed(true);
            return;
        }
        setResigning(true);
        await send.resign();
        setResigning(false);
        setResignArmed(false);
    }

    return (
        <>
            <h1 className="screen-title">
                {you === `x` ? `you` : snapshot.opponent.name} vs {you === `o` ? `you` : snapshot.opponent.name}
            </h1>
            <div className="game-grid">
                <div className="game-main">
                    <PlayerStrip snapshot={snapshot} side={you === `x` ? `o` : `x`} />

                    {running ? null : (
                        <div className="banner">
                            <span className="result">{resultSentence(snapshot)}</span>
                            <span className="note">finished</span>
                        </div>
                    )}

                    <GameBoard
                        stones={stones}
                        position={positionOf(snapshot)}
                        you={you}
                        lastMove={running ? stones.slice(-2) : []}
                        winLine={winLineOf(snapshot) ?? []}
                        yourMove={yourMove}
                        opponentMoving={running && !yourMove}
                        opponentName={snapshot.opponent.name}
                        onCommit={send.playMove}
                    />

                    <PlayerStrip
                        snapshot={snapshot}
                        side={you}
                        actions={
                            running ? (
                                <button
                                    type="button"
                                    className="btn btn-danger btn-sm"
                                    disabled={resigning}
                                    onClick={() => void confirmResign()}
                                >
                                    {resignArmed ? `Confirm resign` : `Resign`}
                                </button>
                            ) : undefined
                        }
                    />

                    {running ? null : (
                        <p className="note">
                            stones numbered by placement when numbers are on; the theme and
                            board settings live in <Link to="/profile">Profile</Link>
                        </p>
                    )}
                </div>

                <aside className="feed" aria-label="Moves">
                    <h2>moves</h2>
                    {feed.map((line) => (
                        <div className="line" key={`${line.label}-${line.text}`}>
                            <span className="n label">{line.label}</span>
                            <span>{line.text}</span>
                        </div>
                    ))}
                </aside>
            </div>
        </>
    );
}

function PlayerStrip({ snapshot, side, actions }: {
    snapshot: GameSnapshot;
    side: Side;
    actions?: React.ReactNode;
}) {
    const running = snapshot.status === `in-progress`;
    const active = running && snapshot.toMove === side;
    const you = side === snapshot.you;
    const clock = clockOf(snapshot, side, active, running);

    return (
        <div className="strip">
            <span className="who">
                {you ? (
                    <strong>you</strong>
                ) : (
                    <>
                        <strong>{snapshot.opponent.name}</strong>
                        <BotBadge />
                        <span className="note">
                            {String(snapshot.opponent.rating)}
                            {snapshot.opponent.provisional ? (
                                <span className="prov" title={provisionalNote}>
                                    ?
                                </span>
                            ) : null}
                        </span>
                    </>
                )}
                <span className="note">
                    {`, ${side}`}
                    {active ? (you ? `, your move: two stones` : `, their move`) : ``}
                </span>
            </span>
            <span className="actions">
                {clock}
                {actions}
            </span>
        </div>
    );
}

function clockOf(snapshot: GameSnapshot, side: Side, active: boolean, running: boolean): React.ReactNode {
    if (snapshot.status !== `in-progress`) {
        const frozen = snapshot.clock;
        if (frozen === undefined || frozen.mode !== `match`) return null;
        return <Clock remainingMs={frozen.remainingMainMs[side]} running={running && active} />;
    }
    const clock = snapshot.clock;
    if (clock.mode === `match`) {
        return <Clock remainingMs={clock.remainingMainMs[side]} running={running && active} />;
    }
    if (clock.mode === `turn`) {
        return active ? <Clock remainingMs={clock.remainingTurnMs} running={running} /> : null;
    }
    return null;
}

function titleOf(snapshot: GameSnapshot): string {
    const opponent = snapshot.opponent.name;
    if (snapshot.status === `finished`) {
        if (snapshot.winner === null) {
            return `nobody won (${reasonText(snapshot.reason)}) - hexarena`;
        }
        if (snapshot.winner === snapshot.you) {
            return `you won (${reasonText(snapshot.reason)}) - hexarena`;
        }
        return `${opponent} won (${reasonText(snapshot.reason)}) - hexarena`;
    }
    return snapshot.you === `x` ? `you vs ${opponent} - hexarena` : `${opponent} vs you - hexarena`;
}

function descriptionOf(snapshot: GameSnapshot): string {
    if (snapshot.status === `finished`) {
        return resultSentence(snapshot);
    }
    return `${snapshot.clock.mode} clock game against ${snapshot.opponent.name}`;
}

