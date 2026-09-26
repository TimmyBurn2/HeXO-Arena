import { memo, useId, useMemo, useRef } from 'react';
import type { AxialCoord, Side } from '@hexarena/contract';
import type { BoardSettings } from './board-settings';
import {
    cellPoints,
    coordLabels,
    frontierCells,
    frontierOutline,
    hexCenter,
    ringPoints,
    stonePoints,
    viewBoxOf,
} from './geometry';
import './Board.css';

export interface BoardStone extends AxialCoord {
    side: Side;
    number: number;
}

export interface BoardOverlays {
    pending?: AxialCoord | undefined;
    // The side whose ghost stone previews the pending mark.
    pendingSide?: Side | undefined;
    focus?: AxialCoord | undefined;
    lastMove?: readonly AxialCoord[] | undefined;
    winLine?: readonly AxialCoord[] | undefined;
}

export interface BoardProps {
    stones: readonly BoardStone[];
    settings: BoardSettings;
    label: string;
    overlays?: BoardOverlays | undefined;
    // Pixels per svg unit; absent, the board fills its frame's width.
    scale?: number | undefined;
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

const Ring = memo(function Ring({ className, coord }: { className: string; coord: AxialCoord }) {
    const { cx, cy } = hexCenter(coord);
    return <polygon className={className} points={ringPoints()} transform={translate(cx, cy)} />;
});

// Two fixed layers per stone, a body with a rim stroke and a shine above
// it; themes reach both through effect slots, so a glare or an outline
// needs no change here.
const Stone = memo(function Stone({ stone, fresh, shine }: { stone: BoardStone; fresh: boolean; shine: string }) {
    const { cx, cy } = hexCenter(stone);
    return (
        <g
            className={`stone s-${stone.side}${fresh ? ` fresh` : ``}`}
            data-x={stone.x}
            data-y={stone.y}
            transform={translate(cx, cy)}
        >
            {/* the placement animation scales this inner group, since a css
                transform on the outer one would replace its translate */}
            <g className="stone-art">
                <polygon className={`body b-${stone.side}`} points={stonePoints()} />
                <polygon className="shine" points={stonePoints()} fill={`url(#${shine}-${stone.side})`} />
            </g>
            <text className={`number n-${stone.side}`} dy="0.35em">
                {String(stone.number)}
            </text>
        </g>
    );
});

/**
 * The one board renderer: the placement frontier as the field, its edge,
 * stones, rings, and overlays as pure presentation.
 * Nothing renders outside the frontier, so an illegal distance cannot be
 * clicked at all.
 */
export function Board({ stones, settings, label, overlays, scale, onCellClick }: BoardProps) {
    const cells = useMemo(() => frontierCells(stones), [stones]);
    const outline = useMemo(() => frontierOutline(cells), [cells]);
    const viewBox = useMemo(() => viewBoxOf(cells), [cells]);
    const labels = useMemo(() => (settings.coords ? coordLabels(cells) : []), [settings.coords, cells]);
    const shine = `shine${useId().replace(/:/g, ``)}`;
    // Stones present at first render are history; only later ones animate in.
    const settled = useRef(stones.length);
    const freshKeys = new Set(stones.slice(settled.current).map((stone) => `${String(stone.x)},${String(stone.y)}`));

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
    return (
        <div
            className="board-frame"
            {...(settings.numbers ? { 'data-numbers': `` } : {})}
            {...(settings.coords ? { 'data-coords': `` } : {})}
        >
            <svg
                className="board-svg"
                viewBox={`${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.w.toFixed(2)} ${viewBox.h.toFixed(2)}`}
                role="img"
                aria-label={label}
                {...(scale === undefined ? {} : { width: viewBox.w * scale, height: viewBox.h * scale })}
                onClick={onCellClick === undefined ? undefined : handleClick}
            >
                <defs>
                    {([`x`, `o`] as const).map((side) => (
                        <radialGradient key={side} id={`${shine}-${side}`} cx="0.35" cy="0.3" r="0.7">
                            <stop className={`shine-stop shine-${side}`} offset="0" />
                            <stop className={`shine-stop shine-${side} shine-fade`} offset="1" />
                        </radialGradient>
                    ))}
                </defs>
                {cells.map((cell) => (
                    <Cell key={`${String(cell.x)},${String(cell.y)}`} cell={cell} />
                ))}
                <path className="frontier" d={outline} />
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
                {overlays?.winLine !== undefined && (
                    <polyline className="win-line" points={winLinePoints(overlays.winLine)} />
                )}
                {labels.map((coord) => (
                    <text
                        key={`coord,${coord.text},${coord.x.toFixed(2)},${coord.y.toFixed(2)}`}
                        className="coord"
                        x={coord.x.toFixed(2)}
                        y={coord.y.toFixed(2)}
                        dy="0.35em"
                    >
                        {coord.text}
                    </text>
                ))}
            </svg>
        </div>
    );
}

function winLinePoints(coords: readonly AxialCoord[]): string {
    return coords
        .map((coord) => {
            const { cx, cy } = hexCenter(coord);
            return `${cx.toFixed(2)},${cy.toFixed(2)}`;
        })
        .join(` `);
}
