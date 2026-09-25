// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot } from '@hexarena/contract';
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
    it('show both strips, the board, the feed, and the resign action while running', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { name: /hextide vs you/ })).toBeTruthy();
        expect(screen.getByText(`hextide`)).toBeTruthy();
        expect(screen.getByText(`you`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Resign` })).toBeTruthy();
        expect(document.querySelectorAll(`.feed .line`).length).toBe(1);
        expect(document.querySelector(`.board-control`)?.getAttribute(`tabindex`)).toBe(`0`);
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs you - hexarena`);
        });
    });

    it('state whose move it is and show the shared turn clock on the moving strip', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: /hextide vs you/ });
        expect(screen.getByText(`, o, your move: two stones`)).toBeTruthy();
        expect(document.querySelectorAll(`.clock`).length).toBe(1);
    });

    it('freeze into the finished state with the result and the win line', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won, six in a row`)).toBeTruthy();
        expect(document.querySelector(`polyline.win-line`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Resign` })).toBe(null);
        expect(document.querySelector(`.board-control`)?.hasAttribute(`tabindex`)).toBe(false);
        await waitFor(() => {
            expect(document.title).toBe(`hextide won (six in a row) - hexarena`);
        });
    });

    it('not-found for a game that is not yours', async () => {
        stubGame(runningSnapshot, 404);
        render(<GameScreen gameId="g-x" />);
        expect(await screen.findByText(`no such game of yours`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Arena` }).getAttribute(`href`)).toBe(`/`);
    });

    it('resign only on the confirm step', async () => {
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
        const resign = await screen.findByRole(`button`, { name: `Resign` });
        fireEvent.click(resign);
        expect(screen.getByRole(`button`, { name: `Confirm resign` })).toBeTruthy();
        expect(posts).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Confirm resign` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/games/g-run/resign`]);
        });
        expect(await screen.findByText(`hextide won, six in a row`)).toBeTruthy();
    });
});
