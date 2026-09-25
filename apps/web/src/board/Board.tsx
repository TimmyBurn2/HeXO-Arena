import { memo, useMemo } from 'react';
import type { AxialCoord, Side } from '@hexarena/contract';
import type { BoardSettings } from './board-settings';
import { cellPoints, coordLabels, hexCenter, ringPoints, stonePoints, stoneRadius, viewBoxOf, visibleCells } from './geometry';

export interface BoardStone extends AxialCoord {
    side: Side;
    number: number;
}

export interface BoardOverlays {
    pending?: AxialCoord | undefined;
    focus?: AxialCoord | undefined;
    lastMove?: readonly AxialCoord[] | undefined;
    winLine?: readonly AxialCoord[] | undefined;
}

export interface BoardProps {
    stones: readonly BoardStone[];
    settings: BoardSettings;
    label: string;
    overlays?: BoardOverlays | undefined;
    extraCells?: readonly AxialCoord[] | undefined;
    onCellClick?: ((cell: AxialCoord) => void) | undefined;
}

interface CellGeometry {
    points: string;
    cx: number;
    cy: number;
}

function geometryOf(cell: AxialCoord): CellGeometry {
    const { cx, cy } = hexCenter(cell);
    return { points: cellPoints(), cx, cy };
}

function translate(cx: number, cy: number): string {
    return `translate(${cx.toFixed(2)} ${cy.toFixed(2)})`;
}

const Cell = memo(function Cell({ cell, geometry }: {
    cell: AxialCoord;
    geometry: CellGeometry;
}) {
    return (
        <polygon
            className="cell"
            data-x={cell.x}
            data-y={cell.y}
            points={geometry.points}
            transform={translate(geometry.cx, geometry.cy)}
        />
    );
});

const Ring = memo(function Ring({ className, coord }: { className: string; coord: AxialCoord }) {
    const { cx, cy } = hexCenter(coord);
    return <polygon className={className} points={ringPoints()} transform={translate(cx, cy)} />;
});

const Stone = memo(function Stone({ stone }: { stone: BoardStone }) {
    const { cx, cy } = hexCenter(stone);
    return (
        <g className={`stone s-${stone.side}`} data-x={stone.x} data-y={stone.y}>
            <circle className={`disc d-${stone.side}`} cx={cx.toFixed(2)} cy={cy.toFixed(2)} r={stoneRadius().toFixed(2)} />
            <polygon
                className={`hstone h-${stone.side}`}
                points={stonePoints()}
                transform={translate(cx, cy)}
            />
            <text className={`number n-${stone.side}`} x={cx.toFixed(2)} y={cy.toFixed(2)} dy="0.35em">
                {String(stone.number)}
            </text>
            <text className={`glyph g-${stone.side}`} x={cx.toFixed(2)} y={cy.toFixed(2)} dy="0.35em">
                {stone.side}
            </text>
        </g>
    );
});

/**
 * The one board renderer: cells, stones, rings, and overlays as pure
 * presentation, with the palette, stone style, and overlay axes carried
 * as data attributes the token sheet switches on.
 */
export function Board({ stones, settings, label, overlays, extraCells, onCellClick }: BoardProps) {
    const cells = useMemo(() => visibleCells(stones, extraCells), [stones, extraCells]);
    const viewBox = useMemo(() => viewBoxOf(cells), [cells]);
    const labels = useMemo(() => (settings.coords ? coordLabels(cells) : []), [settings.coords, cells]);

    const cellGeometries = useMemo(
        () => cells.map((cell) => ({ cell, geometry: geometryOf(cell) })),
        [cells],
    );

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

    return (
        <div
            className="board-frame"
            data-board={settings.palette}
            data-stones={settings.stones}
            {...(settings.numbers ? { 'data-numbers': `` } : {})}
            {...(settings.coords ? { 'data-coords': `` } : {})}
        >
            <svg
                className="board-svg"
                viewBox={`${viewBox.x.toFixed(2)} ${viewBox.y.toFixed(2)} ${viewBox.w.toFixed(2)} ${viewBox.h.toFixed(2)}`}
                role="img"
                aria-label={label}
                onClick={onCellClick === undefined ? undefined : handleClick}
            >
                {cellGeometries.map(({ cell, geometry }) => (
                    <Cell key={`${String(cell.x)},${String(cell.y)}`} cell={cell} geometry={geometry} />
                ))}
                {overlays?.focus !== undefined && <Ring className="ring-focus" coord={overlays.focus} />}
                {overlays?.pending !== undefined && <Ring className="ring-pending" coord={overlays.pending} />}
                {stones.map((stone) => (
                    <Stone key={`${String(stone.x)},${String(stone.y)}`} stone={stone} />
                ))}
                {overlays?.lastMove?.map((coord) => (
                    <Ring key={`last,${String(coord.x)},${String(coord.y)}`} className="last-ring" coord={coord} />
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
