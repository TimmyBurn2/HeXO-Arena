import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { RatingPoint, RatingRange } from '@hexo-arena/contract';
import { cellSize, hexPoints } from '../board/geometry';
import { Rating } from '../components/player';
import { navigate } from '../router/use-route';
import { text } from '../text';
import './RatingChart.css';

// The plot's own units; the drawing stretches to the frame, the strokes keep their width.
const width = 1000;
const height = 300;
const ranges: readonly RatingRange[] = [`30d`, `1y`, `all`];

const dotHalf = (Math.sqrt(3) * cellSize) / 2;
const dotBox = `${String(-dotHalf)} ${String(-cellSize)} ${String(2 * dotHalf)} ${String(2 * cellSize)}`;

// A lone game's band is a bar this many plot units wide, where two games would span the plot.
const lonelyBand = 40;

const percent = (value: number, of: number) => `${((value / of) * 100).toFixed(2)}%`;

function dateOf(iso: string, withTime = false): string {
    return new Intl.DateTimeFormat(undefined, withTime ? { dateStyle: `medium`, timeStyle: `short` } : { dateStyle: `medium` }).format(new Date(iso));
}

const dayMs = 86_400_000;

// Round steps for the rating axis, three to five across the span.
function ticksOf(low: number, high: number): number[] {
    const step = [25, 50, 100, 200, 250, 500].find((candidate) => (high - low) / candidate <= 5) ?? 1000;
    const ticks: number[] = [];
    for (let value = Math.ceil(low / step) * step; value <= high; value += step) ticks.push(value);
    return ticks;
}

/**
 * A player's rating after each rated game: one line over time with its
 * deviation as a faint band, the stretch while it was provisional in dim
 * ink, the latest game marked. A crosshair snaps to the nearest game, by
 * pointer or by arrow keys, and opens it; a touch holds the game first and
 * opens it on a second tap.
 */
export function RatingChart({ points, range, onRange, onRetry }: {
    points: readonly RatingPoint[] | `failed` | null;
    range: RatingRange;
    onRange: (range: RatingRange) => void;
    onRetry: () => void;
}) {
    const titleId = useId();
    return (
        <section className="rating-chart" aria-labelledby={titleId}>
            <div className="rating-chart-head">
                <h2 id={titleId} className="section-title">
                    {text.players.chart.title}
                </h2>
                <div className="pills" role="group" aria-label={text.players.chart.range}>
                    {ranges.map((value) => (
                        <button
                            key={value}
                            type="button"
                            className={value === range ? `pill active` : `pill`}
                            aria-pressed={value === range}
                            onClick={() => {
                                onRange(value);
                            }}
                        >
                            {text.players.chart.ranges[value]}
                        </button>
                    ))}
                </div>
            </div>
            {points === null ? (
                <div className="rating-chart-frame skeleton" aria-hidden="true" />
            ) : points === `failed` ? (
                <p className="player-failed">
                    <span className="note">{text.players.chart.failed}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
                        {text.states.tryAgain}
                    </button>
                </p>
            ) : points.length === 0 ? (
                <p className="note">{text.players.chart.none}</p>
            ) : (
                <Plot points={points} />
            )}
        </section>
    );
}

