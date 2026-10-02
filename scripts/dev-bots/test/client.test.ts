import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, ArenaClient } from '../src/client';

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('ArenaClient', () => {
    it('carry the wait a refusal names, so a bot retries no sooner', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `7` } }))),
        );
        const refused = await new ArenaClient(`http://arena.test`).challenge(`hxo_token`, `otherbot`, { mode: `unlimited` }, `request`).catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(ApiError);
        expect(refused).toMatchObject({ status: 429, code: `rate_limited`, retryAfter: 7 });
    });

    it('carry no wait when the refusal names none', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: `no`, code: `not_open` }), { status: 400 }))));
        const refused = await new ArenaClient(`http://arena.test`).challenge(`hxo_token`, `otherbot`, { mode: `unlimited` }, `request`).catch((error: unknown) => error);
        expect(refused).toMatchObject({ status: 400, retryAfter: null });
    });
});
