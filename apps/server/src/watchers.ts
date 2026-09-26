import { gameWatcherCap, siteWatcherCap, streamKeepaliveMs, type GameEvent } from '@hexarena/contract';
import type { StreamSocket } from './presence';

interface Watcher {
    readonly socket: StreamSocket;
    readonly seated: boolean;
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
 * Watchers without a seat count against the caps; a closed connection
 * leaves at once, and nothing is ever replayed.
 */
export class GameWatchers {
    readonly #byGame = new Map<string, Set<Watcher>>();
    #unseated = 0;

    /** Whether one more watcher without a seat fits the caps for this game. */
    admits(gameId: string): boolean {
        return this.#unseated < siteWatcherCap && this.unseatedCount(gameId) < gameWatcherCap;
    }

    unseatedCount(gameId?: string): number {
        if (gameId === undefined) return this.#unseated;
        let count = 0;
        for (const watcher of this.#byGame.get(gameId) ?? []) if (!watcher.seated) count += 1;
        return count;
    }

    /** Joins a watcher to a live game and writes its opening event. */
    attach(gameId: string, socket: StreamSocket, seated: boolean, first: GameEvent): void {
        const watcher: Watcher = {
            socket,
            seated,
            // A comment line; EventSource ignores it, proxies see traffic.
            keepalive: setInterval(() => {
                socket.write(`:\n\n`);
            }, streamKeepaliveMs),
        };
        let watchers = this.#byGame.get(gameId);
        if (watchers === undefined) {
            watchers = new Set();
            this.#byGame.set(gameId, watchers);
        }
        watchers.add(watcher);
        if (!seated) this.#unseated += 1;
        socket.once(`close`, () => {
            this.#leave(gameId, watcher);
        });
        socket.write(frameOf(first));
    }

    publish(gameId: string, event: GameEvent): void {
        for (const watcher of this.#byGame.get(gameId) ?? []) watcher.socket.write(frameOf(event));
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

    // The set lookup makes a late close after end or closeAll harmless.
    #leave(gameId: string, watcher: Watcher): void {
        const watchers = this.#byGame.get(gameId);
        if (watchers?.delete(watcher) !== true) return;
        clearInterval(watcher.keepalive);
        if (!watcher.seated) this.#unseated -= 1;
        if (watchers.size === 0) this.#byGame.delete(gameId);
    }
}
