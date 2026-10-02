import { useCallback, useEffect, useState } from 'react';
import type { AxialCoord, Side } from '@hexo-arena/contract';
import { isWithinPlacementRadius, rejection, type Position } from '@hexo-arena/rules';
import { Board, type BoardStone } from '../board/Board';
import { useBoardSettings } from '../board/board-settings';
import { useBoardCamera } from '../board/camera';
import { text } from '../text';
import { rejectionNote } from './snapshot-views';
import type { Sent } from './use-game';
import { useWait, type Wait } from '../components/wait';
import './GameBoard.css';

const sixKeys: Record<string, AxialCoord> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    q: { x: 1, y: -1 },
    e: { x: -1, y: 1 },
};

/** What the board tells the rest of the screen about the turn in hand. */
export interface TurnStatus {
    placed: 0 | 1;
    note: string | null;
    wait: Wait | null;
}

/**
 * The interactive board: six-key cell focus, two-stone selection with a
 * pending ring, and a locally validated commit, so the server's move
 * rejections are unreachable by construction.
 * The camera fits the whole frontier when every cell stays at its minimum
 * size and scrolls natively otherwise; it refits between turns, never
 * while placing.
 * A replay shows fewer stones than `frameStones`, the position the camera
 * frames, so stones never jump as the reader steps through the game.
 */
export function GameBoard({
    stones,
    frameStones,
    position,
    you,
    lastMove,
    winLine,
    yourMove,
    finished,
    idleLabel,
    onCommit,
    onStatus,
}: {
    stones: readonly BoardStone[];
    frameStones?: readonly BoardStone[] | undefined;
    position: Position;
    // Null for a watcher, who never marks a stone.
    you: Side | null;
    lastMove: readonly AxialCoord[];
    winLine: readonly AxialCoord[];
    yourMove: boolean;
    finished: boolean;
    // What the board's accessible name says whenever it is not your move.
    idleLabel: string;
    onCommit: (cells: readonly [AxialCoord, AxialCoord]) => Promise<Sent>;
    onStatus?: ((status: TurnStatus) => void) | undefined;
}) {
    const [settings] = useBoardSettings();
    const [focus, setFocus] = useState<AxialCoord>(() => stones.at(-1) ?? { x: 0, y: 0 });
    const [pending, setPending] = useState<AxialCoord | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const limited = useWait();
    const { start: startWait, clear: clearWait } = limited;
    const waiting = limited.wait !== null;
    const [sending, setSending] = useState(false);
    const camera = useBoardCamera(frameStones ?? stones, finished);
    const cameraRef = camera.ref;

    useEffect(() => {
        onStatus?.({ placed: pending === null ? 0 : 1, note, wait: limited.wait });
    }, [pending, note, limited.wait, onStatus]);

    // The opponent's move or the finish leaves the board static.
    useEffect(() => {
        if (!yourMove) {
            setPending(null);
            setNote(null);
            clearWait();
        }
    }, [yourMove, clearWait]);

    const tryMark = useCallback(
        (cell: AxialCoord) => {
            if (!yourMove || sending) return;
            if (pending !== null && pending.x === cell.x && pending.y === cell.y) {
                setPending(null);
                setNote(null);
                return;
            }
            const why = rejection(position, cell);
            if (why !== null) {
                setNote(rejectionNote(why));
                return;
            }
            if (pending === null) {
                setPending(cell);
                setNote(null);
                return;
            }
            // A turn sent during its wait is only refused again,
            // so the first stone stays marked until the wait ends.
            if (waiting) return;
            const pair: readonly [AxialCoord, AxialCoord] = [pending, cell];
            setSending(true);
            setPending(null);
            setNote(null);
            void onCommit(pair).then((sent) => {
                setSending(false);
                if (sent.kind === `limited`) startWait(sent.seconds);
                else clearWait();
                if (sent.kind === `failed`) setNote(text.drawer.turnFailed);
            });
        },
        [yourMove, sending, pending, position, waiting, onCommit, startWait, clearWait],
    );

    function handleKey(event: React.KeyboardEvent<HTMLDivElement>) {
        if (!yourMove) return;
        const step = sixKeys[event.key];
        if (step !== undefined) {
            event.preventDefault();
            const next = { x: focus.x + step.x, y: focus.y + step.y };
            // The focus walks the frontier and stops at its edge, where
            // the board ends.
            if (isWithinPlacementRadius(position.stones, next)) setFocus(next);
            return;
        }
        if (event.key === `Enter` || event.key === ` `) {
            event.preventDefault();
            tryMark(focus);
            return;
        }
        if (event.key === `Escape` || event.key === `Backspace`) {
            event.preventDefault();
            setPending(null);
            setNote(null);
        }
    }

    // The focus ring scrolls into view as it walks past the camera's edge.
    useEffect(() => {
        if (!yourMove) return;
        cameraRef.current
            ?.querySelector(`polygon.cell[data-x="${String(focus.x)}"][data-y="${String(focus.y)}"]`)
            ?.scrollIntoView({ block: `nearest`, inline: `nearest` });
    }, [focus, yourMove]);

    return (
        <div className="board-camera" ref={cameraRef}>
            {/* Off your move the board is read-only, but still takes focus
                so the arrows scroll a board larger than the view. */}
            <div
                className="board-control"
                tabIndex={0}
                role={yourMove ? `application` : `group`}
                aria-label={text.drawer.board(yourMove ? text.drawer.boardYourTurn : idleLabel)}
                onKeyDown={handleKey}
            >
                <Board
                    stones={stones}
                    settings={settings}
                    label={text.drawer.boardStones(stones.length)}
                    scale={camera.scale}
                    frame={frameStones === undefined ? undefined : camera.box}
                    edge
                    overlays={{
                        ...(pending === null || you === null ? {} : { pending, pendingSide: you }),
                        ...(yourMove ? { focus } : {}),
                        ...(winLine.length === 0 ? {} : { winLine }),
                        lastMove,
                    }}
                    onCellClick={
                        yourMove
                            ? (cell) => {
                                  tryMark(cell);
                              }
                            : undefined
                    }
                />
            </div>
        </div>
    );
}
