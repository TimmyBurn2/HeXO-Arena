import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { AxialCoord, JudgmentSeverity, Side } from '@hexo-arena/contract';
import { hexDistance, placementRadius } from '@hexo-arena/rules';
import { Board, type BoardLines, type BoardStone, type BoardVisual } from '../board/Board';
import { useBoardSettings } from '../board/board-settings';
import { useBoardCamera } from '../board/camera';
import { text } from '../text';
import '../game/GameBoard.css';

const sixKeys: Readonly<Record<string, AxialCoord>> = {
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    q: { x: 1, y: -1 },
    e: { x: -1, y: 1 },
};

/**
 * The analysis board: the position the board stands on, framed on the end
 * of its line so stones hold still as the reader steps along it, taking a
 * stone on every cell of its field.
 * A pointer marks cells; the keyboard walks the cells with the game's six
 * keys once the board is reached from the keyboard, and the arrows step
 * through the turns otherwise, as the screen reads them.
 * A paste on the board hands its text to `onPaste`.
 */
export function AnalysisBoard({ stones, frame, field, mark, toMove, lastMove, winLine, lines, preview, judgment, visuals, label, onCell, onPaste }: {
    stones: readonly BoardStone[];
    // The position the camera frames, which holds `stones`.
    frame: readonly AxialCoord[];
    // The cells the field grows round; absent, the stones.
    field?: readonly AxialCoord[] | undefined;
    mark: AxialCoord | null;
    toMove: Side;
    lastMove: readonly AxialCoord[];
    winLine: readonly AxialCoord[];
    // An analyzer's lines, and the one pointed at, shown as the stones it would place.
    lines?: BoardLines | undefined;
    preview?: { readonly side: Side; readonly cells: readonly AxialCoord[] } | undefined;
    // A judged turn's mark beside its last stone.
    judgment?: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | undefined;
    // An imported text's highlights and labels for the position shown.
    visuals: readonly BoardVisual[];
    label: string;
    onCell: (cell: AxialCoord) => void;
    onPaste: (pasted: string) => void;
}) {
    const [settings] = useBoardSettings();
    const camera = useBoardCamera(frame, false);
    const anchors = field ?? stones;
    const [focus, setFocus] = useState<AxialCoord>(() => stones.at(-1) ?? { x: 0, y: 0 });
    const [walking, setWalking] = useState(false);
    const pressed = useRef(false);

    function handleKey(event: KeyboardEvent<HTMLDivElement>) {
        if (!walking || event.metaKey || event.ctrlKey || event.altKey) return;
        const step = sixKeys[event.key];
        if (step !== undefined) {
            event.preventDefault();
            const next = { x: focus.x + step.x, y: focus.y + step.y };
            // The focus walks the field and stops at its edge, where the board ends.
            if (anchors.length === 0 ? next.x === 0 && next.y === 0 : anchors.some((cell) => hexDistance(cell, next) <= placementRadius)) setFocus(next);
            return;
        }
        if (event.key === `Enter` || event.key === ` `) {
            event.preventDefault();
            onCell(focus);
        }
    }

    function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
        const pasted = event.clipboardData.getData(`text`);
        if (pasted.trim() === ``) return;
        event.preventDefault();
        onPaste(pasted);
    }

    // The focus ring scrolls into view as it walks past the camera's edge.
    useEffect(() => {
        if (!walking) return;
        camera.ref.current
            ?.querySelector(`polygon.cell[data-x="${String(focus.x)}"][data-y="${String(focus.y)}"]`)
            ?.scrollIntoView({ block: `nearest`, inline: `nearest` });
    }, [focus, walking, camera.ref]);

    return (
        <div className="board-camera" ref={camera.ref}>
            {/* A press focuses the board for a paste without taking the
                arrows, which keep stepping through the turns; only focus
                that arrives from the keyboard walks the cells. */}
            <div
                className="board-control"
                tabIndex={0}
                role="application"
                aria-label={label}
                onPointerDown={() => {
                    pressed.current = true;
                    setWalking(false);
                }}
                onFocus={() => {
                    setWalking(!pressed.current);
                    pressed.current = false;
                }}
                onBlur={() => {
                    setWalking(false);
                }}
                onKeyDown={handleKey}
                onPaste={handlePaste}
            >
                <Board
                    stones={stones}
                    settings={settings}
                    label={text.analysis.boardStones(stones.length)}
                    scale={camera.scale}
                    frame={camera.box}
                    edge
                    field={field}
                    overlays={{
                        ...(mark === null ? {} : { pending: mark, pendingSide: toMove }),
                        ...(walking ? { focus } : {}),
                        ...(winLine.length === 0 ? {} : { winLine }),
                        lastMove,
                        lines,
                        preview,
                        judgment,
                        visuals,
                    }}
                    onCellClick={onCell}
                />
            </div>
        </div>
    );
}
