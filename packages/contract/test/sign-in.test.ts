import { describe, expect, it } from 'vitest';
import {
    devLoginRequestSchema,
    discordLoginHref,
    nextPathMaxLength,
    nextPathOf,
    nextPathSchema,
    signInFailurePath,
    signupAttemptCap,
    signupMaxAgeSeconds,
    signupSchema,
    userMeSchema,
} from '../src/index';

describe('nextPathSchema', () => {
    it.each([`/`, `/play?bot=devbot-c&clock=t20`, `/ladder`, `/bots/devbot-c`, `/connect`, `/profile`, `/credits`, `/legal/terms`, `/game/g_1`, `/?kind=bots`, `/bots?online=1`])(
        'takes %s, a page of the site',
        (path) => {
            expect(nextPathSchema.safeParse(path).success).toBe(true);
        },
    );

    it.each([
        [`another host`, `//evil.example/`],
        [`a host behind a backslash`, `/\\evil.example`],
        [`a doubled slash inside`, `/bots//x`],
        [`no leading slash`, `ladder`],
        [`an absolute address`, `https://evil.example/`],
        [`a fragment`, `/ladder#top`],
        [`a space`, `/bots/a b`],
        [`a control character`, `/bots/a\u0000`],
        [`a character outside ASCII`, `/bots/\u00e4`],
        [`the API`, `/api/me`],
        [`the welcome page`, `/welcome`],
        [`a page the site does not serve`, `/nowhere`],
    ])('refuses %s', (_what, path) => {
        expect(nextPathSchema.safeParse(path).success).toBe(false);
    });

    it(`takes ${String(nextPathMaxLength)} characters and no more`, () => {
        const path = (length: number) => `/game/${`a`.repeat(length - 6)}`;
        expect(nextPathSchema.safeParse(path(nextPathMaxLength)).success).toBe(true);
        expect(nextPathSchema.safeParse(path(nextPathMaxLength + 1)).success).toBe(false);
    });

    it('falls back to the root for anything else', () => {
        expect(nextPathOf(`/bots/devbot-c`)).toBe(`/bots/devbot-c`);
        expect(nextPathOf(`//evil.example/`)).toBe(`/`);
        expect(nextPathOf(undefined)).toBe(`/`);
        expect(nextPathOf([`/ladder`])).toBe(`/`);
    });
});

describe('the sign-in addresses', () => {
    it('carry the return path to the login route', () => {
        expect(discordLoginHref(`/bots/devbot-c?online=1`)).toBe(`/api/auth/discord/login?next=%2Fbots%2Fdevbot-c%3Fonline%3D1`);
        const next = new URL(discordLoginHref(`/connect`), `https://arena.example`).searchParams.get(`next`);
        expect(next).toBe(`/connect`);
    });

    it('name the failure on the page the sign-in started from, keeping its query', () => {
        expect(signInFailurePath(`cancelled`)).toBe(`/?signin=cancelled`);
        expect(signInFailurePath(`expired`, `/connect`)).toBe(`/connect?signin=expired`);
        expect(signInFailurePath(`banned`, `/bots?online=1`)).toBe(`/bots?online=1&signin=banned`);
        expect(signInFailurePath(`rejected`, `/?signin=cancelled`)).toBe(`/?signin=rejected`);
    });
});

describe('the sign-up', () => {
    it('waits a quarter hour and takes a bounded number of names', () => {
        expect(signupMaxAgeSeconds).toBe(900);
        expect(signupAttemptCap).toBe(10);
    });

    it('reads the Discord account, a free name, and where it returns', () => {
        const signup = { discord: { username: `mira.hex`, displayName: `Mira` }, suggestedName: `mira-hex`, next: `/connect` };
        expect(signupSchema.parse(signup)).toEqual(signup);
        expect(signupSchema.safeParse({ ...signup, discord: { username: `m`.repeat(33), displayName: null } }).success).toBe(false);
        expect(signupSchema.safeParse({ ...signup, suggestedName: `mira.hex` }).success).toBe(false);
    });
});

describe('who the session names', () => {
    it('carries the Discord account a user signed in with, or null', () => {
        const user = { kind: `user`, name: `mira-hex`, rating: 1000, provisional: true, liveGames: [] } as const;
        expect(userMeSchema.parse({ ...user, discord: { username: `mira.hex`, displayName: null } }).discord).toEqual({ username: `mira.hex`, displayName: null });
        expect(userMeSchema.parse({ ...user, discord: null }).discord).toBeNull();
        expect(userMeSchema.safeParse(user).success).toBe(false);
    });
});

describe('the dev login', () => {
    it('takes a chosen name, or a Discord account with an optional return path', () => {
        expect(devLoginRequestSchema.safeParse({ name: `quinn` }).success).toBe(true);
        expect(devLoginRequestSchema.safeParse({ discord: { username: `mira.hex`, displayName: `Mira` } }).success).toBe(true);
        expect(devLoginRequestSchema.safeParse({ discord: { username: `mira.hex`, displayName: null }, next: `/connect` }).success).toBe(true);
        expect(devLoginRequestSchema.safeParse({ discord: { username: `mira.hex`, displayName: null }, next: `//evil.example` }).success).toBe(false);
    });
});
