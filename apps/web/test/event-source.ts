import { vi } from 'vitest';

/**
 * A scripted EventSource: jsdom ships none, and a test drives the stream
 * by hand, delivering events or failing the connection.
 */
export class FakeEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    static opened: FakeEventSource[] = [];

    readyState: number = FakeEventSource.CONNECTING;
    onerror: (() => void) | null = null;
    readonly #listeners = new Map<string, ((message: MessageEvent) => void)[]>();

    constructor(readonly url: string) {
        FakeEventSource.opened.push(this);
    }

    addEventListener(type: string, listener: (message: MessageEvent) => void): void {
        this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
    }

    close(): void {
        this.readyState = FakeEventSource.CLOSED;
    }

    emit(type: string, data: unknown): void {
        if (this.readyState === FakeEventSource.CLOSED) return;
        this.readyState = FakeEventSource.OPEN;
        const message = new MessageEvent(type, { data: JSON.stringify(data) });
        for (const listener of this.#listeners.get(type) ?? []) listener(message);
    }

    // A dropped connection that the browser retries on its own, or a
    // refused one that stays closed.
    fail(closed: boolean): void {
        this.readyState = closed ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
        this.onerror?.();
    }

    static latest(): FakeEventSource {
        const source = FakeEventSource.opened.at(-1);
        if (source === undefined) throw new Error(`no stream was opened`);
        return source;
    }
}

/**
 * Installs the fake; each new stream opens with `first` as its snapshot,
 * or is refused when there is none.
 */
export function stubEventSource(first: unknown): void {
    FakeEventSource.opened = [];
    const Scripted = class extends FakeEventSource {
        constructor(url: string) {
            super(url);
            queueMicrotask(() => {
                if (first === null) this.fail(true);
                else this.emit(`snapshot`, first);
            });
        }
    };
    vi.stubGlobal(`EventSource`, Scripted);
}
