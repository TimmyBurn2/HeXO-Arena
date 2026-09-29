import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBots, fetchLeaderboard } from '../src/api/client';

const calls: string[] = [];

function stubJson(body: unknown, status = 200): void {
    calls.length = 0;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string | URL) => {
            calls.push(String(url));
            return Promise.resolve(new Response(JSON.stringify(body), { status }));
        }),
    );
}

const board = [{ rank: 1, name: `sealbot`, kind: `bot`, rating: 1712 }];

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchLeaderboard', () => {
    it('request the kind and parse the entries', async () => {
        stubJson(board);
        const entries = await fetchLeaderboard(`bots`);
        expect(entries).toEqual(board);
        expect(calls[0]).toBe(`/api/leaderboard?kind=bots`);
    });

    it('reject a payload off the contract', async () => {
        stubJson([{ rank: 1, name: `sealbot`, kind: `android`, rating: 1712 }]);
        await expect(fetchLeaderboard(`all`)).rejects.toThrow();
    });

    it('reject non-2xx answers as api errors with the code', async () => {
        stubJson({ error: `nope`, code: `bad_request` }, 400);
        const failure = await fetchLeaderboard(`all`).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(Error);
        expect((failure as { status: number }).status).toBe(400);
        expect((failure as { code: string | null }).code).toBe(`bad_request`);
    });
});

describe('fetchBots', () => {
    it('list the whole roster without the toggle', async () => {
        stubJson([]);
        await fetchBots(false);
        expect(calls[0]).toBe(`/api/bots`);
    });

    it('ask for online-only with the contract literal', async () => {
        stubJson([]);
        await fetchBots(true);
        expect(calls[0]).toBe(`/api/bots?online=1`);
    });

    it('parse one full listing', async () => {
        const listing = [
            {
                name: `sealbot`,
                ownerName: `tom`,
                online: true,
                openForChallenges: true,
                rating: 1712,
                provisional: false,
                liveGames: 0,
                about: `clean-room engine`,
                version: `0.3.1`,
                repoUrl: `https://github.com/tom/sealbot`,
                accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
            },
        ];
        stubJson(listing);
        expect(await fetchBots(false)).toEqual(listing);
    });
});
