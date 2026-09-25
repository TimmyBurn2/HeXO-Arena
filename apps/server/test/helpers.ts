import { botWithTokenSchema, botsPath, devLoginPath } from '@hexarena/contract';
import { buildApp, type BuiltApp } from '../src/app';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import type { DiscordIdentity, DiscordOAuth } from '../src/discord';
import type { FastifyServerOptions } from 'fastify';
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
    app: BuiltApp[`app`];
    admin: BuiltApp[`admin`];
    drain: BuiltApp[`drain`];
    presence: PresenceRegistry;
}

export async function createTestApp(options?: {
    sqlite?: Sqlite;
    discord?: DiscordOAuth | null;
    secureCookies?: boolean;
    devLogin?: boolean;
    presence?: PresenceRegistry;
    random?: () => number;
    logger?: FastifyServerOptions[`logger`];
    webIndexPath?: string;
}): Promise<TestApp> {
    const discord = options?.discord === undefined ? fakeDiscord({ id: `1`, username: `tester` }).oauth : options.discord;
    const sqlite = options?.sqlite ?? openDatabase(`:memory:`);
    runMigrations(sqlite);
    const presence = options?.presence ?? new PresenceRegistry();
    const { app, admin, drain } = await buildApp({
        sqlite,
        discord,
        secureCookies: options?.secureCookies ?? false,
        devLogin: options?.devLogin ?? true,
        presence,
        adminActor: `operator`,
        ...(options?.random !== undefined && { random: options.random }),
        ...(options?.logger !== undefined && { logger: options.logger }),
        ...(options?.webIndexPath !== undefined && { webIndexPath: options.webIndexPath }),
    });
    return { sqlite, app, admin, drain, presence };
}

// The session cookie value of a dev login, for inject's cookies option.
export async function loginAs(app: TestApp[`app`], name: string): Promise<string> {
    const response = await app.inject({ method: `POST`, url: devLoginPath, payload: { name } });
    if (response.statusCode !== 200) throw new Error(`dev login failed: ${response.body}`);
    const cookie = response.cookies.find((entry) => entry.name === `hexarena_session`);
    if (cookie === undefined) throw new Error(`dev login set no session cookie`);
    return cookie.value;
}

export async function mintBot(app: TestApp[`app`], session: string, name: string): Promise<string> {
    const response = await app.inject({
        method: `POST`,
        url: botsPath,
        payload: { name },
        cookies: { hexarena_session: session },
    });
    if (response.statusCode !== 201) throw new Error(`bot creation failed: ${response.body}`);
    return botWithTokenSchema.parse(response.json()).token;
}
