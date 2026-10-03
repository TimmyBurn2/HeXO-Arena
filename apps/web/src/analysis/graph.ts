import type { Side } from '@hexo-arena/contract';
import type { GraphPoint } from './game-readings';

/** A graph's box in its own units, and the turns its width spans. */
export interface GraphFrame {
    readonly width: number;
    readonly height: number;
    readonly first: number;
    readonly last: number;
}

// A marker on the edge or at either end keeps its whole shape in the box.
const inset = 6;

/** Where a turn sits across the graph; a span of one turn stands at its middle. */
export function graphX(frame: GraphFrame, turn: number): number {
    const span = frame.last - frame.first;
    if (span <= 0) return frame.width / 2;
    return inset + ((turn - frame.first) / span) * (frame.width - 2 * inset);
}

/** Where a value from -1 to 1 sits up the graph, x's edge at the top. */
export function graphY(frame: GraphFrame, value: number): number {
    const half = frame.height / 2;
    return half - Math.max(-1, Math.min(1, value)) * (half - inset);
}

/** The turn nearest a point across the graph, held to its span. */
export function turnAt(frame: GraphFrame, x: number): number {
    const span = frame.last - frame.first;
    if (span <= 0) return frame.first;
    const share = (x - inset) / (frame.width - 2 * inset);
    return Math.max(frame.first, Math.min(frame.last, frame.first + Math.round(share * span)));
}

/** A run of points as svg polyline points. */
export function tracePoints(frame: GraphFrame, points: readonly GraphPoint[]): string {
    return points.map((point) => `${fixed(graphX(frame, point.turn))},${fixed(graphY(frame, point.value))}`).join(` `);
}

/**
 * The area between a trace and the middle line, closed on that line at both ends,
 * which the graph washes in x's color above the line and o's below.
 */
export function washPoints(frame: GraphFrame, points: readonly GraphPoint[]): string {
    const first = points[0];
    const last = points.at(-1);
    if (first === undefined || last === undefined) return ``;
    const middle = fixed(frame.height / 2);
    return `${fixed(graphX(frame, first.turn))},${middle} ${tracePoints(frame, points)} ${fixed(graphX(frame, last.turn))},${middle}`;
}

/** The points of each side's own series, or the one community trace under null. */
export function seriesOf(points: readonly GraphPoint[]): Map<Side | null, GraphPoint[]> {
    const series = new Map<Side | null, GraphPoint[]>();
    for (const point of points) {
        const run = series.get(point.series) ?? [];
        run.push(point);
        series.set(point.series, run);
    }
    return series;
}

/**
 * A series cut into the stretches its trace joins: a forced win stands on its edge as a pin,
 * never joined to the values around it, so the trace breaks there instead of diving edge to edge.
 */
export function traceSegments(points: readonly GraphPoint[]): GraphPoint[][] {
    const segments: GraphPoint[][] = [];
    let current: GraphPoint[] = [];
    for (const point of points) {
        if (point.forced === null) {
            current.push(point);
            continue;
        }
        if (current.length > 0) segments.push(current);
        current = [];
    }
    if (current.length > 0) segments.push(current);
    return segments;
}

/**
 * The column a turn's span takes across the graph, from the board it was played from to the board after it,
 * on the half of the side that held a forced win there.
 */
export function holdColumn(frame: GraphFrame, turn: number, side: Side): { x: number; y: number; width: number; height: number } {
    const from = graphX(frame, Math.max(frame.first, turn - 1));
    const to = graphX(frame, turn);
    const half = frame.height / 2;
    return { x: from, y: side === `x` ? 0 : half, width: Math.max(0, to - from), height: half };
}

/** A run's bracket under the graph, from its first turn to its last, its ends turned up, in a strip `height` tall. */
export function runBracket(frame: GraphFrame, from: number, to: number, height: number): string {
    const left = fixed(graphX(frame, from));
    const right = fixed(graphX(frame, to));
    const top = fixed(height * 0.25);
    const bottom = fixed(height * 0.75);
    return `M${left},${top}V${bottom}H${right}V${top}`;
}

function fixed(value: number): string {
    return value.toFixed(1);
}
