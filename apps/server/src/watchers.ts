import {
    clientWatcherCap,
    gameWatcherCap,
    seatWatcherCap,
    siteWatcherCap,
    streamBacklogLimitBytes,
    streamKeepaliveMs,
    type GameEvent,
} from '@hexo-arena/contract';
import type { StreamSocket } from './presence';

interface Watcher {
    readonly socket: StreamSocket;
    readonly seated: boolean;
    // Who the stream counts against: a seat of the game, or a client; null when neither is known.
    readonly owner: string | null;
    readonly keepalive: ReturnType<typeof setInterval>;
}

/**
 * One event as the stream writes it: event names and JSON payloads never
 * hold a newline, so every event is one event line and one data line.
 */
export function frameOf(event: GameEvent): string {
    return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/**
 * The live event streams of every watched game.
 * Watchers without a seat count against the site's and the game's caps and their client's;
 * a seat's own streams count against the seat alone.
 * A closed connection leaves at once, and nothing is ever replayed.
 */
export class GameWatchers {
    readonly #byGame = new Map<string, Set<Watcher>>();
    readonly #byOwner = new Map<string, number>();
    #unseated = 0;

    /** Whether one more stream fits the caps, for a seat's own or for a watcher without one. */
    admits(gameId: string, owner: string | null = null, seated = false): boolean {
        const held = owner === null ? 0 : (this.#byOwner.get(owner) ?? 0);
        if (seated) return held < seatWatcherCap;
        return this.#unseated < siteWatcherCap && this.unseatedCount(gameId) < gameWatcherCap && held < clientWatcherCap;
    }

    unseatedCount(gameId?: string): number {
        if (gameId === undefined) return this.#unseated;
        let count = 0;
        for (const watcher of this.#byGame.get(gameId) ?? []) if (!watcher.seated) count += 1;
        return count;
    }

    /** Joins a watcher to a live game and writes its opening event. */
    attach(gameId: string, socket: StreamSocket, seated: boolean, first: GameEvent, owner: string | null = null): void {
        const watcher: Watcher = {
            socket,
            seated,
            owner,
            // A comment line; EventSource ignores it, proxies see traffic.
            keepalive: setInterval(() => {
                this.#write(gameId, watcher, `:\n\n`);
            }, streamKeepaliveMs),
        };
        let watchers = this.#byGame.get(gameId);
        if (watchers === undefined) {
            watchers = new Set();
            this.#byGame.set(gameId, watchers);
        }
        watchers.add(watcher);
        if (!seated) this.#unseated += 1;
        if (owner !== null) this.#byOwner.set(owner, (this.#byOwner.get(owner) ?? 0) + 1);
        socket.once(`close`, () => {
            this.#leave(gameId, watcher);
        });
        socket.write(frameOf(first));
    }

    publish(gameId: string, event: GameEvent): void {
        const frame = frameOf(event);
        for (const watcher of [...(this.#byGame.get(gameId) ?? [])]) this.#write(gameId, watcher, frame);
    }

    /** Writes the game's last event to every watcher and ends each stream. */
    end(gameId: string, last: GameEvent): void {
        for (const watcher of [...(this.#byGame.get(gameId) ?? [])]) {
            this.#leave(gameId, watcher);
            watcher.socket.write(frameOf(last));
            watcher.socket.end();
        }
    }

    // A stream never ends on its own, so the server's close would wait on
    // it forever; shutdown ends them all and each browser reconnects.
    closeAll(): void {
        for (const [gameId, watchers] of [...this.#byGame]) {
            for (const watcher of [...watchers]) {
                this.#leave(gameId, watcher);
                watcher.socket.end();
            }
        }
    }

    // A reader that stopped would otherwise hold in memory every event sent it,
    // so past the backlog limit its stream ends and it reconnects.
    #write(gameId: string, watcher: Watcher, chunk: string): void {
        watcher.socket.write(chunk);
        if (watcher.socket.writableLength <= streamBacklogLimitBytes) return;
        this.#leave(gameId, watcher);
        watcher.socket.end();
    }

    // The set lookup makes a late close after end or closeAll harmless.
    #leave(gameId: string, watcher: Watcher): void {
        const watchers = this.#byGame.get(gameId);
        if (watchers?.delete(watcher) !== true) return;
        clearInterval(watcher.keepalive);
        if (!watcher.seated) this.#unseated -= 1;
        if (watcher.owner !== null) {
            const held = (this.#byOwner.get(watcher.owner) ?? 1) - 1;
            if (held === 0) this.#byOwner.delete(watcher.owner);
            else this.#byOwner.set(watcher.owner, held);
        }
        if (watchers.size === 0) this.#byGame.delete(gameId);
    }
}
