import { describe, expect, it } from 'vitest';
import {
    accountDeclarationSchema,
    acceptsSchema,
    challengeCanceledEventSchema,
    gameFinishEventSchema,
    gameStartEventSchema,
    moveRequestEventSchema,
    streamEventSchema,
    streamPlayerSchema,
    timeControlSchema,
} from '../src';

const gameStart = {
    type: `gameStart`,
    gameId: `g1`,
    side: `x`,
    opponent: { name: `otherbot`, rating: 1500, provisional: true },
    timeControl: { mode: `unlimited` },
    openingPlies: 5,
    rated: false,
    engine: { socketUrl: `/api/bot/game/g1/socket`, token: `hgs_token` },
};

describe('streamEventSchema', () => {
    it('accepts one line of every event kind', () => {
        const lines = [
            gameStart,
            {
                type: `moveRequest`,
                gameId: `g1`,
                request: {
                    board: {
                        to_move: `o`,
                        cells: [{ q: 0, r: 0, p: `x` }],
                    },
                    time_limit: 5,
                    request_id: 1,
                },
            },
            { type: `gameFinish`, gameId: `g1`, winner: null, reason: `aborted` },
            {
                type: `challenge`,
                challenge: {
                    challengeId: `c1`,
                    challenger: { name: `abot`, rating: 1500, provisional: true },
                    destUser: { name: `bbot`, rating: 1500, provisional: true },
                    timeControl: { mode: `turn`, turnTimeMs: 30_000 },
                    openingPlies: 3,
                    firstPlayer: `challenger`,
                    status: `created`,
                },
            },
            {
                type: `challengeCanceled`,
                reason: `expired`,
                challenge: {
                    challengeId: `c1`,
                    challenger: { name: `abot`, rating: 1500, provisional: true },
                    destUser: { name: `bbot`, rating: 1500, provisional: true },
                    timeControl: { mode: `unlimited` },
                    openingPlies: 1,
                    firstPlayer: `random`,
                    status: `expired`,
                },
            },
            {
                type: `challengeDeclined`,
                challenge: {
                    challengeId: `c1`,
                    challenger: { name: `abot`, rating: 1500, provisional: true },
                    destUser: { name: `bbot`, rating: 1500, provisional: true },
                    timeControl: { mode: `unlimited` },
                    openingPlies: 1,
                    firstPlayer: `random`,
                    status: `declined`,
                },
            },
        ];
        for (const line of lines) {
            expect(streamEventSchema.safeParse(line).success).toBe(true);
        }
    });

    it('rejects an unknown discriminator value', () => {
        const parsed = streamEventSchema.safeParse({ type: `chat`, gameId: `g1` });
        expect(parsed.success).toBe(false);
    });

    it('keeps challengeCanceled bound to its reason', () => {
        const withoutReason = {
            type: `challengeCanceled`,
            challenge: {
                challengeId: `c1`,
                challenger: { name: `abot`, rating: 1500, provisional: true },
                destUser: { name: `bbot`, rating: 1500, provisional: true },
                timeControl: { mode: `unlimited` },
                status: `created`,
            },
        };
        expect(challengeCanceledEventSchema.safeParse(withoutReason).success).toBe(false);
    });

    it('requires the opening length on every gameStart, the plain game included', () => {
        expect(gameStartEventSchema.parse({ ...gameStart, openingPlies: 1 }).openingPlies).toBe(1);
        expect(gameStartEventSchema.parse({ ...gameStart, openingPlies: 9 }).openingPlies).toBe(9);
        const { openingPlies: _omitted, ...withoutOpening } = gameStart;
        expect(gameStartEventSchema.safeParse(withoutOpening).success).toBe(false);
    });

    it('nulls the finish winner but keeps the reason closed', () => {
        expect(gameFinishEventSchema.safeParse({ type: `gameFinish`, gameId: `g`, winner: `o`, reason: `surrender` }).success).toBe(true);
        expect(gameFinishEventSchema.safeParse({ type: `gameFinish`, gameId: `g`, winner: null, reason: `aborted` }).success).toBe(true);
        expect(gameFinishEventSchema.safeParse({ type: `gameFinish`, gameId: `g`, winner: null, reason: `draw` }).success).toBe(false);
    });
});

