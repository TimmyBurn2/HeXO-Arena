import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { hexPoints } from '../board/geometry';
import type { GameReading } from './game-readings';
import { graphX, graphY, seriesOf, tracePoints, turnAt, washPoints, type GraphFrame } from './graph';
import './GameGraph.css';

// The box before the graph is measured, as jsdom never measures it.
const fallback = { full: { width: 300, height: 72 }, mini: { width: 300, height: 36 } } as const;
const markSize = { full: 6.5, mini: 4.5 } as const;
const forcedSize = { full: 4.5, mini: 3.5 } as const;

/**
 * A reading of a whole game as one graph on the board's plate:
 * a community reading as one trace, washed in x's color above the middle and o's below,
 * its judged turns as hexes on the trace;
 * the bots' own views as a trace a side in that side's stone color.
 * Forced wins sit pinned to the winner's edge, and the cursor stands at the turn on the board.
 * The graph draws in its own pixels, so its hexes keep their shape at any width.
 * Given `onTurn`, a press goes to the turn under it.
 */
export function GameGraph({ reading, first, last, cursor, label, variant, onTurn }: {
    reading: GameReading;
    first: number;
    last: number;
    cursor: number | null;
    label: string;
    variant: `full` | `mini`;
    onTurn?: ((turn: number) => void) | undefined;
}) {
    const host = useRef<HTMLDivElement>(null);
    const [box, setBox] = useState<{ width: number; height: number }>(fallback[variant]);
    const clip = `graph${useId().replace(/:/g, ``)}`;

    useEffect(() => {
        const element = host.current;
        if (element === null || typeof ResizeObserver === `undefined`) return;
        const observer = new ResizeObserver(() => {
            if (element.clientWidth > 0 && element.clientHeight > 0) setBox({ width: element.clientWidth, height: element.clientHeight });
        });
        observer.observe(element);
        return () => {
            observer.disconnect();
        };
    }, []);

    const frame: GraphFrame = { ...box, first, last };
    const series = seriesOf(reading.points);
    const community = series.get(null) ?? [];
    const middle = box.height / 2;

    function press(event: PointerEvent<SVGSVGElement>) {
        if (onTurn === undefined) return;
        const area = event.currentTarget.getBoundingClientRect();
        if (area.width === 0) return;
        onTurn(turnAt(frame, ((event.clientX - area.left) / area.width) * box.width));
    }

    return (
        <div className={`graph graph-${variant}`} ref={host}>
            <svg
                className="graph-svg"
                viewBox={`0 0 ${String(box.width)} ${String(box.height)}`}
                role="img"
                aria-label={label}
                data-turns={onTurn === undefined ? undefined : ``}
                onPointerDown={onTurn === undefined ? undefined : press}
            >
                <defs>
                    <clipPath id={`${clip}-x`}>
                        <rect x="0" y="0" width={box.width} height={middle} />
                    </clipPath>
                    <clipPath id={`${clip}-o`}>
                        <rect x="0" y={middle} width={box.width} height={middle} />
                    </clipPath>
                </defs>
                <rect className="graph-plate" x="0" y="0" width={box.width} height={box.height} />
                {community.length > 0 ? (
                    <>
                        <polygon className="graph-wash graph-wash-x" clipPath={`url(#${clip}-x)`} points={washPoints(frame, community)} />
                        <polygon className="graph-wash graph-wash-o" clipPath={`url(#${clip}-o)`} points={washPoints(frame, community)} />
                    </>
                ) : null}
                <line className="graph-mid" x1="0" x2={box.width} y1={middle} y2={middle} />
                {cursor === null || cursor < first || cursor > last ? null : (
                    <line className="graph-cursor" x1={graphX(frame, cursor)} x2={graphX(frame, cursor)} y1="0" y2={box.height} />
                )}
                {[...series].map(([side, points]) => (
                    <polyline key={side ?? `community`} className={side === null ? `graph-trace` : `graph-trace graph-trace-${side}`} points={tracePoints(frame, points)} />
                ))}
                {reading.points
                    .filter((point) => point.forced !== null)
                    .map((point) => (
                        <polygon
                            key={`forced-${String(point.turn)}`}
                            className={`graph-forced graph-forced-${point.forced ?? `x`}`}
                            points={hexPoints(forcedSize[variant])}
                            transform={`translate(${graphX(frame, point.turn).toFixed(1)} ${graphY(frame, point.value).toFixed(1)})`}
                        />
                    ))}
                {reading.marks.map((mark) => (
                    <polygon
                        key={`mark-${String(mark.turn)}`}
                        className={`graph-mark jd-${mark.severity}`}
                        points={hexPoints(markSize[variant])}
                        transform={`translate(${graphX(frame, mark.turn).toFixed(1)} ${graphY(frame, mark.value).toFixed(1)})`}
                    />
                ))}
            </svg>
        </div>
    );
}
