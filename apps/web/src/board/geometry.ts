import type { AxialCoord } from '@hexarena/contract';
import { placementRadius } from '@hexarena/rules';

// SVG user units per cell edge; the viewBox scales to the frame, so this
// only fixes the coordinate system's resolution.
export const cellSize = 28;

// Rings sit inside the cell edge; stones cover most of it.
const ringScale = 0.92;

// Frame breathing room around the outermost cell centers.
const viewBoxPad = cellSize * 1.35;

// The value of --board-stone-scale is a geometry token the sheet owns;
// themes never change it mid-session, so one read per page is enough.
const stoneScaleFallback = 0.82;
let stoneScale: number | null = null;

export function stoneRadius(): number {
    if (stoneScale === null) {
        const sheet =
            typeof document === `undefined`
                ? ``
                : getComputedStyle(document.documentElement)
                      .getPropertyValue(`--board-stone-scale`)
                      .trim();
        const parsed = Number.parseFloat(sheet);
        stoneScale = Number.isFinite(parsed) && sheet !== `` ? parsed : stoneScaleFallback;
    }
    return cellSize * stoneScale;
}

/**
 * The pixel center of an engine coordinate under the pointy-top layout:
 * right along x, down along y, on 1.5-size rows.
 */
export function hexCenter(coord: AxialCoord): { cx: number; cy: number } {
    return {
        cx: Math.sqrt(3) * cellSize * (coord.x + coord.y / 2),
        cy: 1.5 * cellSize * coord.y,
    };
}

/** The six-vertex outline of a cell-sized hexagon centered at the origin. */
export function hexPoints(size: number): string {
    const points: string[] = [];
    for (let k = 0; k < 6; k += 1) {
        const angle = (Math.PI / 180) * (60 * k + 30);
        points.push(`${(size * Math.cos(angle)).toFixed(2)},${(size * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(` `);
}

/** The outline every cell renders with. */
export function cellPoints(): string {
    return hexPoints(cellSize);
}

/** The slightly smaller outline the cell rings render with. */
export function ringPoints(): string {
    return hexPoints(cellSize * ringScale);
}

/** The stone outline for the hex style, at the stone radius the sheet sets. */
export function stonePoints(): string {
    return hexPoints(stoneRadius());
}

/**
 * The placement frontier: every cell a stone may legally go, the union of
 * placement-radius disks around the placed stones, row-ordered top to
 * bottom for a stable render.
 * Before any stone, only the origin is legal.
 */
export function frontierCells(stones: readonly AxialCoord[]): AxialCoord[] {
    if (stones.length === 0) return [{ x: 0, y: 0 }];
    const seen = new Set<string>();
    const cells: AxialCoord[] = [];
    const r = placementRadius;
    for (const stone of stones) {
        for (let dx = -r; dx <= r; dx += 1) {
            for (let dy = Math.max(-r, -dx - r); dy <= Math.min(r, -dx + r); dy += 1) {
                const x = stone.x + dx;
                const y = stone.y + dy;
                const key = `${String(x)},${String(y)}`;
                if (seen.has(key)) continue;
                seen.add(key);
                cells.push({ x, y });
            }
        }
    }
    return cells.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
}

// The neighbor across each cell edge, edge k running from corner k to
// corner k + 1 in hexPoints order.
const edgeNeighbors: readonly AxialCoord[] = [
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
];

function corner(cx: number, cy: number, k: number): string {
    const angle = (Math.PI / 180) * (60 * k + 30);
    return `${(cx + cellSize * Math.cos(angle)).toFixed(2)},${(cy + cellSize * Math.sin(angle)).toFixed(2)}`;
}

/**
 * The frontier's outer edge as one svg path: every cell edge whose
 * neighbor lies outside the region.
 */
export function frontierOutline(cells: readonly AxialCoord[]): string {
    const inside = new Set(cells.map((cell) => `${String(cell.x)},${String(cell.y)}`));
    const segments: string[] = [];
    for (const cell of cells) {
        const { cx, cy } = hexCenter(cell);
        for (const [k, step] of edgeNeighbors.entries()) {
            if (inside.has(`${String(cell.x + step.x)},${String(cell.y + step.y)}`)) continue;
            segments.push(`M${corner(cx, cy, k)}L${corner(cx, cy, (k + 1) % 6)}`);
        }
    }
    return segments.join(``);
}

/** The frame's viewBox: every cell center padded by a uniform margin. */
export function viewBoxOf(cells: readonly AxialCoord[]): { x: number; y: number; w: number; h: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of cells) {
        const { cx, cy } = hexCenter(cell);
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
    }
    return {
        x: minX - viewBoxPad,
        y: minY - viewBoxPad,
        w: maxX - minX + 2 * viewBoxPad,
        h: maxY - minY + 2 * viewBoxPad,
    };
}

export interface CoordLabel {
    x: number;
    y: number;
    text: string;
}

/**
 * Edge labels on two axes only: the x extent with its letter on the left
 * edge, the y extent with its letter on the bottom edge; a full label
 * honeycomb is unreadable.
 */
export function coordLabels(cells: readonly AxialCoord[]): CoordLabel[] {
    if (cells.length === 0) return [];
    const row = nearestToZero(cells, (cell) => Math.abs(cell.y));
    const xAnchor = row.reduce((min, cell) => (cell.x < min.x ? cell : min));
    const column = nearestToZero(cells, (cell) => Math.abs(cell.x));
    const yAnchor = column.reduce((max, cell) => (cell.y > max.y ? cell : max));
    const xCenter = hexCenter(xAnchor);
    const yCenter = hexCenter(yAnchor);
    const offset = cellSize * 1.1;
    const rowStep = 1.5 * cellSize;
    const columnStep = Math.sqrt(3) * cellSize;
    return [
        { x: xCenter.cx - offset, y: xCenter.cy, text: String(xAnchor.x) },
        { x: xCenter.cx - offset, y: xCenter.cy + rowStep, text: `x` },
        { x: yCenter.cx, y: yCenter.cy + offset, text: `y` },
        { x: yCenter.cx + columnStep, y: yCenter.cy + offset, text: String(yAnchor.y) },
    ];
}

function nearestToZero(cells: readonly AxialCoord[], distance: (cell: AxialCoord) => number): AxialCoord[] {
    let best = Infinity;
    let picked: AxialCoord[] = [];
    for (const cell of cells) {
        const d = distance(cell);
        if (d < best) {
            best = d;
            picked = [cell];
        } else if (d === best) {
            picked.push(cell);
        }
    }
    return picked;
}
