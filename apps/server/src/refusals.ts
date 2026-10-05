// A code is one of the server's own words, never anything a caller sent;
// the pattern keeps a path, a name, or an address out all the same.
const codePattern = /^[a-z][a-z0-9_]{0,63}$/u;

// The server knows far fewer codes and limits than this; the bound only
// stops a mistake from growing a map without end.
const keyCap = 256;

function bump(counts: Map<string, number>, key: string): void {
    const held = counts.get(key);
    if (held === undefined && counts.size >= keyCap) return;
    counts.set(key, (held ?? 0) + 1);
}

function sorted(counts: ReadonlyMap<string, number>): Record<string, number> {
    return Object.fromEntries([...counts].sort(([a, one], [b, other]) => other - one || a.localeCompare(b)));
}

/**
 * Refusals since the process started, held in memory:
 * answers by their code, and refusals by the rate limit that made them.
 * Counts alone; nothing about the caller or the request is kept.
 */
export class RefusalCounts {
    readonly #codes = new Map<string, number>();
    readonly #limits = new Map<string, number>();

    /** Counts an answer by its code, unless it is not one of the server's codes. */
    code(code: string): void {
        if (codePattern.test(code)) bump(this.#codes, code);
    }

    /** Counts a refusal by the rate limit that made it. */
    limit(name: string): void {
        bump(this.#limits, name);
    }

    /** Each code and its count, the most frequent first. */
    get codes(): Record<string, number> {
        return sorted(this.#codes);
    }

    /** Each rate limit and its refusals, the most frequent first. */
    get limits(): Record<string, number> {
        return sorted(this.#limits);
    }
}

/** The code a refusal's serialized JSON body names, or null for any other body. */
export function refusalCode(payload: unknown): string | null {
    if (typeof payload !== `string` || !payload.startsWith(`{`)) return null;
    let body: unknown;
    try {
        body = JSON.parse(payload);
    } catch {
        return null;
    }
    if (typeof body !== `object` || body === null || !(`code` in body)) return null;
    return typeof body.code === `string` ? body.code : null;
}
