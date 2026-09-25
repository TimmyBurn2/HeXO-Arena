import { buildApp } from '../src/app';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import type { DiscordIdentity, DiscordOAuth } from '../src/discord';

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

export interface TestApp {
    sqlite: Sqlite;
    app: Awaited<ReturnType<typeof buildApp>>;
}

export async function createTestApp(options?: {
    discord?: DiscordOAuth | null;
    secureCookies?: boolean;
    devLogin?: boolean;
}): Promise<TestApp> {
    const discord = options?.discord === undefined ? fakeDiscord({ id: `1`, username: `tester` }).oauth : options.discord;
    const sqlite = openDatabase(`:memory:`);
    runMigrations(sqlite);
    const app = await buildApp({
        sqlite,
        discord,
        secureCookies: options?.secureCookies ?? false,
        devLogin: options?.devLogin ?? true,
    });
    return { sqlite, app };
}
