import { memo, useId, useMemo, useRef } from 'react';
import { judgmentGlyphs, type AxialCoord, type JudgmentSeverity, type Side } from '@hexo-arena/contract';
import type { BoardSettings } from './board-settings';
import {
    cellPoints,
    cellSize,
    frontierCells,
    asideCorner,
    highlightPoints,
    highlightRingPoints,
    labelAsideCenter,
    frontierOutline,
    hexCenter,
    lineMarkPoints,
    markPoints,
    ringPoints,
    stonePoints,
    tagCenter,
    tagPoints,
    viewBoxOf,
    type AsideCorner,
    type Frame,
} from './geometry';
import './Board.css';

export interface BoardStone extends AxialCoord {
    side: Side;
    // Null for a stone placed by hand rather than played, which has no place in the order.
    number: number | null;
}

/** Candidate turns for one side, best first, each with the letter it is named by. */
export interface BoardLines {
    readonly side: Side;
    readonly lines: readonly { readonly letter: string; readonly cells: readonly AxialCoord[] }[];
}

/**
 * A cell's look an imported text gives the position shown:
 * a highlight in x's or o's color or a neutral one, a label drawn in the cell, or both.
 */
export interface BoardVisual {
    readonly cell: AxialCoord;
    readonly tone: `neutral` | `x` | `o` | null;
    readonly label: string | null;
}

interface BoardOverlays {
    pending?: AxialCoord | undefined;
    // The side whose ghost stone previews the pending mark.
    pendingSide?: Side | undefined;
    focus?: AxialCoord | undefined;
    lastMove?: readonly AxialCoord[] | undefined;
    winLine?: readonly AxialCoord[] | undefined;
    lines?: BoardLines | undefined;
    // A candidate turn shown as the stones it would place, while its line is pointed at.
    preview?: { readonly side: Side; readonly cells: readonly AxialCoord[] } | undefined;
    // A judged turn's mark, hung beside the stone it names.
    judgment?: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | undefined;
    // An imported text's highlights, under the stones, and labels, over them in a stone number's place.
    visuals?: readonly BoardVisual[] | undefined;
}

interface BoardProps {
    stones: readonly BoardStone[];
    settings: BoardSettings;
    label: string;
    overlays?: BoardOverlays | undefined;
    // Pixels per svg unit; absent, the board fills its frame's width.
    scale?: number | undefined;
    // The part of the field to show; absent, the whole frontier.
    frame?: Frame | undefined;
    // Whether the frontier's edge draws; a framed mini leaves it out, since
    // its frame cuts through the field.
    edge?: boolean | undefined;
    // The cells the field grows round; absent, the stones.
    field?: readonly AxialCoord[] | undefined;
    onCellClick?: ((cell: AxialCoord) => void) | undefined;
}

function translate(cx: number, cy: number): string {
    return `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`;
}

const Cell = memo(function Cell({ cell }: { cell: AxialCoord }) {
    const { cx, cy } = hexCenter(cell);
    return (
        <polygon className="cell" data-x={cell.x} data-y={cell.y} points={cellPoints()} transform={translate(cx, cy)} />
    );
});

interface LineMark {
    readonly cell: AxialCoord;
    readonly letters: string;
    readonly best: boolean;
}

// A cell several lines share is drawn once with every letter, and as solid as its best line.
function lineMarks(lines: BoardLines): LineMark[] {
    const marks = new Map<string, { cell: AxialCoord; letters: string; rank: number }>();
    lines.lines.forEach((line, rank) => {
        for (const cell of line.cells) {
            const key = `${String(cell.x)},${String(cell.y)}`;
            const mark = marks.get(key) ?? { cell, letters: ``, rank };
            marks.set(key, { cell, letters: mark.letters + line.letter, rank: Math.min(mark.rank, rank) });
        }
    });
    // The best line draws last, so it stays whole where marks meet.
    return [...marks.values()].sort((a, b) => b.rank - a.rank).map((mark) => ({ cell: mark.cell, letters: mark.letters, best: mark.rank === 0 }));
}

const Ring = memo(function Ring({ className, coord }: { className: string; coord: AxialCoord }) {
    const { cx, cy } = hexCenter(coord);
    return <polygon className={className} points={ringPoints()} transform={translate(cx, cy)} />;
});

