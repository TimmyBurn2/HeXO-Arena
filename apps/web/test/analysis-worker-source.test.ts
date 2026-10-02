import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireToInternal, type BwsMoveRequestPacket } from '@hexo-arena/contract';
import type { AnalysisPosition, SourceEvent } from '../src/analysis/sources';
import { workerSource } from '../src/analysis/worker-source';
import { analysisCapabilities, pieces, toyEngine } from './analysis-worker';

// The origin alone, o to move: o's lines run through the cells around it.
const origin: AnalysisPosition = { cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` };

// Reads deeper the longer it is given: o's best value grows with the seconds.
function deepening(request: BwsMoveRequestPacket) {
    const seconds = request.move_time_limit ?? 0;
    return {
        move: { pieces: pieces({ x: 1, y: 0 }, { x: 0, y: 1 }), evaluation: { heuristic: -0.1 * seconds } },
        considerations: [
            { pieces: pieces({ x: -1, y: 0 }, { x: 0, y: -1 }), evaluation: { heuristic: 0.05 } },
            { pieces: pieces({ x: 1, y: -1 }, { x: -1, y: 1 }), evaluation: { win_in: 3 } },
        ],
    };
}

async function all(events: AsyncIterable<SourceEvent>): Promise<SourceEvent[]> {
    const seen: SourceEvent[] = [];
    for await (const event of events) seen.push(event);
    return seen;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('an engine in the browser', () => {
    it('sets each position up afresh and asks again at each deepening step up to the seconds asked, every reading but the last not final', async () => {
        const engine = toyEngine({ answer: deepening });
        const source = workerSource({ connect: () => engine.port, engine: `toy` });
        expect(source).toMatchObject({ id: `worker:toy`, label: `toy`, runs: `auto` });
        const events = await all(source.read(origin, { lines: 2, seconds: 1 }, new AbortController().signal));
        expect(events[0]).toEqual({ kind: `thinking` });
        const readings = events.flatMap((event) => (event.kind === `reading` ? [event.reading] : []));
        expect(readings.map((reading) => [reading.seconds, reading.final])).toEqual([
            [0.25, false],
            [0.5, false],
            [1, true],
        ]);
        expect(readings[2]?.by).toEqual({ kind: `worker`, engine: `toy`, version: `0.3` });
        expect(readings[2]?.lines).toEqual([
            { cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }], evaluation: { heuristic: -0.1 } },
            { cells: [{ x: -1, y: 0 }, { x: 0, y: -1 }], evaluation: { heuristic: 0.05 } },
        ]);
        expect(engine.requests).toEqual([0.25, 0.5, 1].map((seconds, index) => ({ type: `move_request`, side: `o`, previous: [], move_time_limit: seconds, request_id: index + 1 })));
        expect(engine.setups).toHaveLength(3);
        expect(engine.setups[0]?.map((cell) => ({ ...wireToInternal(cell), side: cell.p }))).toEqual(origin.cells);
    });

    it('interrupts the request out when the board leaves the position, and reads nothing more of it', async () => {
        const engine = toyEngine({ answer: deepening, delayMs: 200 });
        const source = workerSource({ connect: () => engine.port, engine: `toy` });
        const leaving = new AbortController();
        const reading = all(source.read(origin, { lines: 1, seconds: 2 }, leaving.signal));
        await vi.waitFor(() => {
            expect(engine.requests).toHaveLength(1);
        });
        leaving.abort();
        expect(await reading).toEqual([{ kind: `thinking` }]);
        await vi.waitFor(() => {
            expect(engine.interrupts).toEqual([1]);
        });
        // The same session reads the next position, its ids going on from the dropped one.
        const next = await all(source.read(origin, { lines: 1, seconds: 1 }, new AbortController().signal));
        expect(next.filter((event) => event.kind === `reading`)).toHaveLength(3);
        expect(engine.requests.map((request) => request.request_id)).toEqual([1, 2, 3, 4]);
    });

    it('fails a reading whose move is no legal turn or holds no evaluation, and leaves out such considerations', async () => {
        const read = async (answer: object) => {
            const engine = toyEngine({ answer: () => answer });
            return all(workerSource({ connect: () => engine.port, engine: `toy` }).read(origin, { lines: 3, seconds: 1 }, new AbortController().signal));
        };
        expect((await read({ move: { pieces: pieces({ x: 0, y: 0 }, { x: 1, y: 0 }), evaluation: { heuristic: 0 } } })).at(-1)).toEqual({ kind: `failed`, code: `illegal`, by: null });
        expect((await read({ move: { pieces: pieces({ x: 1, y: 0 }, { x: 0, y: 1 }) } })).at(-1)).toEqual({ kind: `failed`, code: `no_evaluation`, by: null });
        const kept = await read({
            move: { pieces: pieces({ x: 1, y: 0 }, { x: 0, y: 1 }), evaluation: { heuristic: -0.2 } },
            considerations: [
                { pieces: pieces({ x: 9, y: 9 }, { x: 0, y: 1 }), evaluation: { heuristic: 0.1 } },
                { pieces: pieces({ x: -1, y: 0 }, { x: 0, y: -1 }) },
                { pieces: pieces({ x: 0, y: 1 }, { x: 1, y: 0 }), evaluation: { heuristic: 0.3 } },
                { pieces: pieces({ x: -1, y: 1 }, { x: 1, y: -1 }), evaluation: { win_in: 2 } },
            ],
        });
        const last = kept.at(-1);
        expect(last?.kind === `reading` ? last.reading.lines.map((line) => line.cells) : null).toEqual([
            [{ x: 1, y: 0 }, { x: 0, y: 1 }],
            [{ x: -1, y: 1 }, { x: 1, y: -1 }],
        ]);
    });

    it('reads nothing with an engine that lacks a capability analysis needs', async () => {
        const capabilities = { basic_websocket: { versions: { 'v1-alpha': { ...analysisCapabilities.basic_websocket.versions[`v1-alpha`], interruptible: false } } } };
        const engine = toyEngine({ capabilities, answer: deepening });
        const events = await all(workerSource({ connect: () => engine.port, engine: `toy` }).read(origin, { lines: 1, seconds: 1 }, new AbortController().signal));
        expect(events).toEqual([{ kind: `thinking` }, { kind: `failed`, code: `protocol`, by: null }]);
        expect(engine.requests).toEqual([]);
    });

    it('fails a position the engine leaves unanswered past its seconds and the grace, interrupting it', async () => {
        const engine = toyEngine({ answer: () => null });
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] });
        const reading = all(workerSource({ connect: () => engine.port, engine: `toy` }).read(origin, { lines: 1, seconds: 1 }, new AbortController().signal));
        await vi.waitFor(() => {
            expect(engine.requests).toHaveLength(1);
        });
        await vi.advanceTimersByTimeAsync(250 + 3_000);
        expect(await reading).toEqual([{ kind: `thinking` }, { kind: `failed`, code: `timeout`, by: null }]);
        await vi.waitFor(() => {
            expect(engine.interrupts).toEqual([1]);
        });
    });
});
