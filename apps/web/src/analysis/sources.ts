import {
    analysisPositionsPath,
    positionReadingRequestSchema,
    positionReadingSchema,
    type AnalysisFailure,
    type AnalysisLine,
    type AnalyzerRef,
    type AnalyzerValues,
    type AxialCoord,
    type GameCell,
    type HtttxPositionEvaluation,
    type PositionReading,
    type Side,
} from '@hexo-arena/contract';

/** A position at a turn boundary: every stone with its side, and who plays next. */
export interface AnalysisPosition {
    readonly cells: readonly GameCell[];
    readonly toMove: Side;
}

/** What a reading is asked for: the lines wanted and the seconds to spend. */
export interface ReadingAsk {
    readonly lines: 1 | 2 | 3;
    readonly seconds: number;
}

/** One candidate turn: two cells and the evaluation of the board after them, x-positive, as htttx defines it. */
export interface ReadingLine {
    readonly cells: readonly [AxialCoord, AxialCoord];
    readonly evaluation: HtttxPositionEvaluation;
}

/** Whose opinion a reading is: a community bot, a bot's own view of its game, or an engine in the browser. */
export type ReadingAuthor =
    | { readonly kind: `bot`; readonly name: string; readonly version: string | null; readonly ownerName: string | null }
    | { readonly kind: `own`; readonly name: string; readonly side: Side }
    | { readonly kind: `worker`; readonly engine: string; readonly version: string };

/**
 * A reading of one position, best line first, with how its author's values read, as it declared them when it read.
 * `elapsedMs` is how long it took, or null for one kept from an earlier ask, which cost nothing.
 */
export interface Reading {
    readonly by: ReadingAuthor;
    readonly values: AnalyzerValues;
    readonly lines: readonly ReadingLine[];
    readonly seconds: number;
    readonly final: boolean;
    readonly elapsedMs: number | null;
}

/**
 * Why a source read nothing: the position is a live game's, the person is seated in one,
 * signed out, out of readings for the day, the queues are full, no analyzer takes it,
 * too many asks came at once, or anything else that kept the ask from an answer.
 */
export type ReadingRefusal =
    | `live_position`
    | `seated`
    | `signed_out`
    | `analysis_limit`
    | `analysis_busy`
    | `no_analyzer`
    | `rate_limited`
    | `unavailable`;

/**
 * What a source says while it reads, ending with a reading, a refusal, or a failure;
 * a position waiting its turn names whom it waits for once one is chosen.
 */
export type SourceEvent =
    | { readonly kind: `queued`; readonly ahead: number; readonly by: ReadingAuthor | null }
    | { readonly kind: `thinking` }
    | { readonly kind: `reading`; readonly reading: Reading }
    | { readonly kind: `refused`; readonly code: ReadingRefusal; readonly retryAfter: number | null }
    | { readonly kind: `failed`; readonly code: AnalysisFailure; readonly by: ReadingAuthor | null };

/**
 * Anything the analysis panel reads from: values and cells keep htttx shapes,
 * so an engine in the browser plugs in unchanged.
 * `runs` says when it reads: `stored` never asks, `on-ask` when the person asks, `auto` on every position.
 */
export interface EvaluationSource {
    readonly id: string;
    readonly label: string;
    readonly runs: `stored` | `on-ask` | `auto`;
    /** Ends after a final reading, a refusal, or a failure; stops when `signal` aborts. */
    read(position: AnalysisPosition, ask: ReadingAsk, signal: AbortSignal): AsyncIterable<SourceEvent>;
}

/** The source id of a community bot's readings, or of whichever one is free when the name is null. */
export function botSourceId(analyzer: string | null): string {
    return analyzer === null ? `bot:*` : `bot:${analyzer}`;
}

/** The source id a reading also belongs to by its author, when that is a named bot. */
export function authorSourceId(reading: Reading): string | null {
    return reading.by.kind === `bot` ? botSourceId(reading.by.name) : null;
}

/** A community analyzer as a reading names it. */
export function botAuthor(analyzer: AnalyzerRef): ReadingAuthor {
    return { kind: `bot`, name: analyzer.name, version: analyzer.version, ownerName: analyzer.ownerName };
}

/** A line as the site sends it, in htttx's shapes. */
export function readingLineOf(line: AnalysisLine): ReadingLine {
    const [first, second] = line.cells;
    // The contract holds every line to exactly two cells.
    if (first === undefined || second === undefined) throw new Error(`a line holds two cells`);
    const evaluation: { heuristic?: number; win_in?: number } = {};
    if (line.heuristic !== undefined) evaluation.heuristic = line.heuristic;
    if (line.winIn !== undefined) evaluation.win_in = line.winIn;
    return { cells: [{ x: first.x, y: first.y }, { x: second.x, y: second.y }], evaluation };
}