function Plot({ points }: { points: readonly RatingPoint[] }) {
    const [held, setHeld] = useState<number | null>(null);
    const [touch, setTouch] = useState(false);
    const pointer = useRef(`mouse`);
    const times = points.map((point) => Date.parse(point.at));
    const first = times[0] ?? 0;
    const last = times.at(-1) ?? first;
    const spanX = Math.max(1, last - first);
    // A provisional player's first band spans hundreds of points and would
    // flatten the settled line, so the scale holds every rating and the band
    // only where it settled; the early band is cut at the frame's edge.
    const settledPoints = points.filter((point) => !point.provisional);
    const banded = settledPoints.length > 0 ? settledPoints : points;
    const low = Math.min(...points.map((point) => point.rating), ...banded.map((point) => point.rating - point.deviation));
    const high = Math.max(...points.map((point) => point.rating), ...banded.map((point) => point.rating + point.deviation));
    const pad = Math.max(25, (high - low) * 0.08);
    const floor = low - pad;
    const ceiling = high + pad;
    const x = (index: number) => (points.length === 1 ? width / 2 : (((times[index] ?? first) - first) / spanX) * width);
    const y = (value: number) => height - ((value - floor) / (ceiling - floor)) * height;
    const at = (index: number, value: number) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`;
    // Cut in the data, not by a clip, so no shape reaches past the plot
    // over the text around it.
    const top = (point: RatingPoint) => Math.min(ceiling, point.rating + point.deviation);
    const bottom = (point: RatingPoint) => Math.max(floor, point.rating - point.deviation);
    const band = [...points.map((point, index) => at(index, top(point))), ...[...points].reverse().map((point, index) => at(points.length - 1 - index, bottom(point)))].join(` `);
    const line = points.map((point, index) => at(index, point.rating)).join(` `);
    // The settled stretch overdraws the dim line wherever both ends of a step had settled.
    const settled = points
        .map((point, index) => (index > 0 && !point.provisional && points[index - 1]?.provisional === false ? `M${at(index - 1, points[index - 1]?.rating ?? point.rating)} L${at(index, point.rating)}` : ``))
        .join(` `);
    const chosen = held === null ? undefined : points[held];
    const latest = points.at(-1);
    const oneDay = first === last;

    // The plot's own box, inside the frame's gutters, is what the pointer is measured against.
    function nearest(event: MouseEvent<HTMLDivElement>): number {
        const box = event.currentTarget.getBoundingClientRect();
        const target = ((event.clientX - box.left) / Math.max(1, box.width)) * width;
        let best = 0;
        for (let index = 1; index < points.length; index += 1) if (Math.abs(x(index) - target) < Math.abs(x(best) - target)) best = index;
        return best;
    }

    function open(index: number | null) {
        const point = index === null ? undefined : points[index];
        if (point !== undefined) navigate(`/game/${encodeURIComponent(point.gameId)}`);
    }

    function onKey(event: KeyboardEvent<HTMLDivElement>) {
        const move = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (move !== undefined) {
            event.preventDefault();
            setHeld((current) => Math.min(points.length - 1, Math.max(0, (current ?? points.length) + move)));
        } else if (event.key === `Home` || event.key === `End`) {
            event.preventDefault();
            setHeld(event.key === `Home` ? 0 : points.length - 1);
        } else if (event.key === `Enter`) {
            open(held);
        }
    }

    return (
        <>
            <div className="rating-chart-frame" role="group" tabIndex={0} aria-label={text.players.chart.label(points.length, latest?.rating ?? 0, latest?.provisional ?? false)} onKeyDown={onKey} onBlur={() => {
                    setHeld(null);
                }}>
                <div
                    className="rating-chart-box"
                    onPointerDown={(event) => {
                        pointer.current = event.pointerType;
                        setTouch(event.pointerType !== `mouse`);
                    }}
                    onPointerMove={(event) => {
                        if (event.pointerType === `mouse`) setHeld(nearest(event));
                    }}
                    onPointerLeave={(event) => {
                        // A finger leaves as it lifts, which must not drop the game it holds.
                        if (event.pointerType === `mouse`) setHeld(null);
                    }}
                    onClick={(event) => {
                        const index = nearest(event);
                        if (pointer.current === `mouse` || index === held) open(index);
                        else setHeld(index);
                    }}
                >
                    <svg className="rating-chart-plot" viewBox={`0 0 ${String(width)} ${String(height)}`} preserveAspectRatio="none" aria-hidden="true">
                        {ticksOf(floor, ceiling).map((tick) => (
                            <line key={tick} className="rating-chart-grid" x1={0} x2={width} y1={y(tick)} y2={y(tick)} />
                        ))}
                        {points.length === 1 && latest !== undefined ? (
                            <rect className="rating-chart-band" x={width / 2 - lonelyBand / 2} width={lonelyBand} y={y(top(latest))} height={y(bottom(latest)) - y(top(latest))} />
                        ) : (
                            <polygon className="rating-chart-band" points={band} />
                        )}
                        <polyline className="rating-chart-line provisional" points={line} />
                        <path className="rating-chart-line" d={settled} />
                        {held === null ? null : <line className="rating-chart-cross" x1={x(held)} x2={x(held)} y1={0} y2={height} />}
                    </svg>
                    {ticksOf(floor, ceiling).map((tick) => (
                        <span key={tick} className="rating-chart-tick" style={{ top: percent(y(tick), height) }} aria-hidden="true">
                            {String(tick)}
                        </span>
                    ))}
                    {held === null && latest !== undefined ? (
                        <svg className="rating-chart-dot latest" viewBox={dotBox} style={{ left: percent(x(points.length - 1), width), top: percent(y(latest.rating), height) }} aria-hidden="true">
                            <polygon points={hexPoints(cellSize)} />
                        </svg>
                    ) : null}
                    {chosen === undefined || held === null ? null : (
                        <>
                            <svg className="rating-chart-dot" viewBox={dotBox} style={{ left: percent(x(held), width), top: percent(y(chosen.rating), height) }} aria-hidden="true">
                                <polygon points={hexPoints(cellSize)} />
                            </svg>
                            <div className={x(held) > width / 2 ? `rating-chart-tip left` : `rating-chart-tip`} style={{ left: percent(x(held), width) }} aria-hidden="true">
                                <strong>
                                    <Rating value={chosen.rating} provisional={chosen.provisional} />
                                </strong>
                                <span>{text.players.chart.band(chosen.rating - chosen.deviation, chosen.rating + chosen.deviation)}</span>
                                <span>{dateOf(chosen.at, spanX < dayMs)}</span>
                                <span>{touch ? text.players.chart.tapToOpen : text.players.chart.open}</span>
                            </div>
                        </>
                    )}
                </div>
            </div>
            <p className="sr-only" role="status">
                {chosen === undefined ? null : text.players.chart.readout(chosen.rating, chosen.rating - chosen.deviation, chosen.rating + chosen.deviation, dateOf(chosen.at, spanX < dayMs), chosen.provisional)}
            </p>
            <div className="rating-chart-foot" aria-hidden="true">
                <span>{dateOf(points[0]?.at ?? ``, spanX < dayMs)}</span>
                {oneDay ? null : <span>{dateOf(latest?.at ?? ``, spanX < dayMs)}</span>}
            </div>
            <p className="note rating-chart-key">{text.players.chart.key}</p>
        </>
    );
}
