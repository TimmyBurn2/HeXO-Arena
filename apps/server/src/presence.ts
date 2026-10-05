import { streamBacklogLimitBytes, streamKeepaliveMs, type StreamEvent } from '@hexo-arena/contract';

// Presence is the connection: the registry holds one live stream per bot and
// nothing else, so online and open-for-challenges can never go stale.
// The replay source hands back, in order, the lines a reconnecting bot must
// see first.
type ReplaySource = (botId: string) => readonly StreamEvent[];

// Presence transitions reach the game layer through this hook: a bot going
// offline starts the orphan countdown on its live games, coming back stops
// it. Attach fires online after a replacement close fired offline; the
// orphan logic is idempotent, so the transient pair is harmless.
type PresenceWatcher = (botId: string, online: boolean) => void;

// The subset of http.ServerResponse the registry needs; narrowing to it
// keeps the registry unit-testable against a plain fake.
export interface StreamSocket {
    readonly writableLength: number;
    write(chunk: string): void;
    end(): void;
    once(event: `close`, listener: () => void): void;
}

interface Entry {
    readonly socket: StreamSocket;
    readonly openForChallenges: boolean;
    readonly keepalive: ReturnType<typeof setInterval>;
}

function toLine(event: StreamEvent): string {
    return `${JSON.stringify(event)}\n`;
}

export class PresenceRegistry {
    // Bound late by the composition root, which needs the game registry to
    // build the replay and needs this registry to build the game registry.
    replay: ReplaySource;
    watch: PresenceWatcher | null = null;

    readonly #entries = new Map<string, Entry>();

    constructor(replay: ReplaySource = () => []) {
        this.replay = replay;
    }

    attach(botId: string, socket: StreamSocket, openForChallenges: boolean): void {
        this.close(botId);
        const keepalive = setInterval(() => {
            this.#write(botId, `\n`);
        }, streamKeepaliveMs);
        const entry: Entry = { socket, openForChallenges, keepalive };
        this.#entries.set(botId, entry);
        socket.once(`close`, () => {
            this.detach(botId, entry);
        });
        for (const event of this.replay(botId)) socket.write(toLine(event));
        this.watch?.(botId, true);
    }

    close(botId: string): void {
        const entry = this.#entries.get(botId);
        if (!entry) return;
        this.#entries.delete(botId);
        clearInterval(entry.keepalive);
        entry.socket.end();
        this.watch?.(botId, false);
    }

    // A stream never ends on its own, so the server's close would wait on
    // it forever; shutdown ends them all and the bots redial the next process.
    closeAll(): void {
        for (const botId of [...this.#entries.keys()]) this.close(botId);
    }

    // The guard makes a late close from a replaced stream harmless: the
    // reconnect race resolves to whichever entry the map holds now.
    private detach(botId: string, entry: Entry): void {
        if (this.#entries.get(botId) !== entry) return;
        this.#entries.delete(botId);
        clearInterval(entry.keepalive);
        this.watch?.(botId, false);
    }

    streamCount(): number {
        return this.#entries.size;
    }

    isOnline(botId: string): boolean {
        return this.#entries.has(botId);
    }

    isOpenForChallenges(botId: string): boolean {
        return this.#entries.get(botId)?.openForChallenges === true;
    }

    // A game event for a bot that is not connected is simply missed; the
    // replay on its next attach covers recovery.
    send(botId: string, event: StreamEvent): void {
        this.#write(botId, toLine(event));
    }

    // A reader that stopped would otherwise hold in memory every line sent it,
    // so past the backlog limit its stream ends and it redials.
    #write(botId: string, chunk: string): void {
        const entry = this.#entries.get(botId);
        if (entry === undefined) return;
        entry.socket.write(chunk);
        if (entry.socket.writableLength > streamBacklogLimitBytes) this.close(botId);
    }
}
