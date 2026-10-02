import { readingCacheEntries, readingCacheTtlMs, type AnalysisLine, type AnalyzerRef } from '@hexo-arena/contract';

/** One analyzer's reading of one exact position, as a later request may be served it. */
export interface CachedReading {
    readonly botId: string;
    readonly analyzer: AnalyzerRef;
    /** The seconds the analyzer was given, and the most it declared then. */
    readonly seconds: number;
    readonly maxSeconds: number;
    readonly lines: readonly AnalysisLine[];
    readonly elapsedMs: number;
    readonly readAt: number;
}

/**
 * Readings by analyzer and exact position, in memory only, the least
 * recently used leaving first past the cap, and none served past its age.
 */
export class ReadingCache {
    readonly #entries = new Map<string, CachedReading>();
    readonly #byPosition = new Map<string, Set<string>>();
    readonly #now: () => number;
    readonly #cap: number;

    constructor(now: () => number, cap = readingCacheEntries) {
        this.#now = now;
        this.#cap = cap;
    }

    get size(): number {
        return this.#entries.size;
    }

    put(positionKey: string, reading: CachedReading): void {
        const key = entryKey(reading.botId, positionKey);
        this.#entries.delete(key);
        this.#entries.set(key, reading);
        const analyzers = this.#byPosition.get(positionKey) ?? new Set();
        analyzers.add(reading.botId);
        this.#byPosition.set(positionKey, analyzers);
        for (const oldest of this.#entries.keys()) {
            if (this.#entries.size <= this.#cap) break;
            this.#drop(oldest);
        }
    }

    /**
     * A reading of the position good enough for the request: by the named
     * analyzer, or by any when none is named, given at least the seconds asked
     * or the most its analyzer allowed. The longest-read wins among several.
     */
    find(positionKey: string, botId: string | null, seconds: number): CachedReading | null {
        const analyzers = botId === null ? [...(this.#byPosition.get(positionKey) ?? [])] : [botId];
        let best: CachedReading | null = null;
        for (const analyzer of analyzers) {
            const key = entryKey(analyzer, positionKey);
            const reading = this.#entries.get(key);
            if (reading === undefined) continue;
            if (reading.readAt + readingCacheTtlMs <= this.#now()) {
                this.#drop(key);
                continue;
            }
            if (reading.seconds < Math.min(seconds, reading.maxSeconds)) continue;
            if (best === null || reading.seconds > best.seconds) best = reading;
        }
        if (best !== null) {
            const key = entryKey(best.botId, positionKey);
            this.#entries.delete(key);
            this.#entries.set(key, best);
        }
        return best;
    }

    #drop(key: string): void {
        const reading = this.#entries.get(key);
        this.#entries.delete(key);
        if (reading === undefined) return;
        const positionKey = key.slice(key.indexOf(`|`) + 1);
        const analyzers = this.#byPosition.get(positionKey);
        analyzers?.delete(reading.botId);
        if (analyzers?.size === 0) this.#byPosition.delete(positionKey);
    }
}

function entryKey(botId: string, positionKey: string): string {
    return `${botId}|${positionKey}`;
}
