// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot } from '@hexarena/contract';
import { meStore } from '../src/me';
import { GameScreen } from '../src/screens/GameScreen';

const finishedCells = [
    { x: 0, y: 0, side: `x` as const },
    { x: 1, y: 0, side: `o` as const },
    { x: 2, y: 0, side: `o` as const },
    { x: 1, y: -1, side: `x` as const },
    { x: 2, y: -1, side: `x` as const },
    { x: 3, y: 0, side: `o` as const },
    { x: 4, y: 0, side: `o` as const },
    { x: 3, y: -1, side: `x` as const },
    { x: 2, y: 1, side: `x` as const },
    { x: 5, y: 0, side: `o` as const },
    { x: 6, y: 0, side: `o` as const },
];

const runningSnapshot = {
    gameId: `g-run`,
    you: `o`,
    opponent: { name: `hextide`, rating: 1690, provisional: false },
    openingTurns: 1,
    board: {
        cells: [
            { x: 0, y: 0, side: `x` as const },
            { x: 1, y: -1, side: `o` as const },
            { x: 0, y: 1, side: `o` as const },
        ],
    },
    status: `in-progress`,
    toMove: `o`,
    clock: { mode: `turn`, remainingTurnMs: 47_000 },
} as GameSnapshot;

const finishedSnapshot = {
    gameId: `g-end`,
    you: `o`,
    opponent: { name: `hextide`, rating: 1690, provisional: false },
    openingTurns: 1,
    board: { cells: finishedCells },
    status: `finished`,
    winner: `x`,
    reason: `six-in-a-row`,
} as GameSnapshot;

function stubGame(snapshot: GameSnapshot, status = 200): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(snapshot), { status }))),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('GameScreen', () => {
    it('lay the board, both players, and the turn over the stage while running', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { name: `hextide vs you` })).toBeTruthy();
        expect(document.querySelector(`.hud-top-left .hud-name`)?.textContent).toBe(`hextideBOT`);
        expect(document.querySelector(`.hud-bottom-left .hud-name`)?.textContent).toBe(`you`);
        expect(document.querySelector(`.hud-bottom-center .hud-turn`)?.textContent).toBe(`Your move`);
        expect(document.querySelector(`.board-control`)?.getAttribute(`tabindex`)).toBe(`0`);
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs you - hexarena`);
        });
    });

    it('show the shared turn clock on the chip of the side to move alone', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        expect(document.querySelectorAll(`.hud-lift .clock`)).toHaveLength(1);
        expect(document.querySelector(`.hud-bottom-left .clock.active`)).toBeTruthy();
    });

    it('keep the feed and resign in the drawer, opened by the toggle or the m key', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        fireEvent.keyDown(window, { key: `m` });
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(false);
        expect(document.querySelectorAll(`.feed .feed-line`)).toHaveLength(1);
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByRole(`button`, { name: `Resign` })).toBeTruthy();
        fireEvent.keyDown(screen.getByRole(`tab`, { name: `Game` }), { key: `Escape` });
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
    });

    it('freeze into the finished state with the result, the win line, and the record open', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won, six in a row`, { selector: `.hud-result` })).toBeTruthy();
        expect(document.querySelector(`polyline.win-line`)).toBeTruthy();
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        expect(document.querySelector(`.board-control`)?.hasAttribute(`tabindex`)).toBe(false);
        await waitFor(() => {
            expect(document.title).toBe(`hextide won (six in a row) - hexarena`);
        });
    });

    it('not-found for a game that is not yours', async () => {
        stubGame(runningSnapshot, 404);
        render(<GameScreen gameId="g-x" />);
        expect(await screen.findByText(`No such game of yours`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Arena` }).getAttribute(`href`)).toBe(`/`);
    });

    it('resign only on the confirm step, then open the record', async () => {
        const posts: string[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string | URL, init?: RequestInit) => {
                const requested = String(url);
                if (init?.method === `POST`) posts.push(requested);
                return Promise.resolve(
                    new Response(
                        JSON.stringify(init?.method === `POST` ? finishedSnapshot : runningSnapshot),
                        { status: 200 },
                    ),
                );
            }),
        );
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        fireEvent.click(screen.getByRole(`button`, { name: `Moves, look, and game` }));
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign` }));
        expect(screen.getByRole(`button`, { name: `Confirm resign` })).toBeTruthy();
        expect(posts).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Confirm resign` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/games/g-run/resign`]);
        });
        expect(await screen.findByText(`hextide won, six in a row`, { selector: `.hud-result` })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByRole(`tab`, { name: `Moves` }).getAttribute(`aria-selected`)).toBe(`true`);
        });
    });

    it('name the player in their own chip and mark a guest unrated', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(url === `/api/me` ? { kind: `guest`, name: `Guest k3f9` } : runningSnapshot),
                    ),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<GameScreen gameId="g-run" />);
        await waitFor(() => {
            expect(document.querySelector(`.hud-bottom-left .hud-name`)?.textContent).toBe(`Guest k3f9`);
        });
        expect(document.querySelector(`.hud-bottom-left .tag`)?.textContent).toBe(`unrated`);
        meStore.reset();
    });

    it('close the drawer from its own control and keep focus on the page', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        fireEvent.click(screen.getByRole(`button`, { name: `Moves, look, and game` }));
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(false);
        (document.querySelector(`.drawer-tab`) as HTMLElement).focus();
        fireEvent.click(document.querySelector(`.drawer-close`) as HTMLElement);
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        expect(document.activeElement).not.toBe(document.body);
    });

    it('keep the board and say so when the connection drops', async () => {
        let calls = 0;
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => {
                calls += 1;
                return calls === 1
                    ? Promise.resolve(new Response(JSON.stringify(runningSnapshot), { status: 200 }))
                    : Promise.reject(new Error(`offline`));
            }),
        );
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await vi.advanceTimersByTimeAsync(2100);
        expect(await screen.findByText(`Connection lost, retrying`)).toBeTruthy();
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(3);
        vi.useRealTimers();
    });
});
