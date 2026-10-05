import { z } from 'zod';

// One name for every tab of the site, so a seat named in one is heard in
// the others.
const seatChannelName = `hexo-arena.seat`;

// A seat not named again within this span is taken as gone, so a tab
// closed without a word frees it.
const seatStaleMs = 25_000;

const seatMessageSchema = z.discriminatedUnion(`type`, [
    z.object({ type: z.literal(`seat`), gameId: z.string().min(1).max(100), seated: z.boolean() }),
    z.object({ type: z.literal(`ask`) }),
]);
type SeatMessage = z.infer<typeof seatMessageSchema>;

/** The part of a BroadcastChannel the seat channel uses, so a test can hand in its own. */
export interface SeatPort {
    postMessage(message: unknown): void;
    addEventListener(type: `message`, listener: (event: MessageEvent) => void): void;
    removeEventListener(type: `message`, listener: (event: MessageEvent) => void): void;
    close(): void;
}

function openPort(): SeatPort | null {
    return typeof BroadcastChannel === `undefined` ? null : new BroadcastChannel(seatChannelName);
}

function parsed(event: MessageEvent): SeatMessage | null {
    const message = seatMessageSchema.safeParse(event.data);
    return message.success ? message.data : null;
}

/**
 * What the seat channel says of other tabs: whether one of them holds a seat in a live game now.
 * It asks once on opening, so a seat taken before it opened is heard of too.
 */
export class SeatWatch {
    readonly #port: SeatPort | null;
    readonly #now: () => number;
    readonly #seen = new Map<string, number>();
    readonly #listeners = new Set<() => void>();
    readonly #onMessage = (event: MessageEvent) => {
        const message = parsed(event);
        if (message?.type !== `seat`) return;
        if (message.seated) this.#seen.set(message.gameId, this.#now());
        else this.#seen.delete(message.gameId);
        for (const listener of this.#listeners) listener();
    };

    constructor({ open = openPort, now = Date.now }: { open?: () => SeatPort | null; now?: () => number } = {}) {
        this.#port = open();
        this.#now = now;
        this.#port?.addEventListener(`message`, this.#onMessage);
        this.#port?.postMessage({ type: `ask` } satisfies SeatMessage);
    }

    /** Whether a tab has named a seat recently and not freed it. */
    seated(): boolean {
        const now = this.#now();
        for (const [gameId, at] of this.#seen) {
            if (now - at < seatStaleMs) return true;
            this.#seen.delete(gameId);
        }
        return false;
    }

    /** Hear each seat taken or freed; the returned function stops it. */
    subscribe(listener: () => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    close(): void {
        this.#port?.removeEventListener(`message`, this.#onMessage);
        this.#port?.close();
        this.#listeners.clear();
    }
}
