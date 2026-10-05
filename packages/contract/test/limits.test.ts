import { describe, expect, it } from 'vitest';
import {
    bwsMoveRequestPacketSchema,
    gameTurnCap,
    moveRequestEventSchema,
    requestBodyLimitBytes,
    serverLineLimitBytes,
    streamBacklogLimitBytes,
    archiveReadGlobalLimit,
    archiveReadLimit,
    botManagementLimit,
    challengeDailyCap,
    challengePairPendingCap,
    clientWatcherCap,
    guestMintLimit,
    guestSessionCap,
    seatWatcherCap,
    signInFailureSchema,
    signInStartLimit,
    signInStateCap,
    clientRequestLimit,
    engineDialLimit,
    engineFrameLimitBytes,
    engineStrayFrameCap,
    orphanForfeitMs,
    principalRequestLimit,
    publicRequestLimit,
    rateLimitedErrorCodes,
    rateText,
    streamOpenLimit,
} from '../src';

describe('rateText', () => {
    it('words a limit as its burst, then its refill, a second, a minute, or a span', () => {
        expect(rateText({ burst: 60, refillMs: 100 })).toBe(`60 at once, then 10 a second`);
        expect(rateText({ burst: 5, refillMs: 10_000 })).toBe(`5 at once, then 1 every 10 s`);
        expect(rateText({ burst: 10, refillMs: 60_000 })).toBe(`10 at once, then 1 a minute`);
        expect(rateText({ burst: 3, refillMs: 20 * 60_000 })).toBe(`3 at once, then 1 every 20 min`);
        expect(rateText({ burst: 20, refillMs: 1_000 })).toBe(`20 at once, then 1 a second`);
    });
});

describe('request limits', () => {
    it('let one client make 60 requests at once and 10 a second, and every caller without a credential 300 at once and 100 a second', () => {
        expect(clientRequestLimit).toEqual({ burst: 60, refillMs: 100 });
        expect(publicRequestLimit).toEqual({ burst: 300, refillMs: 10 });
        expect(rateLimitedErrorCodes).toEqual([`rate_limited`]);
    });
});

describe('principal limits', () => {
    it('hold each bot, user, guest, and seat to 20 at once and 2 a second, and bot management to 10, then 1 a minute', () => {
        expect(principalRequestLimit).toEqual({ burst: 20, refillMs: 500 });
        expect(botManagementLimit).toEqual({ burst: 10, refillMs: 60_000 });
    });

    it('refill stream opens and engine dials inside the orphan window, so a limited bot can always return before it forfeits', () => {
        expect(streamOpenLimit).toEqual({ burst: 5, refillMs: 10_000 });
        expect(engineDialLimit).toEqual({ burst: 5, refillMs: 10_000 });
        expect(streamOpenLimit.refillMs).toBeLessThan(orphanForfeitMs);
        expect(engineDialLimit.refillMs).toBeLessThan(orphanForfeitMs);
    });

    it('close an engine session after 10 frames that answer no request, or one frame over 16 KiB', () => {
        expect(engineStrayFrameCap).toBe(10);
        expect(engineFrameLimitBytes).toBe(16 * 1024);
    });
});

describe('anonymous caps per client', () => {
    it('let one client mint 3 guests at once, then 1 every 20 minutes, under the cap of 5,000 live guests', () => {
        expect(guestMintLimit).toEqual({ burst: 3, refillMs: 20 * 60_000 });
        expect(guestSessionCap).toBe(5_000);
    });

    it('let one client start 10 sign-ins at once, then 1 every 30 s, with 500 waiting at most, and name the refusal busy', () => {
        expect(signInStartLimit).toEqual({ burst: 10, refillMs: 30_000 });
        expect(signInStateCap).toBe(500);
        expect(signInFailureSchema.options).toContain(`busy`);
    });

    it('let one client watch 10 games without a seat and a seat hold 4 streams of its game', () => {
        expect(clientWatcherCap).toBe(10);
        expect(seatWatcherCap).toBe(4);
    });

    it('let one client read 10 finished games at once, then 1 a second, and all callers 20, then 10 a second', () => {
        expect(archiveReadLimit).toEqual({ burst: 10, refillMs: 1_000 });
        expect(archiveReadGlobalLimit).toEqual({ burst: 20, refillMs: 100 });
    });
});

describe('quotas', () => {
    it('let one bot send 200 challenges a UTC day, and hold one pending for any one target', () => {
        expect(challengeDailyCap).toBe(200);
        expect(challengePairPendingCap).toBe(1);
    });
});

describe('bounds', () => {
    it('end a game at 500 turns, and bound bodies at 16 KiB, lines at 64 KiB, and a backlog at 128 KiB', () => {
        expect(gameTurnCap).toBe(500);
        expect(requestBodyLimitBytes).toBe(16 * 1024);
        expect(serverLineLimitBytes).toBe(64 * 1024);
        expect(streamBacklogLimitBytes).toBe(128 * 1024);
    });

    it('fit the longest game into one line of the stream and one engine frame', () => {
        // Every stone of a game at the turn cap, as far from the origin as placement allows:
        // each stone at most the placement radius past the one before.
        const stones = 1 + 2 * gameTurnCap;
        const far = -8 * stones;
        const moveRequest = moveRequestEventSchema.parse({
            type: `moveRequest`,
            gameId: `g_00000000-0000-0000-0000-000000000000`,
            request: {
                board: { to_move: `x`, cells: Array.from({ length: stones }, () => ({ q: far, r: far, p: `o` })) },
                time_limit: 86_400,
                request_id: 2 ** 31,
            },
        });
        expect(JSON.stringify(moveRequest).length + 1).toBeLessThanOrEqual(serverLineLimitBytes);
        const frame = bwsMoveRequestPacketSchema.parse({
            type: `move_request`,
            side: `x`,
            previous: Array.from({ length: gameTurnCap }, () => ({ side: `o`, pieces: [{ q: far, r: far }, { q: far, r: far }] })),
            move_time_limit: 86_400,
            request_id: 2 ** 31,
        });
        expect(JSON.stringify(frame).length).toBeLessThanOrEqual(serverLineLimitBytes);
    });
});