type Answer =
    | { readonly kind: `answer`; readonly reading: PositionReading }
    | { readonly kind: `error`; readonly status: number; readonly code: string | null; readonly retryAfter: number | null }
    | { readonly kind: `aborted` };

// A queued answer means the server held the request its full time; one that
// comes back sooner is not followed at once, so a server answering queued
// at once is not asked in a tight loop.
const requeueFloorMs = 1_000;

/**
 * A community analyzer read through the site: the request is held while the
 * analyzer reads, answered queued when it waits its turn, and sent again then,
 * which joins the same request; aborting drops it.
 * `onLeft` hears how many positions the person may still have read today.
 */
export function botSource({ analyzer, label, onLeft, fetcher = fetch, now = Date.now }: {
    analyzer: string | null;
    label: string;
    onLeft?: (left: number) => void;
    fetcher?: typeof fetch;
    now?: () => number;
}): EvaluationSource {
    async function post(body: string, signal: AbortSignal): Promise<Answer> {
        let response: Response;
        try {
            response = await fetcher(analysisPositionsPath, {
                method: `POST`,
                headers: { 'content-type': `application/json`, accept: `application/json` },
                body,
                cache: `no-store`,
                signal,
            });
        } catch {
            return signal.aborted ? { kind: `aborted` } : { kind: `error`, status: 0, code: null, retryAfter: null };
        }
        let json: unknown = null;
        try {
            json = await response.json();
        } catch {
            if (signal.aborted) return { kind: `aborted` };
        }
        if (!response.ok) {
            const code = typeof json === `object` && json !== null && `code` in json && typeof json.code === `string` ? json.code : null;
            const wait = Number(response.headers.get(`retry-after`));
            return { kind: `error`, status: response.status, code, retryAfter: Number.isInteger(wait) && wait > 0 ? wait : null };
        }
        const parsed = positionReadingSchema.safeParse(json);
        return parsed.success ? { kind: `answer`, reading: parsed.data } : { kind: `error`, status: response.status, code: null, retryAfter: null };
    }

    return {
        id: botSourceId(analyzer),
        label,
        runs: `on-ask`,
        async *read(position, ask, signal) {
            const request = positionReadingRequestSchema.safeParse({ cells: position.cells, toMove: position.toMove, analyzer, lines: ask.lines, seconds: ask.seconds });
            if (!request.success) {
                yield { kind: `refused`, code: `unavailable`, retryAfter: null };
                return;
            }
            const body = JSON.stringify(request.data);
            yield { kind: `thinking` };
            for (;;) {
                if (signal.aborted) return;
                const sent = now();
                const answer = await post(body, signal);
                if (answer.kind === `aborted`) return;
                if (answer.kind === `error`) {
                    yield { kind: `refused`, code: refusalOf(answer.status, answer.code), retryAfter: answer.retryAfter };
                    return;
                }
                const reading = answer.reading;
                onLeft?.(reading.left);
                switch (reading.status) {
                    case `queued`:
                        yield { kind: `queued`, ahead: reading.ahead, by: reading.analyzer === undefined ? null : botAuthor(reading.analyzer) };
                        if (now() - sent < requeueFloorMs && !(await pause(requeueFloorMs, signal))) return;
                        continue;
                    case `done`:
                        yield {
                            kind: `reading`,
                            reading: {
                                by: botAuthor(reading.analyzer),
                                values: reading.analyzer.values,
                                lines: reading.lines.map(readingLineOf),
                                seconds: reading.seconds,
                                final: true,
                                elapsedMs: reading.cached ? null : reading.elapsedMs,
                            },
                        };
                        return;
                    case `failed`:
                        yield { kind: `failed`, code: reading.failure, by: botAuthor(reading.analyzer) };
                        return;
                }
            }
        },
    };
}

// A code the panel has no words for reads as the generic refusal; a newer
// request of the same person replacing this one, from another tab, is one.
function refusalOf(status: number, code: string | null): ReadingRefusal {
    if (status === 401) return `signed_out`;
    switch (code) {
        case `live_position`:
        case `seated`:
        case `no_analyzer`:
        case `analysis_limit`:
        case `analysis_busy`:
        case `rate_limited`:
            return code;
        default:
            return `unavailable`;
    }
}

// Resolves true after the wait, or false as soon as `signal` aborts.
function pause(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            signal.removeEventListener(`abort`, stop);
            resolve(true);
        }, ms);
        function stop() {
            clearTimeout(timer);
            resolve(false);
        }
        signal.addEventListener(`abort`, stop, { once: true });
    });
}
