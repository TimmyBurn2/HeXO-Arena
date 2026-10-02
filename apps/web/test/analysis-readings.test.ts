import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadingsStore, covers, nextUtcDay, type ReadingTarget } from '../src/analysis/readings';
import { authorSourceId, type AnalysisPosition, type EvaluationSource, type Reading, type ReadingAsk, type SourceEvent } from '../src/analysis/sources';

interface Call {
    readonly position: AnalysisPosition;
    readonly ask: ReadingAsk;
    readonly signal: AbortSignal;
    push: (event: SourceEvent) => void;
    end: () => void;
}

// A source the test answers by hand, one call per read.
function scripted(id: string, runs: EvaluationSource[`runs`] = `on-ask`): { source: EvaluationSource; calls: Call[] } {
    const calls: Call[] = [];
    const source: EvaluationSource = {
        id,
        label: id,
        runs,
        read(position, ask, signal) {
            const queue: SourceEvent[] = [];
            // Held in an object, since the calls below change them from outside the loop.
            const flow: { done: boolean; wake: (() => void) | null } = { done: false, wake: null };
            const call: Call = {
                position,
                ask,
                signal,
                push(event) {
                    queue.push(event);
                    flow.wake?.();
                },
                end() {
                    flow.done = true;
                    flow.wake?.();
                },
            };
            signal.addEventListener(`abort`, () => {
                flow.done = true;
                flow.wake?.();
            });
            calls.push(call);
            return (async function* () {
                for (;;) {
                    for (let next = queue.shift(); next !== undefined; next = queue.shift()) yield next;
                    if (flow.done) return;
                    await new Promise<void>((resolve) => {
                        flow.wake = resolve;
                    });
                    flow.wake = null;
                }
            })();
        },
    };
    return { source, calls };
}

const origin: AnalysisPosition = { cells: [{ x: 0, y: 0, side: `x` }], toMove: `o` };
const later: AnalysisPosition = { cells: [{ x: 0, y: 0, side: `x` }, { x: 1, y: 0, side: `o` }, { x: 0, y: 1, side: `o` }], toMove: `x` };
const three: ReadingAsk = { lines: 3, seconds: 2 };

function reading(name: string, heuristic = 0.12): Reading {
    return {
        by: { kind: `bot`, name, version: `0.9`, ownerName: `tom` },
        lines: [{ cells: [{ x: 1, y: -1 }, { x: 0, y: -1 }], evaluation: { heuristic } }],
        seconds: 2,
        final: true,
        elapsedMs: 1800,
    };
}

function target(source: EvaluationSource, key: string, position: AnalysisPosition = origin, ask: ReadingAsk = three): ReadingTarget {
    return { source, position, key, ask };
}

let clock = Date.parse(`2026-10-02T12:00:00Z`);
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] });
    clock = Date.parse(`2026-10-02T12:00:00Z`);
});

afterEach(() => {
    vi.useRealTimers();
});

function store(): ReadingsStore {
    return new ReadingsStore({ dwellMs: 600, alias: authorSourceId, now: () => clock });
}

