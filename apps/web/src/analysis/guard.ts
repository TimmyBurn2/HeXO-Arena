import { analysisCheckPath, playerOf, positionCheckRequestSchema } from '@hexo-arena/contract';
import { positionKey } from '@hexo-arena/rules';
import { meStore } from '../me';
import { SeatWatch } from './seat-channel';
import type { AnalysisPosition, EvaluationSource, ReadingRefusal, SourceEvent } from './sources';

/** What the site says of a position an engine in the browser would read. */
export type PositionCheck =
    | { readonly kind: `clear` }
    | { readonly kind: `refused`; readonly code: Extract<ReadingRefusal, `live_position` | `seated` | `rate_limited` | `unavailable`>; readonly retryAfter: number | null };

// A position's answer is kept this long, so stepping back and forth through
// a line clears each position once; a live game that ends meanwhile frees
// its positions within it.
const checkKeptMs = 60_000;

// While the person's own record says they sit in a live game, it is read
// again at most this often, so a game that ended frees the engine soon.
const meReadMs = 30_000;

/**
 * Clear a position against live games with the site, signed in or not:
 * clear, or refused as a live game's, to a seated person, or for asking too often.
 */
export async function checkPosition(position: AnalysisPosition, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<PositionCheck> {
    const body = positionCheckRequestSchema.safeParse({ cells: position.cells, toMove: position.toMove });
    if (!body.success) return { kind: `refused`, code: `unavailable`, retryAfter: null };
    let response: Response;
    try {
        response = await fetcher(analysisCheckPath, {
            method: `POST`,
            headers: { 'content-type': `application/json`, accept: `application/json` },
            body: JSON.stringify(body.data),
            cache: `no-store`,
            signal,
        });
    } catch {
        return { kind: `refused`, code: `unavailable`, retryAfter: null };
    }
    if (response.status === 204) return { kind: `clear` };
    const json: unknown = await response.json().catch(() => null);
    const code = typeof json === `object` && json !== null && `code` in json && typeof json.code === `string` ? json.code : null;
    const wait = Number(response.headers.get(`retry-after`));
    const retryAfter = Number.isInteger(wait) && wait > 0 ? wait : null;
    switch (code) {
        case `live_position`:
        case `seated`:
        case `rate_limited`:
            return { kind: `refused`, code, retryAfter };
        default:
            return { kind: `refused`, code: `unavailable`, retryAfter };
    }
}

/** Whether the person's own record names a live game of theirs, read again while it does. */
export function seatedByMe(now: () => number = Date.now): () => Promise<boolean> {
    let readAt = Number.NEGATIVE_INFINITY;
    const live = () => {
        const state = meStore.read();
        return state.status === `ready` && state.me !== null && state.me.liveGames.length > 0;
    };
    return async () => {
        if (!live()) return false;
        if (now() - readAt >= meReadMs) {
            readAt = now();
            await meStore.refresh();
        }
        return live();
    };
}

/** What a guarded source asks before it reads. */
export interface GuardDeps {
    /** Whether the person sits in a live game by their own record. */
    readonly seatedByMe: () => Promise<boolean>;
    /** Whether a tab of the site holds a seat in a live game. */
    readonly seats: Pick<SeatWatch, `seated` | `subscribe`>;
    readonly check: (position: AnalysisPosition, signal: AbortSignal) => Promise<PositionCheck>;
    readonly now: () => number;
}

/**
 * An engine the browser runs, kept from the site's live games as an analyzer is:
 * off while the person sits in a live game, by their own record or a game tab's word on the seat channel,
 * and reading a position only once the site has cleared it.
 * A seat taken while it reads stops the reading.
 */
export function guarded(source: EvaluationSource, deps: Partial<GuardDeps> = {}): EvaluationSource {
    const now = deps.now ?? Date.now;
    const bySelf = deps.seatedByMe ?? seatedByMe(now);
    const seats = deps.seats ?? new SeatWatch({ now });
    const check = deps.check ?? ((position: AnalysisPosition, signal: AbortSignal) => checkPosition(position, signal));
    const kept = new Map<string, { readonly answer: PositionCheck; readonly at: number }>();
    const seatedRefusal: SourceEvent = { kind: `refused`, code: `seated`, retryAfter: null };

    async function cleared(position: AnalysisPosition, signal: AbortSignal): Promise<PositionCheck> {
        const key = positionKey({ stones: position.cells.map((cell) => ({ x: cell.x, y: cell.y, player: playerOf(cell.side) })), toMove: playerOf(position.toMove) });
        const held = kept.get(key);
        if (held !== undefined && now() - held.at < checkKeptMs) return held.answer;
        const answer = await check(position, signal);
        // A refusal for the person or for asking too often says nothing lasting of the position.
        if (answer.kind === `clear` || answer.code === `live_position`) kept.set(key, { answer, at: now() });
        return answer;
    }

    return {
        id: source.id,
        label: source.label,
        runs: source.runs,
        async *read(position, ask, signal) {
            // Read through a call, as the signal may abort across any wait below.
            const left = () => signal.aborted;
            if (seats.seated() || (await bySelf())) {
                yield seatedRefusal;
                return;
            }
            if (left()) return;
            const answer = await cleared(position, signal);
            if (left()) return;
            if (answer.kind === `refused`) {
                yield { kind: `refused`, code: answer.code, retryAfter: answer.retryAfter };
                return;
            }
            const inner = new AbortController();
            const stop = () => {
                inner.abort();
            };
            signal.addEventListener(`abort`, stop, { once: true });
            const seat = { taken: false };
            const unsubscribe = seats.subscribe(() => {
                if (!seats.seated()) return;
                seat.taken = true;
                inner.abort();
            });
            try {
                for await (const event of source.read(position, ask, inner.signal)) {
                    if (inner.signal.aborted) break;
                    yield event;
                }
            } finally {
                unsubscribe();
                signal.removeEventListener(`abort`, stop);
            }
            if (seat.taken && !left()) yield seatedRefusal;
        },
    };
}
