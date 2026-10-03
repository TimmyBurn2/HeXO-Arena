// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { undeclaredValues } from '@hexo-arena/contract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPosition, guarded, seatedByMe, type PositionCheck } from '../src/analysis/guard';
import { SeatWatch, useSeatBroadcast, type SeatPort } from '../src/analysis/seat-channel';
import type { AnalysisPosition, EvaluationSource, Reading, SourceEvent } from '../src/analysis/sources';
import { meStore } from '../src/me';

// Tabs of one browser on an in-memory channel: what one posts, every other hears at once.
function channel(): { open: () => SeatPort; posted: unknown[] } {
    const ports = new Set<{ port: SeatPort; listeners: Set<(event: MessageEvent) => void> }>();
    const posted: unknown[] = [];
    function open(): SeatPort {
        const listeners = new Set<(event: MessageEvent) => void>();
        const port: SeatPort = {
            postMessage(message) {
                posted.push(message);
                for (const other of ports) if (other.port !== port) for (const listener of other.listeners) listener(new MessageEvent(`message`, { data: message }));
            },
            addEventListener(_type, listener) {
                listeners.add(listener);
            },
            removeEventListener(_type, listener) {
                listeners.delete(listener);
            },
            close() {
                ports.delete(entry);
            },
        };
        const entry = { port, listeners };
        ports.add(entry);
        return port;
    }
    return { open, posted };
}