describe('the readings store', () => {
    it('asks once the board has rested on a position for the dwell, and not before', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], true);
        await tick(599);
        expect(calls).toHaveLength(0);
        await tick(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.ask).toEqual(three);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `thinking` });
    });

    it('asks nothing on its own while Analyze is off, and reads at once when asked', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], false);
        await tick(5_000);
        expect(calls).toHaveLength(0);
        readings.ask(target(source, `a`));
        expect(calls).toHaveLength(1);
    });

    it('asks nothing for a position the board only passed through', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], true);
        await tick(300);
        readings.visit([target(source, `b`, later)], true);
        await tick(300);
        expect(calls).toHaveLength(0);
        await tick(300);
        expect(calls.map((call) => call.position)).toEqual([later]);
    });

    it('drops the ask out when the board moves on, keeping the position unread', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        readings.visit([target(source, `b`, later)], true);
        expect(calls[0]?.signal.aborted).toBe(true);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `idle` });
        expect(readings.entry(`bot:kestrel`, `a`)?.read).toBeNull();
    });

    it('keeps the ask out while the board stays on its position', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.signal.aborted).toBe(false);
    });

    it('follows a queued ask to its reading, and asks nothing a reading in hand answers', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        calls[0]?.push({ kind: `queued`, ahead: 2, by: reading(`kestrel`).by });
        await tick(0);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `queued`, ahead: 2, by: reading(`kestrel`).by });
        calls[0]?.push({ kind: `reading`, reading: reading(`kestrel`) });
        calls[0]?.end();
        await tick(0);
        expect(readings.entry(`bot:kestrel`, `a`)).toEqual({ read: { reading: reading(`kestrel`), ask: three }, state: { kind: `idle` } });
        readings.visit([target(source, `b`, later)], true);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(1);
        readings.ask(target(source, `a`, origin, { lines: 2, seconds: 1 }));
        expect(calls).toHaveLength(1);
    });

    it('asks again for more lines or a longer look than the reading in hand had, showing that reading meanwhile', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.put(`bot:kestrel`, `a`, reading(`kestrel`), { lines: 1, seconds: 2 });
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(1);
        expect(readings.entry(`bot:kestrel`, `a`)?.read?.ask).toEqual({ lines: 1, seconds: 2 });
        expect(readings.entry(`bot:kestrel`, `a`)?.state.kind).toBe(`thinking`);
    });

    it('files a reading by whichever analyzer was free under that analyzer\'s name too', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:*`);
        readings.ask(target(source, `a`));
        calls[0]?.push({ kind: `reading`, reading: reading(`driftwood`) });
        calls[0]?.end();
        await tick(0);
        expect([...readings.at(`a`).keys()]).toEqual([`bot:*`, `bot:driftwood`]);
        expect(readings.entry(`bot:driftwood`, `a`)?.read?.reading.by).toMatchObject({ name: `driftwood` });
    });

    it('asks again on its own after a refusal, but leaves a failed reading to the person', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.ask(target(source, `a`));
        calls[0]?.push({ kind: `refused`, code: `live_position`, retryAfter: null });
        calls[0]?.end();
        await tick(0);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `refused`, code: `live_position`, retryAfter: null });
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(2);
        calls[1]?.push({ kind: `failed`, code: `timeout`, by: reading(`kestrel`).by });
        calls[1]?.end();
        await tick(0);
        readings.visit([target(source, `b`, later)], false);
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(2);
        readings.ask(target(source, `a`));
        expect(calls).toHaveLength(3);
    });

    it('reads every position as refused once the day is spent, asking nothing on its own until the day turns', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.ask(target(source, `a`));
        calls[0]?.push({ kind: `refused`, code: `analysis_limit`, retryAfter: 3_600 });
        calls[0]?.end();
        await tick(0);
        readings.visit([target(source, `b`, later)], true);
        await tick(600);
        expect(calls).toHaveLength(1);
        expect(readings.entry(`bot:kestrel`, `b`)?.state).toEqual({ kind: `refused`, code: `analysis_limit`, retryAfter: 3_600 });
        clock += 3_600_000;
        readings.visit([target(source, `c`)], true);
        await tick(600);
        expect(calls).toHaveLength(2);
    });

    it('starts the day spent when told so, and still asks when the person asks', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        readings.spend(nextUtcDay(clock));
        readings.visit([target(source, `a`)], true);
        await tick(600);
        expect(calls).toHaveLength(0);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toMatchObject({ kind: `refused`, code: `analysis_limit`, retryAfter: 43_200 });
        readings.ask(target(source, `a`));
        expect(calls).toHaveLength(1);
    });

    it('stops every ask and every wait when the board leaves', () => {
        const readings = store();
        const kestrel = scripted(`bot:kestrel`);
        readings.ask(target(kestrel.source, `a`));
        readings.visit([target(kestrel.source, `a`)], true);
        readings.leave();
        expect(kestrel.calls[0]?.signal.aborted).toBe(true);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `idle` });
    });

    it('never asks a stored source, and reads one that runs on every position whether or not Analyze is on', async () => {
        const readings = store();
        const stored = scripted(`own:g:x`, `stored`);
        const worker = scripted(`worker:toy`, `auto`);
        readings.visit([target(stored.source, `a`), target(worker.source, `a`)], false);
        await tick(600);
        expect(stored.calls).toHaveLength(0);
        expect(worker.calls).toHaveLength(1);
    });

    it('turns a source that breaks into the plain refusal', async () => {
        const readings = store();
        const broken: EvaluationSource = {
            id: `bot:kestrel`,
            label: `kestrel`,
            runs: `on-ask`,
            read() {
                return (async function* (): AsyncGenerator<SourceEvent> {
                    yield { kind: `thinking` };
                    await Promise.resolve();
                    throw new Error(`boom`);
                })();
            },
        };
        readings.ask(target(broken, `a`));
        await tick(0);
        expect(readings.entry(`bot:kestrel`, `a`)?.state).toEqual({ kind: `refused`, code: `unavailable`, retryAfter: null });
    });

    it('tells its listeners of each change and hands out the same map until one comes', async () => {
        const readings = store();
        const { source, calls } = scripted(`bot:kestrel`);
        const heard = vi.fn();
        readings.subscribe(heard);
        const before = readings.at(`a`);
        expect(readings.at(`a`)).toBe(before);
        readings.ask(target(source, `a`));
        expect(heard).toHaveBeenCalledTimes(1);
        expect(readings.at(`a`)).not.toBe(before);
        const thinking = readings.at(`a`);
        calls[0]?.push({ kind: `reading`, reading: reading(`kestrel`) });
        await tick(0);
        expect(readings.at(`a`)).not.toBe(thinking);
    });
});

describe('a reading in hand', () => {
    it('answers an ask of as many lines or fewer and as long a look or shorter', () => {
        expect(covers({ lines: 3, seconds: 2 }, { lines: 2, seconds: 2 })).toBe(true);
        expect(covers({ lines: 2, seconds: 5 }, { lines: 3, seconds: 1 })).toBe(false);
        expect(covers({ lines: 3, seconds: 1 }, { lines: 3, seconds: 2 })).toBe(false);
    });

    it('comes back with the next UTC day', () => {
        expect(nextUtcDay(Date.parse(`2026-10-02T23:59:59Z`))).toBe(Date.parse(`2026-10-03T00:00:00Z`));
        expect(nextUtcDay(Date.parse(`2026-12-31T00:00:00Z`))).toBe(Date.parse(`2027-01-01T00:00:00Z`));
    });
});
