import { useCallback, useEffect, useRef, useState } from 'react';
import type { AxialCoord, Side } from '@hexarena/contract';
import { isWithinPlacementRadius, rejection, type Position } from '@hexarena/rules';
import { Board, type BoardStone } from '../board/Board';
import { useBoardSettings } from '../board/board-settings';
import { rejectionNote } from './snapshot-views';
import './GameBoard.css';

const sixKeys: Record<string, AxialCoord> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    q: { x: 1, y: -1 },
    e: { x: -1, y: 1 },
};

/**
 * The interactive board: six-key cell focus, two-stone selection with a
 * pending ring, and a locally validated commit, so the server's move
 * rejections are unreachable by construction.
 */
export function GameBoard({ stones, position, you, lastMove, winLine, yourMove, opponentMoving, opponentName, onCommit }: {
    stones: readonly BoardStone[];
    position: Position;
    you: Side;
    lastMove: readonly AxialCoord[];
    winLine: readonly AxialCoord[];
    yourMove: boolean;
    opponentMoving: boolean;
    opponentName: string;
    onCommit: (cells: readonly [AxialCoord, AxialCoord]) => Promise<boolean>;
}) {
    const [settings] = useBoardSettings();
    const [focus, setFocus] = useState<AxialCoord>(() => stones.at(-1) ?? { x: 0, y: 0 });
    const [pending, setPending] = useState<AxialCoord | null>(null);
    const [note, setNote] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    // The opponent's move or the finish leaves the board static.
    useEffect(() => {
        if (!yourMove) {
            setPending(null);
            setNote(null);
        }
    }, [yourMove]);

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
            const pair: readonly [AxialCoord, AxialCoord] = [pending, cell];
            setSending(true);
            setPending(null);
            setNote(null);
            void onCommit(pair).then((landed) => {
                setSending(false);
                if (!landed) setNote(`the move did not land; try again`);
            });
        },
        [yourMove, sending, pending, position, onCommit],
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

    // The focus ring scrolls into view as the board grows around it.
    useEffect(() => {
        if (!yourMove) return;
        rootRef.current
            ?.querySelector(`polygon.cell[data-x="${String(focus.x)}"][data-y="${String(focus.y)}"]`)
            ?.scrollIntoView({ block: `nearest`, inline: `nearest` });
    }, [focus, yourMove]);

    return (
        <div className="board-control-wrap" ref={rootRef}>
            <div
                className="board-control"
                tabIndex={yourMove ? 0 : undefined}
                role="application"
                aria-label={`board, ${yourMove ? `your move: two stones` : opponentMoving ? `waiting for ${opponentName}` : `game finished`}`}
                onKeyDown={handleKey}
            >
                <Board
                    stones={stones}
                    settings={settings}
                    label={`game board, ${String(stones.length)} stones placed`}
                    overlays={{
                        ...(pending === null ? {} : { pending, pendingSide: you }),
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
            {yourMove ? (
                <p className="note" role="status">
                    <kbd>tab</kbd> moves the cell focus, <kbd>enter</kbd> marks a stone, the
                    second mark plays the turn, <kbd>esc</kbd> clears the pending stone; the
                    dashed ring is the pending stone, the solid ring the last turn
                </p>
            ) : null}
            {!yourMove && opponentMoving ? (
                <p className="note" role="status">
                    waiting for {opponentName} to move
                </p>
            ) : null}
            {note !== null ? (
                <p className="field-error" role="alert">
                    {note}
                </p>
            ) : null}
        </div>
    );
}
