// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
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
    it('render the whole board with its top rungs and linked bot names', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        expect(await screen.findByRole(`table`)).toBeTruthy();
        expect(screen.getAllByRole(`link`, { name: /sealbot/ })[0]?.getAttribute(`href`)).toBe(`/bots/sealbot`);
        expect(document.querySelector(`a[href="/bots/tom"]`)).toBe(null);
        expect(document.querySelectorAll(`.rung`).length).toBe(3);
        expect(document.querySelectorAll(`.badge-bot`).length).toBe(4);
    });

    it('step the rungs down in rank order and lift only the first', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        const rungs = [...document.querySelectorAll(`.rung`)].map((rung) => rung.className);
        expect(rungs).toEqual([`rung r1`, `rung r2`, `rung r3`]);
        expect(document.querySelectorAll(`.rung-lift .rung`)).toHaveLength(1);
        expect(document.querySelector(`.rung.r3 .rung-kind`)?.textContent).toBe(`Human`);
    });

    it('count the ranked players and the bots online in one sentence', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(
                            url.startsWith(`/api/bots`)
                                ? [
                                      { name: `sealbot`, ownerName: `tom`, online: true, openForChallenges: true, rating: 1712, provisional: false },
                                      { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1690, provisional: false },
                                  ]
                                : board,
                        ),
                    ),
                ),
            ),
        );
        render(<ArenaScreen />);
        await waitFor(() => {
            expect(document.querySelector(`.pulse`)?.textContent).toBe(`3 ranked players, 2 bots online, 1 taking challenges`);
        });
        expect(document.querySelector(`.rung.r1 .rung-owner`)?.textContent).toBe(`By tom`);
    });

    it('keep the board when the directory does not load', async () => {
        stubBoard(board);
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        expect(document.querySelector(`.pulse`)?.textContent).toBe(`3 ranked players`);
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
        expect(await screen.findByText(`No ranked players yet`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Connect a bot` }).getAttribute(`href`)).toBe(`/connect`);
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
    });

    it('offer a retry when the first load fails', async () => {
        stubBoard([], 500);
        render(<ArenaScreen />);
        expect(await screen.findByText(`The board did not load`)).toBeTruthy();
        stubBoard(board);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`table`)).toBeTruthy();
        });
    });

    it('tint the signed-in player\'s own row', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(url === `/api/me` ? { kind: `user`, name: `tom`, rating: 1503, provisional: false } : board),
                    ),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<ArenaScreen />);
        await screen.findByRole(`table`);
        await waitFor(() => {
            expect(document.querySelector(`tr.you .player-name`)?.textContent).toBe(`tom`);
        });
        expect(document.querySelectorAll(`tr.you`)).toHaveLength(1);
        meStore.reset();
    });
});
