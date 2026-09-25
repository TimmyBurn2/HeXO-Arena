import { randomInt } from 'node:crypto';
import { nowSeconds } from './db';
import { randomToken, sha256Hex } from './tokens';

export const guestIdleSeconds = 24 * 60 * 60;
export const guestSessionCap = 500;

const labelAlphabet = `abcdefghijklmnopqrstuvwxyz0123456789`;

export interface GuestSession {
    readonly id: string;
    readonly name: string;
    lastSeenAt: number;
    lastGameCreatedAt: number | null;
}

export interface GuestSessionsDeps {
    // A guest seated in a live game outlives its idle window, so an
    // unlimited game never loses its player to the sweep.
    seated: (guestId: string) => boolean;
    ended: (guestId: string) => void;
}

/**
 * Anonymous sessions held in memory alone: no users row, no sessions row,
 * nothing that outlives the process. Tokens are kept as their sha256, the
 * same as every stored credential.
 */
export class GuestSessions {
    readonly #byTokenHash = new Map<string, GuestSession>();
    readonly #byId = new Map<string, GuestSession>();
    readonly #deps: GuestSessionsDeps;

    constructor(deps: GuestSessionsDeps) {
        this.#deps = deps;
    }

    count(): number {
        return this.#byTokenHash.size;
    }

    mint(): { token: string; guest: GuestSession } | null {
        this.#sweep();
        if (this.#byTokenHash.size >= guestSessionCap) return null;
        const token = randomToken(32);
        const guest: GuestSession = {
            id: `guest_${randomToken(16)}`,
            name: this.#freshLabel(),
            lastSeenAt: nowSeconds(),
            lastGameCreatedAt: null,
        };
        this.#byTokenHash.set(sha256Hex(token), guest);
        this.#byId.set(guest.id, guest);
        return { token, guest };
    }

    // A lookup is a request, so it renews the idle window.
    find(token: string): GuestSession | null {
        const key = sha256Hex(token);
        const guest = this.#byTokenHash.get(key);
        if (guest === undefined) return null;
        if (this.#expired(guest)) {
            this.#end(key, guest);
            return null;
        }
        guest.lastSeenAt = nowSeconds();
        return guest;
    }

    byId(guestId: string): GuestSession | null {
        return this.#byId.get(guestId) ?? null;
    }

    end(token: string): void {
        const key = sha256Hex(token);
        const guest = this.#byTokenHash.get(key);
        if (guest !== undefined) this.#end(key, guest);
    }

    #end(key: string, guest: GuestSession): void {
        this.#byTokenHash.delete(key);
        this.#byId.delete(guest.id);
        this.#deps.ended(guest.id);
    }

    #expired(guest: GuestSession): boolean {
        return nowSeconds() - guest.lastSeenAt >= guestIdleSeconds && !this.#deps.seated(guest.id);
    }

    #sweep(): void {
        for (const [key, guest] of [...this.#byTokenHash]) {
            if (this.#expired(guest)) this.#end(key, guest);
        }
    }

    // 36^4 labels against a cap of 500 live guests: a retry is rare and the
    // loop ends almost surely.
    #freshLabel(): string {
        const taken = new Set([...this.#byTokenHash.values()].map((guest) => guest.name));
        for (;;) {
            let suffix = ``;
            for (let index = 0; index < 4; index += 1) suffix += labelAlphabet.charAt(randomInt(labelAlphabet.length));
            const label = `Guest ${suffix}`;
            if (!taken.has(label)) return label;
        }
    }
}