const position: AnalysisPosition = { cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` };
const reading: Reading = { by: { kind: `worker`, engine: `toy`, version: `0.3` }, values: undeclaredValues, lines: [{ cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }], evaluation: { heuristic: -0.1 } }], seconds: 1, final: true, elapsedMs: 40 };

// An engine that says it thinks, then reads once `finish` is called, or stops when its signal aborts.
function engine(): { source: EvaluationSource; reads: AbortSignal[]; finish: () => void } {
    const reads: AbortSignal[] = [];
    let finish = () => undefined;
    const source: EvaluationSource = {
        id: `worker:toy`,
        label: `toy`,
        runs: `auto`,
        async *read(_position, _ask, signal) {
            reads.push(signal);
            yield { kind: `thinking` };
            const ended = await new Promise<boolean>((resolve) => {
                finish = () => {
                    resolve(true);
                };
                signal.addEventListener(`abort`, () => {
                    resolve(false);
                });
            });
            if (ended) yield { kind: `reading`, reading };
        },
    };
    return {
        source,
        reads,
        finish: () => {
            finish();
        },
    };
}

async function all(events: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
    const seen: SourceEvent[] = [];
    for await (const event of events) seen.push(event);
    return seen;
}

const ask = { lines: 1, seconds: 1 } as const;
const nobody = { seated: () => false, subscribe: () => () => undefined };
const clear = (): Promise<PositionCheck> => Promise.resolve({ kind: `clear` });

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
});

describe('a guarded engine', () => {
    it('reads a position only once the site clears it, and asks the site once a minute at most for the same position', async () => {
        const toy = engine();
        let clock = 0;
        const check = vi.fn(clear);
        const source = guarded(toy.source, { seats: nobody, seatedByMe: () => Promise.resolve(false), check, now: () => clock });
        expect(source).toMatchObject({ id: `worker:toy`, label: `toy`, runs: `auto` });
        const first = all(source.read(position, ask, new AbortController().signal));
        await vi.waitFor(() => {
            expect(toy.reads).toHaveLength(1);
        });
        toy.finish();
        expect(await first).toEqual([{ kind: `thinking` }, { kind: `reading`, reading }]);
        const again = all(source.read(position, ask, new AbortController().signal));
        await vi.waitFor(() => {
            expect(toy.reads).toHaveLength(2);
        });
        toy.finish();
        await again;
        expect(check).toHaveBeenCalledTimes(1);
        clock = 60_000;
        const later = all(source.read(position, ask, new AbortController().signal));
        await vi.waitFor(() => {
            expect(toy.reads).toHaveLength(3);
        });
        toy.finish();
        await later;
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('reads nothing of a position the site refuses, keeping a live game\'s refusal and asking again after any other', async () => {
        const toy = engine();
        const answers: PositionCheck[] = [
            { kind: `refused`, code: `rate_limited`, retryAfter: 3 },
            { kind: `refused`, code: `live_position`, retryAfter: null },
        ];
        const check = vi.fn(() => Promise.resolve(answers.shift() ?? { kind: `clear` as const }));
        const source = guarded(toy.source, { seats: nobody, seatedByMe: () => Promise.resolve(false), check, now: () => 0 });
        expect(await all(source.read(position, ask, new AbortController().signal))).toEqual([{ kind: `refused`, code: `rate_limited`, retryAfter: 3 }]);
        expect(await all(source.read(position, ask, new AbortController().signal))).toEqual([{ kind: `refused`, code: `live_position`, retryAfter: null }]);
        expect(await all(source.read(position, ask, new AbortController().signal))).toEqual([{ kind: `refused`, code: `live_position`, retryAfter: null }]);
        expect(check).toHaveBeenCalledTimes(2);
        expect(toy.reads).toHaveLength(0);
    });

    it('stays off while the person\'s own record names a live game of theirs, asking the site nothing', async () => {
        const toy = engine();
        const check = vi.fn(clear);
        const source = guarded(toy.source, { seats: nobody, seatedByMe: () => Promise.resolve(true), check });
        expect(await all(source.read(position, ask, new AbortController().signal))).toEqual([{ kind: `refused`, code: `seated`, retryAfter: null }]);
        expect(check).not.toHaveBeenCalled();
        expect(toy.reads).toHaveLength(0);
    });

    it('stays off while a game tab names a seat on the channel, stops a reading when one is named meanwhile, and reads again once it is freed', async () => {
        const tabs = channel();
        const toy = engine();
        const watch = new SeatWatch({ open: tabs.open, now: () => 0 });
        expect(tabs.posted).toEqual([{ type: `ask` }]);
        const source = guarded(toy.source, { seats: watch, seatedByMe: () => Promise.resolve(false), check: clear });

        const stopped = all(source.read(position, ask, new AbortController().signal));
        await vi.waitFor(() => {
            expect(toy.reads).toHaveLength(1);
        });
        const game = renderHook<undefined, { gameId: string | null }>(({ gameId }) => {
            useSeatBroadcast(gameId, tabs.open);
        }, { initialProps: { gameId: `g1` } });
        expect(await stopped).toEqual([{ kind: `thinking` }, { kind: `refused`, code: `seated`, retryAfter: null }]);
        expect(toy.reads[0]?.aborted).toBe(true);
        expect(await all(source.read(position, ask, new AbortController().signal))).toEqual([{ kind: `refused`, code: `seated`, retryAfter: null }]);

        game.rerender({ gameId: null });
        expect(watch.seated()).toBe(false);
        const freed = all(source.read(position, ask, new AbortController().signal));
        await vi.waitFor(() => {
            expect(toy.reads).toHaveLength(2);
        });
        toy.finish();
        expect(await freed).toEqual([{ kind: `thinking` }, { kind: `reading`, reading }]);
        watch.close();
    });
});

describe('the seat channel', () => {
    it('names a seat at once, again when a tab asks, and frees it when the game ends', () => {
        const tabs = channel();
        const game = renderHook<undefined, { gameId: string | null }>(({ gameId }) => {
            useSeatBroadcast(gameId, tabs.open);
        }, { initialProps: { gameId: `g1` } });
        expect(tabs.posted).toEqual([{ type: `seat`, gameId: `g1`, seated: true }]);
        const watch = new SeatWatch({ open: tabs.open });
        expect(watch.seated()).toBe(true);
        game.rerender({ gameId: null });
        expect(tabs.posted.at(-1)).toEqual({ type: `seat`, gameId: `g1`, seated: false });
        expect(watch.seated()).toBe(false);
        watch.close();
    });

    it('forgets a seat no tab has named for a while, as a tab closed without a word leaves it', () => {
        const tabs = channel();
        let clock = 0;
        const watch = new SeatWatch({ open: tabs.open, now: () => clock });
        tabs.open().postMessage({ type: `seat`, gameId: `g1`, seated: true });
        expect(watch.seated()).toBe(true);
        clock = 24_000;
        expect(watch.seated()).toBe(true);
        clock = 25_000;
        expect(watch.seated()).toBe(false);
        tabs.open().postMessage({ type: `seat`, gameId: 7, seated: true });
        expect(watch.seated()).toBe(false);
        watch.close();
    });
});

describe('the site\'s clearance', () => {
    function answering(status: number, body: object | null, headers: Record<string, string> = {}): typeof fetch {
        return vi.fn(() => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers })));
    }

    it('posts the position and reads 204 as clear, a live game or a seat as refused, and too many as refused with the wait', async () => {
        const signal = new AbortController().signal;
        const fetcher = answering(204, null);
        expect(await checkPosition(position, signal, fetcher)).toEqual({ kind: `clear` });
        expect(fetcher).toHaveBeenCalledWith(`/api/analysis/check`, expect.objectContaining({ method: `POST`, body: JSON.stringify({ cells: position.cells, toMove: `o` }) }));
        expect(await checkPosition(position, signal, answering(409, { code: `live_position` }))).toEqual({ kind: `refused`, code: `live_position`, retryAfter: null });
        expect(await checkPosition(position, signal, answering(409, { code: `seated` }))).toEqual({ kind: `refused`, code: `seated`, retryAfter: null });
        expect(await checkPosition(position, signal, answering(429, { code: `rate_limited` }, { 'retry-after': `4` }))).toEqual({ kind: `refused`, code: `rate_limited`, retryAfter: 4 });
        expect(await checkPosition(position, signal, answering(503, null))).toEqual({ kind: `refused`, code: `unavailable`, retryAfter: null });
        const broken = vi.fn(() => Promise.reject(new Error(`offline`)));
        expect(await checkPosition(position, signal, broken)).toEqual({ kind: `refused`, code: `unavailable`, retryAfter: null });
    });

    it('takes the person as seated only while their record names a live game, read again at most every half minute', async () => {
        const game = {
            gameId: `g1`,
            players: { x: { name: `quinn`, rating: 1503, provisional: false, kind: `user` }, o: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` } },
            timeControl: { mode: `unlimited` },
            toMove: `o`,
            rated: true,
            cells: [{ x: 0, y: 0, side: `x` }],
            clock: { mode: `unlimited` },
        };
        // The record names the game on the first two reads, and no longer once it has ended.
        const records = [[game], [game], []];
        const fetcher = vi.fn(() => {
            const liveGames = records.shift() ?? [];
            return Promise.resolve(new Response(JSON.stringify({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames, analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } })));
        });
        vi.stubGlobal(`fetch`, fetcher);
        let clock = 0;
        const seated = seatedByMe(() => clock);
        expect(await seated()).toBe(false);
        expect(fetcher).not.toHaveBeenCalled();
        await meStore.refresh();
        expect(await seated()).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
        clock = 29_999;
        expect(await seated()).toBe(true);
        expect(fetcher).toHaveBeenCalledTimes(2);
        clock = 30_000;
        expect(await seated()).toBe(false);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
});
