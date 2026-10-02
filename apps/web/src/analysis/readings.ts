import { useCallback, useSyncExternalStore } from 'react';
import { analysisDwellMs, type AnalysisFailure } from '@hexo-arena/contract';
import { authorSourceId, type AnalysisPosition, type EvaluationSource, type Reading, type ReadingAsk, type ReadingAuthor, type ReadingRefusal } from './sources';

/** Where a source's latest ask of a position stands. */
export type ReadingState =
    | { readonly kind: `idle` }
    | { readonly kind: `thinking` }
    | { readonly kind: `queued`; readonly ahead: number; readonly by: ReadingAuthor | null }
    | { readonly kind: `refused`; readonly code: ReadingRefusal; readonly retryAfter: number | null }
    | { readonly kind: `failed`; readonly code: AnalysisFailure; readonly by: ReadingAuthor | null };

/** A reading in hand, with what it was asked for. */
export interface HeldReading {
    readonly reading: Reading;
    readonly ask: ReadingAsk;
}

/** What one source holds for one position: its latest reading, if any, and where its latest ask stands. */
export interface ReadingEntry {
    readonly read: HeldReading | null;
    readonly state: ReadingState;
}

/** A position a source may read: the source, the position and its key, and what to ask. */
export interface ReadingTarget {
    readonly source: EvaluationSource;
    readonly position: AnalysisPosition;
    readonly key: string;
    readonly ask: ReadingAsk;
}

type Listener = () => void;

const noEntries: ReadonlyMap<string, ReadingEntry> = new Map();
const idle: ReadingState = { kind: `idle` };

/** Whether a reading asked for `held` answers `ask` too: as many lines, as long a look. */
export function covers(held: ReadingAsk, ask: ReadingAsk): boolean {
    return held.lines >= ask.lines && held.seconds >= ask.seconds;
}

