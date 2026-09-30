// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { liveGameListCap, type LiveGameEntry } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveReplayMs } from '../src/live/use-live-replay';
import { LiveGamesScreen } from '../src/screens/LiveGamesScreen';

const guestGame: LiveGameEntry = {
    gameId: `g-guest`,
    players: {
        x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
        o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
    },
    timeControl: { mode: `turn`, turnTimeMs: 30_000 },
    toMove: `o`,
    rated: false,
    cells: [
        { x: 0, y: 0, side: `x` },
        { x: 1, y: -1, side: `o` },
        { x: 0, y: 1, side: `o` },
    ],
    clock: { mode: `turn`, remainingTurnMs: 21_000 },
};

const botGame: LiveGameEntry = {
    gameId: `g-bots`,
    players: {
        x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
        o: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
    },
    timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
    toMove: `x`,
    rated: true,
    cells: [
        { x: 0, y: 0, side: `x` },
        { x: -1, y: 1, side: `o` },
        { x: 1, y: 0, side: `o` },
        { x: 2, y: 0, side: `x` },
        { x: 2, y: -1, side: `x` },
    ],
    clock: { mode: `match`, remainingMainMs: { x: 241_000, o: 263_000 } },
};

let answer: () => Response;
let streams = 0;

beforeEach(() => {
    answer = () => new Response(JSON.stringify([guestGame, botGame]));
    streams = 0;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => Promise.resolve(url === `/api/games` ? answer() : new Response(`null`))),
    );
    vi.stubGlobal(
        `EventSource`,
        vi.fn(() => {
            streams += 1;
        }),
    );
    window.history.replaceState(null, ``, `/games/live`);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('LiveGamesScreen', () => {
    it('show every live game as a board with its seats, clock, and whose turn, each a way into its game', async () => {
        render(<LiveGamesScreen />);
        expect(screen.getByRole(`heading`, { level: 1, name: `Live games` })).toBeTruthy();
        const cards = await screen.findAllByRole(`article`);
        expect(cards).toHaveLength(2);
        const [guest, bots] = cards as [HTMLElement, HTMLElement];
        expect(within(guest).getByRole(`img`, { name: `Board, sealbot vs Guest k3f9, Guest k3f9 to move` })).toBeTruthy();
        expect(within(guest).getByRole(`link`, { name: `Watch sealbot BOT vs Guest k3f9` }).getAttribute(`href`)).toBe(`/game/g-guest`);
        expect(within(guest).getByRole(`heading`, { level: 2 })).toBeTruthy();
        expect(within(guest).getByText(`unrated`)).toBeTruthy();
        expect(guest.textContent).toContain(`turn clock 30 s`);
        expect(guest.textContent).toContain(`Guest k3f9 to move`);
        expect(within(guest).getByRole(`timer`).textContent).toMatch(/^00:2[01]$/u);
        expect(within(bots).queryByText(`unrated`)).toBe(null);
        expect(bots.textContent).toContain(`match clock 5 min + 2 s`);
        expect(within(bots).getByRole(`timer`).textContent).toMatch(/^04:0[01]$/u);
        expect(within(bots).getByRole(`link`).getAttribute(`href`)).toBe(`/game/g-bots`);
        expect(screen.getByText(`2 live games`)).toBeTruthy();
        expect(streams).toBe(0);
    });

    it(`count each card's clock from the latest read`, async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `setTimeout`, `clearTimeout`, `Date`, `performance`] });
        const settle = async (ms = 0) => {
            await act(async () => {
                vi.advanceTimersByTime(ms);
                for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
            });
        };
        answer = () => new Response(JSON.stringify([guestGame]));
        render(<LiveGamesScreen />);
        await settle();
        expect(screen.getByRole(`timer`).textContent).toBe(`00:21`);
        await settle(liveReplayMs);
        expect(screen.getByRole(`timer`).textContent).toBe(`00:21`);
    });

    it('say the newest are shown when the list reaches its cap', async () => {
        answer = () =>
            new Response(JSON.stringify(Array.from({ length: liveGameListCap }, (_, index) => ({ ...botGame, gameId: `g-${String(index)}` }))));
        render(<LiveGamesScreen />);
        expect(await screen.findByText(`The ${String(liveGameListCap)} newest live games`)).toBeTruthy();
        expect(screen.getAllByRole(`article`)).toHaveLength(liveGameListCap);
    });

    it('say no game is live, with a way to start one', async () => {
        answer = () => new Response(`[]`);
        render(<LiveGamesScreen />);
        expect(await screen.findByRole(`heading`, { level: 2, name: `No live games right now` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Play a bot` }).getAttribute(`href`)).toBe(`/play`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('hold the retry of a rate-limited list for its wait', async () => {
        answer = () => new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `5` } });
        render(<LiveGamesScreen />);
        expect(await screen.findByRole(`heading`, { level: 2, name: `Live games did not load` })).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`.empty .sr-only`)?.textContent).toBe(`Too many tries; try again in 5 s`);
        });
        expect(screen.getByRole(`button`, { name: `Try again` }).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('offer a retry when the list does not load, and keep the boards when a later read fails', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `setTimeout`, `clearTimeout`] });
        const settle = async (ms = 0) => {
            await act(async () => {
                vi.advanceTimersByTime(ms);
                for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
            });
        };
        answer = () => new Response(`{}`, { status: 500 });
        render(<LiveGamesScreen />);
        await settle();
        expect(screen.getByRole(`heading`, { level: 2, name: `Live games did not load` })).toBeTruthy();
        answer = () => new Response(JSON.stringify([guestGame]));
        screen.getByRole(`button`, { name: `Try again` }).click();
        await settle();
        expect(screen.getAllByRole(`article`)).toHaveLength(1);
        // The region is on the page, empty, before it has anything to say, so readers announce what fills it.
        expect(screen.getByRole(`status`).textContent).toBe(``);
        answer = () => new Response(`{}`, { status: 500 });
        await settle(liveReplayMs);
        expect(screen.getAllByRole(`article`)).toHaveLength(1);
        expect(screen.getByRole(`status`).textContent).toBe(`Live games did not refresh; trying again shortly`);
    });
});
