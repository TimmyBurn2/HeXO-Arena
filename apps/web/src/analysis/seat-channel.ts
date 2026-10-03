import { useEffect } from 'react';
import { z } from 'zod';

/** The channel a game tab names its seat on, so an engine in another tab of the site stays off while the person plays. */
export const seatChannelName = `hexo-arena.seat`;

// A seated tab says so again this often, and a seat not heard of for the
// stale span is taken as gone, so a tab closed without a word frees it.
const seatRepeatMs = 10_000;
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
 * Names the person's seat in a live game on the seat channel while `gameId` is one,
 * again every little while and whenever another tab asks, and frees it when the game ends or the tab goes.
 */
export function useSeatBroadcast(gameId: string | null, open: () => SeatPort | null = openPort): void {
    useEffect(() => {
        if (gameId === null) return;
        const port = open();
        if (port === null) return;
        const say = (seated: boolean) => {
            port.postMessage({ type: `seat`, gameId, seated } satisfies SeatMessage);
        };
        const onMessage = (event: MessageEvent) => {
            if (parsed(event)?.type === `ask`) say(true);
        };
        const leave = () => {
            say(false);
        };
        say(true);
        const timer = setInterval(() => {
            say(true);
        }, seatRepeatMs);
        port.addEventListener(`message`, onMessage);
        window.addEventListener(`pagehide`, leave);
        return () => {
            clearInterval(timer);
            window.removeEventListener(`pagehide`, leave);
            port.removeEventListener(`message`, onMessage);
            say(false);
            port.close();
        };
    }, [gameId, open]);
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
