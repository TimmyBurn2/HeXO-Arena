import type { RateLimit } from '@hexo-arena/contract';

/**
 * GCRA buckets, one number per key:
 * the time the key's next request would be due if it kept to its rate.
 * A key whose time has passed holds a full bucket, so it leaves the map;
 * past the key cap the oldest key leaves, which only refills it.
 */
export class RateBuckets {
    readonly #due = new Map<string, number>();
    readonly #limit: RateLimit;
    readonly #now: () => number;
    readonly #maxKeys: number;

    constructor(limit: RateLimit, now: () => number, maxKeys = Number.POSITIVE_INFINITY) {
        this.#limit = limit;
        this.#now = now;
        this.#maxKeys = maxKeys;
    }

    get size(): number {
        return this.#due.size;
    }

    /** Spends a token of the key's bucket: null when admitted, else whole seconds until one returns. */
    take(key: string): number | null {
        const now = this.#now();
        const { burst, refillMs } = this.#limit;
        const due = Math.max(this.#due.get(key) ?? now, now) + refillMs;
        const allowedAt = due - burst * refillMs;
        if (allowedAt > now) return Math.max(1, Math.ceil((allowedAt - now) / 1_000));
        // Reinserted, so the map's order is the order keys were last used.
        this.#due.delete(key);
        this.#due.set(key, due);
        if (this.#due.size > this.#maxKeys) {
            const oldest = this.#due.keys().next();
            if (oldest.done !== true) this.#due.delete(oldest.value);
        }
        return null;
    }

    sweep(): void {
        const now = this.#now();
        for (const [key, due] of [...this.#due]) if (due <= now) this.#due.delete(key);
    }

    clear(): void {
        this.#due.clear();
    }
}