/**
 * A stone at the origin in three fixed layers, a body with a rim stroke, a
 * shine, and an inset mark; themes reach each through effect slots, so a
 * glare, an outline, or a mark needs no change here.
 * `shine` names the gradients a {@link ShineDefs} in the same svg defines;
 * `flat` turns the stone flat-top, its glare staying where the board's is.
 */
export function StoneArt({ side, shine, flat = false }: { side: Side; shine: string; flat?: boolean }) {
    return (
        <g className="stone-art">
            <polygon className={`body b-${side}`} points={stonePoints(flat)} />
            <polygon className="shine" points={stonePoints(flat)} fill={`url(#${shine}-${side})`} />
            <polygon className={`stone-mark m-${side}`} points={markPoints(flat)} />
        </g>
    );
}

/**
 * The glare gradients for one svg, one per side; the stop colors and the
 * strength come from the theme's shine slots.
 * The highlight sits high on the stone's upper left and fades within half
 * its width, so it reads as a glare rather than a wash.
 */
export function ShineDefs({ id }: { id: string }) {
    return (
        <defs>
            {([`x`, `o`] as const).map((side) => (
                <radialGradient key={side} id={`${id}-${side}`} cx="0.33" cy="0.27" r="0.5">
                    <stop className={`shine-stop shine-${side}`} offset="0" />
                    <stop className={`shine-stop shine-${side} shine-fade`} offset="1" />
                </radialGradient>
            ))}
        </defs>
    );
}

// The placement animation scales the art inside, since a css transform on
// this group would replace its translate.
const Stone = memo(function Stone({ stone, fresh, shine }: { stone: BoardStone; fresh: boolean; shine: string }) {
    const { cx, cy } = hexCenter(stone);
    return (
        <g
            className={`stone s-${stone.side}${fresh ? ` fresh` : ``}`}
            data-x={stone.x}
            data-y={stone.y}
            transform={translate(cx, cy)}
        >
            <StoneArt side={stone.side} shine={shine} />
        </g>
    );
});

// `cut` draws the digit into the win line's mask rather than onto its stone.
const StoneNumber = memo(function StoneNumber({ stone, cut = false }: { stone: BoardStone; cut?: boolean }) {
    const { cx, cy } = hexCenter(stone);
    if (stone.number === null) return null;
    return (
        <text className={`number ${cut ? `cut` : `n-${stone.side}`}`} dy="0.35em" transform={translate(cx, cy)}>
            {String(stone.number)}
        </text>
    );
});

/**
 * The one board renderer: the placement frontier as the field, its edge,
 * stones, rings, and overlays as pure presentation.
 * Nothing renders outside the frontier, so an illegal distance cannot be
 * clicked at all.
 */
