import type { StreamEvent } from '@hexarena/contract';

export const streamKeepaliveMs = 10_000;

// Presence is the connection: the registry holds one live stream per bot and
// nothing else, so online and open-for-challenges can never go stale.
// The replay source hands back the lines a reconnecting bot must see first:
// one gameStart per active game, plus a fresh moveRequest on the bot's turn.
export type ReplaySource = (botId: string) => readonly StreamEvent[];

// The subset of http.ServerResponse the registry needs; narrowing to it
// keeps the registry unit-testable against a plain fake.
export interface StreamSocket {
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
    readonly #entries = new Map<string, Entry>();

    constructor(private readonly replay: ReplaySource = () => []) {}

    attach(botId: string, socket: StreamSocket, openForChallenges: boolean): void {
        this.close(botId);
        const keepalive = setInterval(() => {
            socket.write(`\n`);
        }, streamKeepaliveMs);
        const entry: Entry = { socket, openForChallenges, keepalive };
        this.#entries.set(botId, entry);
        socket.once(`close`, () => {
            this.detach(botId, entry);
        });
        for (const event of this.replay(botId)) socket.write(toLine(event));
    }

    close(botId: string): void {
        const entry = this.#entries.get(botId);
        if (!entry) return;
        this.#entries.delete(botId);
        clearInterval(entry.keepalive);
        entry.socket.end();
    }

    // The guard makes a late close from a replaced stream harmless: the
    // reconnect race resolves to whichever entry the map holds now.
    private detach(botId: string, entry: Entry): void {
        if (this.#entries.get(botId) !== entry) return;
        this.#entries.delete(botId);
        clearInterval(entry.keepalive);
    }

    isOnline(botId: string): boolean {
        return this.#entries.has(botId);
    }

    isOpenForChallenges(botId: string): boolean {
        return this.#entries.get(botId)?.openForChallenges === true;
    }
}
