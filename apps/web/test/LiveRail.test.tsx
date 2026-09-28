// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LiveGameEntry } from '@hexo-arena/contract';
import { liveRefreshMs } from '../src/api/use-live-games';
import { LiveRail } from '../src/components/LiveRail';
import { LadderScreen } from '../src/screens/LadderScreen';

const guestGame: LiveGameEntry = {
    gameId: `g-guest`,
    players: {
        x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
        o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
    },
    timeControl: { mode: `turn`, turnTimeMs: 30_000 },
    toMove: `o`,
    rated: false,
    plies: 7,
};

const botGame: LiveGameEntry = {
    gameId: `g-bots`,
    players: {
        x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
        o: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
    },
    timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
    toMove: `x`,
    rated: true,
    plies: 12,
};

// Every read answers by path: the live list, the board, or an empty roster.
function stubReads(live: () => unknown, board: unknown[] = [{ rank: 1, name: `sealbot`, kind: `bot`, rating: 1712 }]): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            const body = url === `/api/games` ? live() : url.startsWith(`/api/leaderboard`) ? board : [];
            return Promise.resolve(new Response(JSON.stringify(body)));
        }),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('LiveRail', () => {
    it('link each live game with both seats, its clock, whose turn, and an unrated tag for a guest game', async () => {
        stubReads(() => [guestGame, botGame]);
        render(<LiveRail />);
        const links = await screen.findAllByRole(`link`);
        expect(links.map((link) => link.getAttribute(`href`))).toEqual([`/game/g-guest`, `/game/g-bots`]);
        expect(links[0]?.textContent).toBe(`Watch sealbotBOTvsGuest k3f9unratedturn clock 30 sGuest k3f9 to move`);
        expect(links[1]?.textContent).toBe(`Watch hextideBOTvssealbotBOTmatch clock 5 min + 2 shextide to move`);
    });

    it('say so in one quiet line when nothing is live', async () => {
        stubReads(() => []);
        render(<LiveRail />);
        expect(await screen.findByText(`No live games right now.`)).toBeTruthy();
    });

    it('say in one line without a period that the list did not load', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(`{}`, { status: 500 }))),
        );
        render(<LiveRail />);
        expect(await screen.findByText(`Live games did not load; trying again shortly`)).toBeTruthy();
    });

    it('reread the list on its beat', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        let live: LiveGameEntry[] = [];
        stubReads(() => live);
        render(<LiveRail />);
        await screen.findByText(`No live games right now.`);
        live = [botGame];
        await act(async () => {
            await vi.advanceTimersByTimeAsync(liveRefreshMs);
        });
        expect(await screen.findByRole(`link`)).toBeTruthy();
    });
});

describe('LadderScreen live rail', () => {
    it('sit under the ladder', async () => {
        stubReads(() => [botGame]);
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        expect(await screen.findByRole(`heading`, { name: `Live games` })).toBeTruthy();
        const order = [...document.querySelectorAll(`table, .live-rail`)].map((element) => element.tagName);
        expect(order).toEqual([`TABLE`, `SECTION`]);
    });

    it('stay mounted through a filter switch without reading the list again', async () => {
        const fetched = vi.fn((url: string) => {
            const body = url === `/api/games` ? [botGame] : url.startsWith(`/api/leaderboard`) ? [{ rank: 1, name: `sealbot`, kind: `bot`, rating: 1712 }] : [];
            return Promise.resolve(new Response(JSON.stringify(body)));
        });
        vi.stubGlobal(`fetch`, fetched);
        render(<LadderScreen />);
        const rail = await screen.findByRole(`region`, { name: `Live games` });
        await screen.findByRole(`link`, { name: /^Watch hextide/ });
        fireEvent.click(screen.getByRole(`button`, { name: `Bots` }));
        await waitFor(() => {
            expect(fetched.mock.calls.filter(([url]) => url.startsWith(`/api/leaderboard`)).length).toBe(2);
        });
        expect(screen.getByRole(`region`, { name: `Live games` })).toBe(rail);
        expect(fetched.mock.calls.filter(([url]) => url === `/api/games`)).toHaveLength(1);
    });

    it('follow the day-one empty state only while a game is live', async () => {
        stubReads(() => [botGame], []);
        render(<LadderScreen />);
        expect(await screen.findByText(`No ranked players yet`)).toBeTruthy();
        expect(await screen.findByRole(`heading`, { name: `Live games` })).toBeTruthy();
        const order = [...document.querySelectorAll(`.empty, .live-rail`)].map((element) => element.className);
        expect(order).toEqual([`empty`, `live-rail`]);
        cleanup();
        stubReads(() => [], []);
        render(<LadderScreen />);
        await screen.findByText(`No ranked players yet`);
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(screen.queryByRole(`heading`, { name: `Live games` })).toBe(null);
        expect(screen.queryByText(`No live games right now.`)).toBe(null);
    });
});