export function Board({ stones, settings, label, overlays, scale, frame, edge = frame === undefined, field: anchors, onCellClick }: BoardProps) {
    const field = useMemo(() => frontierCells(anchors ?? stones), [anchors, stones]);
    const outline = useMemo(() => frontierOutline(field), [field]);
    const viewBox = useMemo(() => frame ?? viewBoxOf(field), [frame, field]);
    // A framed board draws only the cells whose hexagon can reach into view.
    const cells = useMemo(() => (frame === undefined ? field : field.filter((cell) => within(frame, cell))), [frame, field]);
    const shine = `shine${useId().replace(/:/g, ``)}`;
    const cut = `cut${useId().replace(/:/g, ``)}`;
    // Stones present at first render are history; only later ones animate in.
    const settled = useRef(stones.length);
    const freshKeys = new Set(stones.slice(settled.current).map((stone) => `${String(stone.x)},${String(stone.y)}`));
    const winLine = overlays?.winLine;
    const winKeys = new Set(winLine?.map((coord) => `${String(coord.x)},${String(coord.y)}`));
    const visuals = overlays?.visuals ?? [];
    const labelled = new Set(visuals.flatMap((visual) => (visual.label === null ? [] : [keyOf(visual.cell)])));
    // A label replaces its stone's number, so a win line is cut round the labels it crosses whatever the numbers setting.
    const crossed = settings.numbers ? stones.filter((stone) => winKeys.has(keyOf(stone)) && !labelled.has(keyOf(stone))) : [];
    const crossedLabels = visuals.filter((visual) => visual.label !== null && winKeys.has(keyOf(visual.cell)));
    const masked = crossed.length > 0 || crossedLabels.length > 0;

    function handleClick(event: React.MouseEvent<SVGSVGElement>) {
        if (onCellClick === undefined) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        const polygon = target.closest(`polygon.cell`);
        if (polygon === null) return;
        const x = Number(polygon.getAttribute(`data-x`));
        const y = Number(polygon.getAttribute(`data-y`));
        if (!Number.isInteger(x) || !Number.isInteger(y)) return;
        onCellClick({ x, y });
    }

    const pending = overlays?.pending;
    const lines = overlays?.lines;
    const preview = overlays?.preview;
    const judgment = overlays?.judgment;
    const sideAt = new Map(stones.map((stone) => [keyOf(stone), stone.side]));
    // An analyzer's line letter keeps its cell, so a label there steps aside to the cell's corner.
    const lineCells = new Set(lines === undefined ? [] : lines.lines.flatMap((line) => line.cells.map(keyOf)));
    return (
        <div className="board-frame" {...(settings.numbers ? { 'data-numbers': `` } : {})}>
            <svg
                className="board-svg"
                viewBox={`${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.w.toFixed(2)} ${viewBox.h.toFixed(2)}`}
                role="img"
                aria-label={label}
                {...(onCellClick === undefined ? {} : { 'data-marks': `` })}
                {...(scale === undefined ? {} : { width: viewBox.w * scale, height: viewBox.h * scale })}
                onClick={onCellClick === undefined ? undefined : handleClick}
            >
                <ShineDefs id={shine} />
                {masked && (
                    <defs>
                        <mask id={cut} maskUnits="userSpaceOnUse" x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h}>
                            <rect className="cut-keep" x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} />
                            {crossed.map((stone) => (
                                <StoneNumber key={keyOf(stone)} stone={stone} cut />
                            ))}
                            {crossedLabels.map((visual, index) => (
                                <VisualLabel key={`cut,${String(index)}`} visual={visual} place="cut" />
                            ))}
                        </mask>
                    </defs>
                )}
                {cells.map((cell) => (
                    <Cell key={`${String(cell.x)},${String(cell.y)}`} cell={cell} />
                ))}
                {edge ? <path className="frontier" d={outline} /> : null}
                {visuals.map((visual, index) => {
                    if (visual.tone === null) return null;
                    const stone = sideAt.has(keyOf(visual.cell));
                    return (
                        <polygon
                            key={`highlight,${String(index)}`}
                            className={`highlight hl-${visual.tone}${stone ? ` on-stone` : ``}`}
                            data-x={visual.cell.x}
                            data-y={visual.cell.y}
                            points={stone ? highlightRingPoints() : highlightPoints()}
                            transform={translate(hexCenter(visual.cell).cx, hexCenter(visual.cell).cy)}
                        />
                    );
                })}
                {pending !== undefined && (
                    <>
                        <Ring className="ring-pending" coord={pending} />
                        <polygon
                            className={`ghost b-${overlays?.pendingSide ?? `x`}`}
                            points={stonePoints()}
                            transform={translate(hexCenter(pending).cx, hexCenter(pending).cy)}
                        />
                    </>
                )}
                {stones.map((stone, index) => (
                    <Stone
                        key={`${String(stone.x)},${String(stone.y)}`}
                        stone={stone}
                        fresh={index >= settled.current}
                        shine={shine}
                    />
                ))}
                {overlays?.focus !== undefined && <Ring className="ring-focus" coord={overlays.focus} />}
                {overlays?.lastMove?.map((coord) => (
                    <Ring
                        key={`last,${String(coord.x)},${String(coord.y)}`}
                        className={`last-ring${freshKeys.has(`${String(coord.x)},${String(coord.y)}`) ? ` fresh` : ``}`}
                        coord={coord}
                    />
                ))}
                {lines === undefined
                    ? null
                    : lineMarks(lines).map((mark) => (
                          <g
                              key={`line,${String(mark.cell.x)},${String(mark.cell.y)}`}
                              className={`line-mark line-${lines.side}${mark.best ? ` best` : ``}`}
                              data-x={mark.cell.x}
                              data-y={mark.cell.y}
                              transform={translate(hexCenter(mark.cell).cx, hexCenter(mark.cell).cy)}
                          >
                              <polygon className="line-casing" points={lineMarkPoints()} />
                              <polygon className="line-hex" points={lineMarkPoints()} />
                              <text className={`line-letters letters-${String(mark.letters.length)}`} dy="0.35em">
                                  {mark.letters}
                              </text>
                          </g>
                      ))}
                {/* A label stepped aside for a line's letter hangs from a corner no other line's letter holds, over the marks. */}
                {visuals.map((visual, index) =>
                    visual.label !== null && lineCells.has(keyOf(visual.cell)) ? (
                        <VisualLabel key={`aside,${String(index)}`} visual={visual} place={asideCorner(visual.cell, (cell) => lineCells.has(keyOf(cell)))} />
                    ) : null,
                )}
                {preview?.cells.map((cell) => (
                    <polygon
                        key={`preview,${String(cell.x)},${String(cell.y)}`}
                        className={`ghost preview b-${preview.side}`}
                        points={stonePoints()}
                        transform={translate(hexCenter(cell).cx, hexCenter(cell).cy)}
                    />
                ))}
                {winLine !== undefined && (
                    // The casing keeps the line legible where it crosses
                    // stones as light or as dark as the line itself; with
                    // numbers on, both are cut away around the digits they
                    // cross, and always round the labels, so each reads
                    // whole on its own stone.
                    <g className="win" mask={masked ? `url(#${cut})` : undefined}>
                        <polyline className="win-casing" points={winLinePoints(winLine)} />
                        <polyline className="win-line" points={winLinePoints(winLine)} />
                    </g>
                )}
                <g className="numbers">
                    {stones.map((stone) => (labelled.has(keyOf(stone)) ? null : <StoneNumber key={keyOf(stone)} stone={stone} />))}
                </g>
                {visuals.map((visual, index) => {
                    const at = keyOf(visual.cell);
                    if (visual.label === null || lineCells.has(at)) return null;
                    return <VisualLabel key={`label,${String(index)}`} visual={visual} place={sideAt.get(at) ?? `cell`} />;
                })}
                {judgment === undefined ? null : (
                    <g className={`board-tag jd-${judgment.severity}`} transform={translate(tagCenter(judgment.cell).cx, tagCenter(judgment.cell).cy)}>
                        <polygon className="board-tag-plate" points={tagPoints()} />
                        <text className="board-tag-glyph" dy="0.35em">
                            {judgmentGlyphs[judgment.severity]}
                        </text>
                    </g>
                )}
            </svg>
        </div>
    );
}

