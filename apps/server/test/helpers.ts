import {
    botWithTokenSchema,
    botsPath,
    devLoginPath,
    discordCallbackPath,
    discordLoginHref,
    discordLoginPath,
    oauthCookieName,
    secureSessionCookieName,
    sessionCookieName,
    signupPath,
} from '@hexo-arena/contract';
import { buildApp, type BuiltApp } from '../src/app';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';
import type { DiscordIdentity, DiscordOAuth } from '../src/discord';
import { defaultLimits, type LimitTable } from '../src/request-limits';
import { PresenceRegistry, type StreamSocket } from '../src/presence';
import type { LogTarget } from '../src/request-log';
import { GameWatchers } from '../src/watchers';

export interface FakeDiscord {
    oauth: DiscordOAuth;
    identity: DiscordIdentity;
}

// A Discord that confirms every code as one account, which a test may
// change between sign-ins.
export function fakeDiscord(initial: { id: string; username: string; displayName?: string | null }): FakeDiscord {
    const identity: DiscordIdentity = { id: initial.id, names: { username: initial.username, displayName: initial.displayName ?? null } };
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
    // What the peer has not read yet; a test raises it to play a reader that stopped.
    writableLength = 0;
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
    limits: BuiltApp[`limits`];
    tournaments: BuiltApp[`tournaments`];
    presence: PresenceRegistry;
    watchers: GameWatchers;
}

let template: Buffer | null = null;

/**
 * A fresh in-memory database at the latest schema: a clone of one migrated
 * once per test file, since migrating takes about 90 ms and a clone well
 * under one.
 */
export function migratedDatabase(): Sqlite {
    if (template === null) {
        const source = openDatabase(`:memory:`);
        runMigrations(source);
        template = source.serialize();
        source.close();
    }
    return openDatabase(template);
}

/**
 * The contract's limits with a ceiling no test reaches,
 * for tests that make hundreds of requests to reach some other cap.
 */
export const roomyLimits: LimitTable = { ...defaultLimits, public: { burst: 100_000, refillMs: 1 } };

export async function createTestApp(options?: {
    sqlite?: Sqlite;
    discord?: DiscordOAuth | null;
    secureCookies?: boolean;
    devLogin?: boolean;
    presence?: PresenceRegistry;
    random?: () => number;
    logger?: LogTarget;
    webIndexPath?: string;
    reportForm?: boolean;
    trustedProxy?: string;
    now?: () => number;
    limits?: LimitTable;
    backup?: { dir: string; keep: number };
    erasures?: { path: string; keepDays: number };
    roundGapMs?: number;
}): Promise<TestApp> {
    const discord = options?.discord === undefined ? fakeDiscord({ id: `1`, username: `tester` }).oauth : options.discord;
    const given = options?.sqlite;
    if (given !== undefined) runMigrations(given);
    const sqlite = given ?? migratedDatabase();
    const presence = options?.presence ?? new PresenceRegistry();
    const watchers = new GameWatchers();
    const { app, admin, drain, limits, tournaments } = await buildApp({
        sqlite,
        discord,
        secureCookies: options?.secureCookies ?? false,
        devLogin: options?.devLogin ?? true,
        presence,
        watchers,
        adminActor: `operator`,
        publicOrigin: `https://arena.example`,
        ...(options?.random !== undefined && { random: options.random }),
        // Off unless a test reads the log, so a failure's own lines stand out in the output.
        logger: options?.logger ?? false,
        ...(options?.webIndexPath !== undefined && { webIndexPath: options.webIndexPath }),
        // On unless a test turns it off, so the form's route and its limits stay under test.
        reportForm: options?.reportForm ?? true,
        ...(options?.trustedProxy !== undefined && { trustedProxy: options.trustedProxy }),
        ...(options?.now !== undefined && { now: options.now }),
        ...(options?.limits !== undefined && { limits: options.limits }),
        ...(options?.backup !== undefined && { backup: options.backup }),
        ...(options?.erasures !== undefined && { erasures: options.erasures }),
        // Tests move the scheduler with their own ticks.
        tournamentTickMs: 0,
        ...(options?.roundGapMs !== undefined && { tournamentRoundGapMs: options.roundGapMs }),
    });
    return { sqlite, app, admin, drain, limits, presence, watchers, tournaments };
}

/** A Discord sign-in started in one browser: the state Discord echoes, and the cookies that browser then holds. */
export interface StartedSignIn {
    state: string;
    cookies: Record<string, string>;
}

/** Start a sign-in through the app's Discord, returning to `next`. */
export async function startDiscordSignIn(app: TestApp[`app`], next?: string): Promise<StartedSignIn> {
    const login = await app.inject({ method: `GET`, url: next === undefined ? discordLoginPath : discordLoginHref(next) });
    const state = new URL(login.headers.location ?? ``).searchParams.get(`state`) ?? ``;
    const nonce = login.cookies.find((entry) => entry.name === oauthCookieName)?.value;
    return { state, cookies: nonce === undefined ? {} : { [oauthCookieName]: nonce } };
}

/**
 * A first sign-in through the app's Discord, finished under `name`: the
 * session cookie's value.
 */
export async function signUpWithDiscord(app: TestApp[`app`], name: string): Promise<string> {
    const { state, cookies } = await startDiscordSignIn(app);
    const back = await app.inject({ method: `GET`, url: `${discordCallbackPath}?code=c&state=${encodeURIComponent(state)}`, cookies });
    const signup = back.cookies.find((entry) => entry.name === `hexo_arena_signup`)?.value;
    if (signup === undefined) throw new Error(`the callback held no sign-up: ${String(back.headers.location)}`);
    const created = await app.inject({ method: `POST`, url: signupPath, payload: { name }, cookies: { hexo_arena_signup: signup } });
    const session = created.cookies.find((entry) => entry.name === sessionCookieName || entry.name === secureSessionCookieName)?.value;
    if (created.statusCode !== 201 || session === undefined) throw new Error(`the sign-up failed: ${created.body}`);
    return session;
}

// The session cookie value of a dev login, for inject's cookies option.
export async function loginAs(app: TestApp[`app`], name: string): Promise<string> {
    const response = await app.inject({ method: `POST`, url: devLoginPath, payload: { name } });
    if (response.statusCode !== 200) throw new Error(`dev login failed: ${response.body}`);
    const cookie = response.cookies.find((entry) => entry.name === `hexo_arena_session`);
    if (cookie === undefined) throw new Error(`dev login set no session cookie`);
    return cookie.value;
}

export async function mintBot(app: TestApp[`app`], session: string, name: string): Promise<string> {
    const response = await app.inject({
        method: `POST`,
        url: botsPath,
        payload: { name },
        cookies: { hexo_arena_session: session },
    });
    if (response.statusCode !== 201) throw new Error(`bot creation failed: ${response.body}`);
    return botWithTokenSchema.parse(response.json()).token;
}
