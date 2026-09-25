import { buildApp } from '../src/app';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import type { DiscordIdentity, DiscordOAuth } from '../src/discord';
import { PresenceRegistry, type StreamSocket } from '../src/presence';

export interface FakeDiscord {
    oauth: DiscordOAuth;
    identity: DiscordIdentity;
}

export function fakeDiscord(initial: DiscordIdentity): FakeDiscord {
    const identity = { ...initial };
    return {
        identity,
        oauth: {
            authorizeUrl: (state: string) => `https://discord.example/authorize?state=${state}`,
            exchange: () => Promise.resolve(identity),
        },
    };
}

// A recording stand-in for the raw response a stream owns; emitClose
// plays the network disconnect.
export class FakeStreamSocket implements StreamSocket {
    readonly writes: string[] = [];
    ended = false;
    #closeListeners: (() => void)[] = [];

    write(chunk: string): void {
        this.writes.push(chunk);
    }

    end(): void {
        this.ended = true;
    }

    once(_event: `close`, listener: () => void): void {
        this.#closeListeners.push(listener);
    }

    emitClose(): void {
        const listeners = this.#closeListeners;
        this.#closeListeners = [];
        for (const listener of listeners) listener();
    }
}

export interface TestApp {
    sqlite: Sqlite;
    app: Awaited<ReturnType<typeof buildApp>>;
    presence: PresenceRegistry;
}

export async function createTestApp(options?: {
    discord?: DiscordOAuth | null;
    secureCookies?: boolean;
    devLogin?: boolean;
    presence?: PresenceRegistry;
}): Promise<TestApp> {
    const discord = options?.discord === undefined ? fakeDiscord({ id: `1`, username: `tester` }).oauth : options.discord;
    const sqlite = openDatabase(`:memory:`);
    runMigrations(sqlite);
    const presence = options?.presence ?? new PresenceRegistry();
    const app = await buildApp({
        sqlite,
        discord,
        secureCookies: options?.secureCookies ?? false,
        devLogin: options?.devLogin ?? true,
        presence,
    });
    return { sqlite, app, presence };
}