function keyOf(cell: AxialCoord): string {
    return `${String(cell.x)},${String(cell.y)}`;
}

// A label in its cell: on a stone in the stone's number color, on an empty cell cased in the board's own,
// on a plate off a corner of the cell where a line's letter holds the middle, or cut into the win line's mask.
function VisualLabel({ visual, place }: { visual: BoardVisual; place: Side | `cell` | `cut` | AsideCorner }) {
    const size = String(Math.min(visual.label?.length ?? 1, 3));
    if (place !== `x` && place !== `o` && place !== `cell` && place !== `cut`) {
        const { cx, cy } = labelAsideCenter(visual.cell, place);
        return (
            <g className="label-aside" data-x={visual.cell.x} data-y={visual.cell.y} data-corner={place} transform={translate(cx, cy)}>
                <polygon className="label-aside-plate" points={tagPoints()} />
                <text className={`visual-label label-${size} on-plate`} dy="0.35em">
                    {visual.label}
                </text>
            </g>
        );
    }
    const { cx, cy } = hexCenter(visual.cell);
    return (
        <text className={`visual-label label-${size} ${place === `cut` ? `cut` : `on-${place}`}`} data-x={visual.cell.x} data-y={visual.cell.y} dy="0.35em" transform={translate(cx, cy)}>
            {visual.label}
        </text>
    );
}

function within(frame: Frame, cell: AxialCoord): boolean {
    const { cx, cy } = hexCenter(cell);
    return cx > frame.x - cellSize && cx < frame.x + frame.w + cellSize && cy > frame.y - cellSize && cy < frame.y + frame.h + cellSize;
}

function winLinePoints(coords: readonly AxialCoord[]): string {
    return coords
        .map((coord) => {
            const { cx, cy } = hexCenter(coord);
            return `${cx.toFixed(2)},${cy.toFixed(2)}`;
        })
        .join(` `);
}
