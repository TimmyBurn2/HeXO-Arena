// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArenaScreen } from '../src/screens/ArenaScreen';

const board = [
    { rank: 1, name: `sealbot`, kind: `bot`, rating: 1712 },
    { rank: 2, name: `hextide`, kind: `bot`, rating: 1690 },
    { rank: 3, name: `tom`, kind: `human`, rating: 1503 },
];

function stubBoard(rows: unknown[], status = 200): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(rows), { status }))),
    );
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('ArenaScreen', () => {
    it('render the whole board with its podium and linked bot names', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        expect(await screen.findByRole(`table`)).toBeTruthy();
        expect(screen.getAllByRole(`link`, { name: /sealbot/ })[0]?.getAttribute(`href`)).toBe(`/bots/sealbot`);
        expect(document.querySelector(`a[href="/bots/tom"]`)).toBe(null);
        expect(document.querySelectorAll(`.podium-step`).length).toBe(3);
        expect(document.querySelectorAll(`.badge-bot`).length).toBe(4);
    });

    it('order the podium heights two one three', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        const steps = [...document.querySelectorAll(`.podium-step`)].map((step) => step.className);
        expect(steps).toEqual([`podium-step p2`, `podium-step p1`, `podium-step p3`]);
    });

    it('never mark a leaderboard rating provisional', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        expect(document.querySelector(`.prov`)).toBe(null);
    });

    it('carry aria-pressed on exactly the active kind pill', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        const all = screen.getByRole(`button`, { name: `All` });
        const bots = screen.getByRole(`button`, { name: `Bots` });
        expect(all.getAttribute(`aria-pressed`)).toBe(`true`);
        expect(bots.getAttribute(`aria-pressed`)).toBe(`false`);
        fireEvent.click(bots);
        await waitFor(() => {
            expect(bots.getAttribute(`aria-pressed`)).toBe(`true`);
            expect(all.getAttribute(`aria-pressed`)).toBe(`false`);
        });
    });

    it('show the day-one empty state when the board has no rows', async () => {
        stubBoard([]);
        render(<ArenaScreen />);
        expect(await screen.findByText(`no ranked players yet`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Connect a bot` }).getAttribute(`href`)).toBe(`/connect`);
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
    });

    it('offer a retry when the first load fails', async () => {
        stubBoard([], 500);
        render(<ArenaScreen />);
        expect(await screen.findByText(`the board did not load`)).toBeTruthy();
        stubBoard(board);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`table`)).toBeTruthy();
        });
    });
});
