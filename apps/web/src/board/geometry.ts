import type { AxialCoord } from '@hexo-arena/contract';
import { placementRadius } from '@hexo-arena/rules';

// SVG user units per cell edge; the viewBox scales to the frame, so this
// only fixes the coordinate system's resolution.
export const cellSize = 28;

// Rings sit inside the cell edge; stones cover most of it.
const ringScale = 0.92;

// The stone mark sits inside the stone's edge and leaves the middle to
// the stone number.
const markScale = 0.69;

// A line's mark sits well inside its cell, so its letters stay clear of the cell's edge.
const lineMarkScale = 0.7;

// A highlight fills its cell to just inside the gap, outside the rings, so a stone and its last-turn ring stay clear of it.
const highlightScale = 0.95;

// On a stone a highlight is a ring at the cell's edge, as far from the stone as the cell allows,
// so it never merges with a stone of its own color.
const highlightRingScale = 0.97;

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

/**
 * The six-vertex outline of a cell-sized hexagon centered at the origin,
 * pointy-top as the board lays its cells, or flat-top when asked.
 */
export function hexPoints(size: number, flat = false): string {
    const points: string[] = [];
    for (let k = 0; k < 6; k += 1) {
        const angle = (Math.PI / 180) * (60 * k + (flat ? 0 : 30));
        points.push(`${(size * Math.cos(angle)).toFixed(2)},${(size * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(` `);
}

/** The outline every cell renders with. */
export function cellPoints(flat = false): string {
    return hexPoints(cellSize, flat);
}

/** The slightly smaller outline the cell rings render with. */
export function ringPoints(): string {
    return hexPoints(cellSize * ringScale);
}

/** The stone outline for the hex style, at the stone radius the sheet sets. */
export function stonePoints(flat = false): string {
    return hexPoints(stoneRadius(), flat);
}

/** The hollow hexagon that marks a cell of an analyzer's line. */
export function lineMarkPoints(): string {
    return hexPoints(cellSize * lineMarkScale);
}

/** A corner of a cell an imported label's plate may hang from when an analyzer's line letter holds the cell's middle. */
export type AsideCorner = `lower-left` | `lower-right` | `upper-left` | `upper-right`;

// Each corner's plate hangs as a judgment's tag does, toward the neighbour it reaches over.
const asideCorners: readonly { readonly corner: AsideCorner; readonly x: number; readonly y: number; readonly toward: AxialCoord }[] = [
    { corner: `lower-left`, x: -0.7, y: 0.95, toward: { x: -1, y: 1 } },
    { corner: `lower-right`, x: 0.7, y: 0.95, toward: { x: 0, y: 1 } },
    { corner: `upper-left`, x: -0.7, y: -0.95, toward: { x: 0, y: -1 } },
    { corner: `upper-right`, x: 0.7, y: -0.95, toward: { x: 1, y: -1 } },
];

/** The first corner, lower left first, whose neighbour `taken` leaves free, so the plate covers no other line's letter; lower left where none is free. */
export function asideCorner(coord: AxialCoord, taken: (cell: AxialCoord) => boolean): AsideCorner {
    return asideCorners.find((each) => !taken({ x: coord.x + each.toward.x, y: coord.y + each.toward.y }))?.corner ?? `lower-left`;
}

/** Where an imported label's plate stands, hung from a corner of its cell. */
export function labelAsideCenter(coord: AxialCoord, corner: AsideCorner): { cx: number; cy: number } {
    const { cx, cy } = hexCenter(coord);
    const offset = asideCorners.find((each) => each.corner === corner) ?? { x: 0, y: 0 };
    return { cx: cx + cellSize * offset.x, cy: cy + cellSize * offset.y };
}

/** The tinted hexagon that highlights a cell for an imported text. */
export function highlightPoints(): string {
    return hexPoints(cellSize * highlightScale);
}

/** The ring that highlights a stone's cell, at the cell's edge, so the cell shows between it and the stone. */
export function highlightRingPoints(): string {
    return hexPoints(cellSize * highlightRingScale);
}

// A judgment's tag hangs off a stone's upper right, clear of its number,
// on a plate as wide as two glyphs with a cell's pointed ends.
const tagHalfWidth = cellSize * 0.55;
const tagHalfHeight = cellSize * 0.38;
const tagOffset = { x: cellSize * 0.7, y: -cellSize * 0.95 };

/** The plate a judgment's tag sits on, centered at the origin. */
export function tagPoints(): string {
    const w = tagHalfWidth;
    const h = tagHalfHeight;
    const tip = w + h * Math.tan(Math.PI / 6);
    return [`${String(-w)},${String(-h)}`, `${String(w)},${String(-h)}`, `${tip.toFixed(2)},0`, `${String(w)},${String(h)}`, `${String(-w)},${String(h)}`, `${(-tip).toFixed(2)},0`].join(` `);
}

/** Where a judgment's tag stands for the stone at a coordinate. */
export function tagCenter(coord: AxialCoord): { cx: number; cy: number } {
    const { cx, cy } = hexCenter(coord);
    return { cx: cx + tagOffset.x, cy: cy + tagOffset.y };
}

/** The inset hexagon a theme may edge a stone with. */
export function markPoints(flat = false): string {
    return hexPoints(cellSize * markScale, flat);
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

/** An svg frame in user units. */
export interface Frame {
    x: number;
    y: number;
    w: number;
    h: number;
}

// A cell spans this many units across its flats, and a row this many down.
const cellAcross = Math.sqrt(3) * cellSize;
const rowDown = 1.5 * cellSize;

// Room round the outermost stones, and the fewest cells a frame spans,
// so an early game shows stones at a size a glance can read,
// not one stone filling the frame.
const framePadCells = 1.5;
const frameMinCells = 9;

/**
 * The fit-to-stones camera: the stones' extent with room round it,
 * at least a few cells across,
 * widened or heightened about its center to the aspect asked for.
 * Before any stone it frames the origin.
 */
export function stonesFrame(stones: readonly AxialCoord[], aspect: number): Frame {
    const centers = (stones.length === 0 ? [{ x: 0, y: 0 }] : stones).map(hexCenter);
    const minX = Math.min(...centers.map((center) => center.cx));
    const maxX = Math.max(...centers.map((center) => center.cx));
    const minY = Math.min(...centers.map((center) => center.cy));
    const maxY = Math.max(...centers.map((center) => center.cy));
    let w = Math.max(maxX - minX + 2 * framePadCells * cellAcross, frameMinCells * cellAcross);
    let h = maxY - minY + 2 * framePadCells * rowDown;
    if (w / h < aspect) w = h * aspect;
    else h = w / aspect;
    return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
}
