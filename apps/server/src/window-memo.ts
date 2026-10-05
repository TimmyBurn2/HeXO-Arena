/**
 * Values remembered per key for a window, so every caller within it shares
 * one read; a clock that steps back starts a new window, and past `cap`
 * keys the oldest leaves first.
 */
export class WindowMemo<T> {
    readonly #entries = new Map<string, { readonly at: number; readonly value: T }>();
    readonly #windowMs: number;
    readonly #now: () => number;
    readonly #cap: number;

    constructor(options: { windowMs: number; now: () => number; cap?: number }) {
        this.#windowMs = options.windowMs;
        this.#now = options.now;
        this.#cap = options.cap ?? Number.POSITIVE_INFINITY;
    }

    /** The key's value from within its window, or a fresh one from `build`, remembered unless null. */
    read(key: string, build: () => T): T;
    read(key: string, build: () => T | null): T | null;
    read(key: string, build: () => T | null): T | null {
        const now = this.#now();
        const held = this.#entries.get(key);
        if (held !== undefined && now >= held.at && now - held.at < this.#windowMs) return held.value;
        const value = build();
        // Deleted first, so the key moves to the newest end.
        this.#entries.delete(key);
        if (value !== null) this.#entries.set(key, { at: now, value });
        for (const [stale, entry] of this.#entries) {
            if (this.#entries.size <= this.#cap && now >= entry.at && now - entry.at < this.#windowMs) break;
            this.#entries.delete(stale);
        }
        return value;
    }

    /** Forgets one key, so a change shows on its next read. */
    delete(key: string): void {
        this.#entries.delete(key);
    }

    /** Forgets the keys the test picks. */
    forget(test: (key: string) => boolean): void {
        for (const key of this.#entries.keys()) if (test(key)) this.#entries.delete(key);
    }

    /** Forgets every key. */
    clear(): void {
        this.#entries.clear();
    }
}