/** The start of the next UTC day after `at`, when the day's readings come back. */
export function nextUtcDay(at: number): number {
    const date = new Date(at);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function targetId(target: ReadingTarget): string {
    return `${target.source.id}\u0000${target.key}\u0000${String(target.ask.lines)}\u0000${String(target.ask.seconds)}`;
}

/**
 * The readings the analysis board holds, by position key and then source id,
 * whichever source they came from: asked of an analyzer, stored with a game, or a bot's own view.
 * The board tells it where it stands; it asks, after a short dwell, only what nothing held answers,
 * keeps one ask out per source, and drops it when the board moves on.
 * A source asked only when the person asks reads only while `asking` is on, or on `ask`.
 */
export class ReadingsStore {
    private readonly dwellMs: number;
    private readonly alias: (reading: Reading) => string | null;
    private readonly now: () => number;
    private readonly listeners = new Set<Listener>();
    private entries = new Map<string, ReadonlyMap<string, ReadingEntry>>();
    // One ask out per source at a time, by source id.
    private readonly outstanding = new Map<string, { readonly id: string; readonly target: ReadingTarget; readonly controller: AbortController }>();
    private timer: ReturnType<typeof setTimeout> | null = null;
    private spentUntil: number | null = null;

    constructor({ dwellMs = analysisDwellMs, alias = authorSourceId, now = Date.now }: {
        dwellMs?: number;
        alias?: (reading: Reading) => string | null;
        now?: () => number;
    } = {}) {
        this.dwellMs = dwellMs;
        this.alias = alias;
        this.now = now;
    }

    readonly subscribe = (listener: Listener): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** Every source's entry for a position, by source id; the same map until one of them changes. */
    at(key: string): ReadonlyMap<string, ReadingEntry> {
        return this.entries.get(key) ?? noEntries;
    }

    entry(sourceId: string, key: string): ReadingEntry | undefined {
        return this.entries.get(key)?.get(sourceId);
    }

    /** Every position's entries, by key; a new map whenever any entry changes. */
    snapshot(): ReadonlyMap<string, ReadonlyMap<string, ReadingEntry>> {
        return this.entries;
    }

    /** File a reading that came from elsewhere, such as one stored with a game. */
    put(sourceId: string, key: string, reading: Reading, ask: ReadingAsk): void {
        this.file(sourceId, key, reading, ask);
        this.changed();
    }

    /**
     * File readings stored with a game, each under every one of its ids that holds none for its position yet:
     * a reading in hand, asked for on this board, is never displaced by a stored one.
     */
    keep(readings: readonly { readonly ids: readonly string[]; readonly key: string; readonly reading: Reading; readonly ask: ReadingAsk }[]): void {
        let filed = false;
        for (const { ids, key, reading, ask } of readings) {
            for (const id of ids) {
                const entry = this.entry(id, key);
                if (entry?.read !== null && entry?.read !== undefined) continue;
                this.write(key, id, { read: { reading, ask }, state: entry?.state ?? idle });
                filed = true;
            }
        }
        if (filed) this.changed();
    }

    /**
     * The day's readings are spent until `until`, or no longer when null:
     * positions are then not asked of analyzers on their own, and read as refused.
     */
    spend(until: number | null): void {
        this.spentUntil = until;
    }

    /**
     * The board stands on a position, the targets naming how each source reads it:
     * an ask of any other position stops, and after the dwell each source reads what it holds nothing for.
     */
    visit(targets: readonly ReadingTarget[], asking: boolean): void {
        this.clearTimer();
        const ids = new Set(targets.map(targetId));
        for (const [sourceId, out] of [...this.outstanding]) if (!ids.has(out.id)) this.stop(sourceId);
        const due = targets.filter((target) => this.wants(target, asking));
        if (due.length === 0) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            for (const target of due) this.start(target);
        }, this.dwellMs);
    }

    /** Ask now, unless a reading in hand already answers it or the same ask is out. */
    ask(target: ReadingTarget): void {
        this.clearTimer();
        if (this.outstanding.get(target.source.id)?.id === targetId(target)) return;
        const held = this.entry(target.source.id, target.key)?.read;
        if (held !== null && held !== undefined && covers(held.ask, target.ask)) return;
        this.start(target);
    }

    /** The board leaves analysis: nothing waits or stays asked. */
    leave(): void {
        this.clearTimer();
        for (const sourceId of [...this.outstanding.keys()]) this.stop(sourceId);
    }

    private wants(target: ReadingTarget, asking: boolean): boolean {
        const { source, key, ask } = target;
        if (source.runs === `stored` || (source.runs === `on-ask` && !asking)) return false;
        if (this.outstanding.get(source.id)?.id === targetId(target)) return false;
        const entry = this.entry(source.id, key);
        if (entry?.read !== null && entry?.read !== undefined && covers(entry.read.ask, ask)) return false;
        // A failure is the analyzer's; asking again on its own would only strike it again.
        if (entry?.state.kind === `failed`) return false;
        if (this.spentUntil !== null && source.runs === `on-ask`) {
            if (this.now() < this.spentUntil) {
                this.setState(source.id, key, { kind: `refused`, code: `analysis_limit`, retryAfter: Math.ceil((this.spentUntil - this.now()) / 1000) });
                this.changed();
                return false;
            }
            this.spentUntil = null;
        }
        return true;
    }

    private start(target: ReadingTarget): void {
        const sourceId = target.source.id;
        this.stop(sourceId);
        const controller = new AbortController();
        this.outstanding.set(sourceId, { id: targetId(target), target, controller });
        this.setState(sourceId, target.key, { kind: `thinking` });
        this.changed();
        void this.run(target, controller.signal).finally(() => {
            if (this.outstanding.get(sourceId)?.controller === controller) this.outstanding.delete(sourceId);
        });
    }

    private async run(target: ReadingTarget, signal: AbortSignal): Promise<void> {
        const { source, key, ask } = target;
        try {
            for await (const event of source.read(target.position, ask, signal)) {
                if (signal.aborted) return;
                switch (event.kind) {
                    case `thinking`:
                        this.setState(source.id, key, { kind: `thinking` });
                        break;
                    case `queued`:
                        this.setState(source.id, key, { kind: `queued`, ahead: event.ahead, by: event.by });
                        break;
                    case `reading`:
                        // A deepening reading on its way answers only as long a look as it has had.
                        this.file(source.id, key, event.reading, event.reading.final ? ask : { ...ask, seconds: Math.min(ask.seconds, event.reading.seconds) });
                        this.setState(source.id, key, idle);
                        break;
                    case `refused`:
                        if (event.code === `analysis_limit`) {
                            this.spentUntil = event.retryAfter === null ? nextUtcDay(this.now()) : this.now() + event.retryAfter * 1000;
                        }
                        this.setState(source.id, key, { kind: `refused`, code: event.code, retryAfter: event.retryAfter });
                        break;
                    case `failed`:
                        this.setState(source.id, key, { kind: `failed`, code: event.code, by: event.by });
                        break;
                }
                this.changed();
            }
        } catch {
            if (signal.aborted) return;
            this.setState(source.id, key, { kind: `refused`, code: `unavailable`, retryAfter: null });
            this.changed();
        }
    }

    // Stopping an ask leaves the position as if it had not been asked, keeping any reading in hand.
    private stop(sourceId: string): void {
        const outstanding = this.outstanding.get(sourceId);
        if (outstanding === undefined) return;
        this.outstanding.delete(sourceId);
        outstanding.controller.abort();
        const { source, key } = outstanding.target;
        const state = this.entry(source.id, key)?.state.kind;
        if (state === `thinking` || state === `queued`) {
            this.setState(source.id, key, idle);
            this.changed();
        }
    }

    private clearTimer(): void {
        if (this.timer === null) return;
        clearTimeout(this.timer);
        this.timer = null;
    }

    // A reading by a named bot also answers asks of that bot by name.
    private file(sourceId: string, key: string, reading: Reading, ask: ReadingAsk): void {
        const ids = [sourceId];
        const alias = this.alias(reading);
        if (alias !== null && alias !== sourceId) ids.push(alias);
        for (const id of ids) {
            const entry = this.entry(id, key);
            this.write(key, id, { read: { reading, ask }, state: entry?.state ?? idle });
        }
    }

    private setState(sourceId: string, key: string, state: ReadingState): void {
        this.write(key, sourceId, { read: this.entry(sourceId, key)?.read ?? null, state });
    }

    private write(key: string, sourceId: string, entry: ReadingEntry): void {
        const at = new Map(this.entries.get(key));
        at.set(sourceId, entry);
        const entries = new Map(this.entries);
        entries.set(key, at);
        this.entries = entries;
    }

    private changed(): void {
        for (const listener of this.listeners) listener();
    }
}

/** The readings this page holds, kept while the person moves between the site's pages. */
export const readings = new ReadingsStore();

/** Every source's entry for a position, read from a store. */
export function useReadingsAt(store: ReadingsStore, key: string): ReadonlyMap<string, ReadingEntry> {
    const read = useCallback(() => store.at(key), [store, key]);
    return useSyncExternalStore(store.subscribe, read, read);
}

/** Every position's entries a store holds, read again whenever one changes. */
export function useReadingsSnapshot(store: ReadingsStore): ReadonlyMap<string, ReadonlyMap<string, ReadingEntry>> {
    const read = useCallback(() => store.snapshot(), [store]);
    return useSyncExternalStore(store.subscribe, read, read);
}