describe('streamPlayerSchema', () => {
    it('wants a whole-point rating and the provisional flag beside the name', () => {
        expect(streamPlayerSchema.safeParse({ name: `abot`, rating: 1512, provisional: false }).success).toBe(true);
        expect(streamPlayerSchema.safeParse({ name: `abot` }).success).toBe(false);
        expect(streamPlayerSchema.safeParse({ name: `abot`, rating: 1512.5, provisional: false }).success).toBe(false);
    });
});

describe('timeControlSchema', () => {
    it('enforces the turn and match floors', () => {
        expect(timeControlSchema.safeParse({ mode: `turn`, turnTimeMs: 4_999 }).success).toBe(false);
        expect(timeControlSchema.safeParse({ mode: `turn`, turnTimeMs: 5_000 }).success).toBe(true);
        expect(timeControlSchema.safeParse({ mode: `match`, mainTimeMs: 59_999, incrementMs: 0 }).success).toBe(false);
        expect(timeControlSchema.safeParse({ mode: `match`, mainTimeMs: 60_000, incrementMs: 0 }).success).toBe(true);
        expect(timeControlSchema.safeParse({ mode: `match`, mainTimeMs: 60_000, incrementMs: -1 }).success).toBe(false);
        expect(timeControlSchema.safeParse({ mode: `blitz` }).success).toBe(false);
    });
});

describe('moveRequestEventSchema', () => {
    it('wants a board, and only optionally a limit and id', () => {
        const request = { board: { to_move: `x`, cells: [] } };
        expect(moveRequestEventSchema.safeParse({ type: `moveRequest`, gameId: `g`, request }).success).toBe(true);
        expect(moveRequestEventSchema.safeParse({ type: `moveRequest`, gameId: `g`, request: { time_limit: 5 } }).success).toBe(false);
    });
});

describe('acceptsSchema', () => {
    it('takes a two-number window, or null to decline turn clocks', () => {
        expect(acceptsSchema.safeParse({ turnMs: [5_000, 30_000], match: true, unlimited: false }).success).toBe(true);
        expect(acceptsSchema.safeParse({ turnMs: null, match: true, unlimited: false }).success).toBe(true);
    });

    it('rejects inverted, wrong-length, or missing windows', () => {
        const bad = [
            { turnMs: [30_000, 5_000], match: true, unlimited: false },
            { turnMs: [5_000], match: true, unlimited: false },
            { turnMs: [5_000, 30_000, 60_000], match: true, unlimited: false },
            { turnMs: [5_000, 30_000], match: true },
        ];
        for (const value of bad) {
            expect(acceptsSchema.safeParse(value).success).toBe(false);
        }
    });
});

describe('accountDeclarationSchema', () => {
    it('accepts every field and none of them', () => {
        const full = {
            about: `a careful bot`,
            version: `1.2.3`,
            repoUrl: `https://github.com/example/bot`,
            accepts: { turnMs: null, match: true, unlimited: false },
        };
        expect(accountDeclarationSchema.safeParse(full).success).toBe(true);
        expect(accountDeclarationSchema.safeParse({}).success).toBe(true);
    });

    it('refuses control and bidirectional characters in about and version, and takes other text as written', () => {
        for (const text of [`a\nb`, `tab\there`, `nul\u0000`, `\u202eabc`, `x\u2067y`, `mark\u200f`, `arabic\u061c`]) {
            expect(accountDeclarationSchema.safeParse({ about: text }).success, JSON.stringify(text)).toBe(false);
            expect(accountDeclarationSchema.safeParse({ version: text }).success, JSON.stringify(text)).toBe(false);
        }
        expect(accountDeclarationSchema.safeParse({ about: `Spielt vorsichtig, \u00e9l\u00e8ve de HeXO, \u{1f40d}`, version: `v2.1.0-rc.1` }).success).toBe(true);
    });

    it('caps about at 280 chars and version at 64', () => {
        expect(accountDeclarationSchema.safeParse({ about: `a`.repeat(281) }).success).toBe(false);
        expect(accountDeclarationSchema.safeParse({ version: `v`.repeat(65) }).success).toBe(false);
    });

    it('takes http and https urls, the empty string, and nothing else', () => {
        for (const repoUrl of [`http://example.com/bot.js`, `https://github.com/example/bot`, ``]) {
            expect(accountDeclarationSchema.safeParse({ repoUrl }).success).toBe(true);
        }
        for (const repoUrl of [`ftp://example.com`, `github.com/example/bot`, `https://`, `not a url`]) {
            expect(accountDeclarationSchema.safeParse({ repoUrl }).success).toBe(false);
        }
    });
});
