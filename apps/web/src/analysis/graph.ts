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

function fixed(value: number): string {
    return value.toFixed(1);
}
