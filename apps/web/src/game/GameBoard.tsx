import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AxialCoord, Side } from '@hexo-arena/contract';
import { isWithinPlacementRadius, rejection, type Position } from '@hexo-arena/rules';
import { Board, type BoardStone } from '../board/Board';
import { useBoardSettings } from '../board/board-settings';
import { cellSize, frontierCells, viewBoxOf } from '../board/geometry';
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

// A cell spans this many svg units edge to edge across its flats.
const cellWidth = Math.sqrt(3) * cellSize;

// When the frontier is too big to fit, the camera frames the stones and
// this many cells round them.
const nearCells = 3;

function nearBox(stones: readonly AxialCoord[]): { x: number; y: number; w: number; h: number } {
    const box = viewBoxOf(stones);
    const dx = nearCells * cellWidth;
    const dy = nearCells * 1.5 * cellSize;
    return { x: box.x - dx, y: box.y - dy, w: box.w + 2 * dx, h: box.h + 2 * dy };
}

/**
 * The smallest a cell may render, from the scale sheet, which raises it
 * for coarse pointers so a finger always hits one cell; a finished board
 * takes no taps, so it keeps the reading minimum at any pointer.
 */
function minCellPx(element: HTMLElement, finished: boolean): number {
    const style = getComputedStyle(element);
    const raw = style.getPropertyValue(finished ? `--board-cell-read` : `--board-cell-min`).trim();
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return 0;
    return raw.endsWith(`rem`) ? value * rootPx : value;
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
    const cameraRef = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState<{ w: number; h: number } | null>(null);
    const [scale, setScale] = useState<number | undefined>(undefined);
    const centerOn = useRef<{ cx: number; cy: number; scale: number } | null>(null);
    const framed = frameStones ?? stones;
    const box = useMemo(() => viewBoxOf(frontierCells(framed)), [framed]);

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

    useEffect(() => {
        const camera = cameraRef.current;
        if (camera === null || typeof ResizeObserver === `undefined`) return;
        const observer = new ResizeObserver(() => {
            setSize({ w: camera.clientWidth, h: camera.clientHeight });
        });
        observer.observe(camera);
        return () => {
            observer.disconnect();
        };
    }, []);

    // Refit on a new turn or a new viewport: the whole frontier when it
    // fits at the minimum cell size, else the stones and three cells round
    // them, centered once the new size has laid out.
    // Only the turn count, the viewport, and the finish refit; a pending
    // mark never moves the camera under the player's hand.
    useLayoutEffect(() => {
        const camera = cameraRef.current;
        if (camera === null || size === null || size.w === 0 || size.h === 0) return;
        const style = getComputedStyle(camera);
        const w = size.w - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        const h = size.h - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
        const least = minCellPx(camera, finished) / cellWidth;
        const whole = Math.min(w / box.w, h / box.h);
        if (whole >= least || framed.length === 0) {
            centerOn.current = null;
            setScale(whole);
            return;
        }
        const near = nearBox(framed);
        const next = Math.max(least, Math.min(w / near.w, h / near.h));
        centerOn.current = { cx: near.x + near.w / 2, cy: near.y + near.h / 2, scale: next };
        setScale(next);
    }, [framed.length, size, finished]);

    // The stones center in the room between the paddings, which differ
    // above and below, once the refit's scale has laid out: in this same
    // commit when a new viewport kept the scale, else in the next.
    useLayoutEffect(() => {
        const camera = cameraRef.current;
        const target = centerOn.current;
        if (camera === null || target === null || scale !== target.scale) return;
        const style = getComputedStyle(camera);
        const w = camera.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
        const h = camera.clientHeight - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom);
        camera.scrollLeft = (target.cx - box.x) * scale - w / 2;
        camera.scrollTop = (target.cy - box.y) * scale - h / 2;
        centerOn.current = null;
    }, [scale, box, size]);

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
                    scale={scale}
                    frame={frameStones === undefined ? undefined : box}
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
