// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { meStore } from '../src/me';
import { LadderScreen } from '../src/screens/LadderScreen';

const board = [
    { rank: 1, name: `sealbot`, kind: `bot`, rating: 1712, games: 214, lastPlayedAt: `2026-10-01T08:00:00Z`, ownerName: `quinn`, online: true },
    { rank: 2, name: `hextide`, kind: `bot`, rating: 1690, games: 188, lastPlayedAt: `2026-09-30T08:00:00Z`, ownerName: `ana`, online: false },
    { rank: 3, name: `quinn`, kind: `human`, rating: 1503, games: 57, lastPlayedAt: `2026-09-29T08:00:00Z` },
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
    meStore.reset();
    window.history.replaceState(null, ``, `/`);
});

const roster = [
    { name: `sealbot`, ownerName: `quinn`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 0, levels: null, analyzer: null, accepts: { turnMs: [5000, 60000], match: true, unlimited: true } },
    { name: `hextide`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1690, provisional: false, liveGames: 0, levels: null, analyzer: null },
];

// The board answers by its query, the roster and the session by path.
function serve(answer: (search: string) => unknown, me: unknown = null): string[] {
    const reads: string[] = [];
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            reads.push(url);
            const [path = ``, search = ``] = url.split(`?`);
            const body = path === `/api/me` ? me : path === `/api/bots` ? roster : answer(search);
            return Promise.resolve(new Response(JSON.stringify(body)));
        }),
    );
    meStore.reset();
    meStore.start();
    return reads;
}

const quinn = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

describe('LadderScreen', () => {
    it('render the whole board: rank, player with presence and owner, rating, games, and last played', async () => {
        stubBoard(board);
        render(<LadderScreen />);
        const table = await screen.findByRole(`table`);
        expect([...table.querySelectorAll(`th`)].map((head) => head.textContent)).toEqual([`Rank`, `Player`, `Rating`, `Games`, `Last played`]);
        const first = table.querySelector(`tbody tr`) as HTMLElement;
        expect([...first.querySelectorAll(`td`)].map((cell) => cell.textContent)).toEqual([`1`, `sealbotBOTby quinn`, `1712`, `214`, expect.stringMatching(/ago$/u)]);
        expect(first.querySelector(`.dot`)?.getAttribute(`title`)).toBe(`Online`);
        expect(table.querySelector(`tbody tr:nth-child(2) .dot.offline`)).toBeTruthy();
        expect(table.querySelector(`tbody tr:nth-child(3) .dot`)).toBe(null);
        expect(screen.getAllByRole(`link`, { name: /sealbot/ })[0]?.getAttribute(`href`)).toBe(`/bots/sealbot`);
        expect(document.querySelector(`a[href="/bots/quinn"]`)).toBe(null);
        expect(first.querySelector(`.ladder-owner a`)?.getAttribute(`href`)).toBe(`/players/quinn`);
    });

    it('stand the top three on a podium of 5, 6, and 4 stones, the six won, labelled for a reader', async () => {
        serve(() => board);
        render(<LadderScreen />);
        const podium = await screen.findByRole(`region`, { name: `Top of the ladder` });
        const [wide] = within(podium).getAllByRole(`img`);
        expect(wide?.getAttribute(`aria-label`)).toBe(`Podium: first sealbot, 1712; second hextide, 1690; third quinn, 1503`);
        expect(wide?.querySelectorAll(`g.stone`)).toHaveLength(15);
        expect(wide?.querySelectorAll(`polyline.win-line`)).toHaveLength(1);
        const plates = [...podium.querySelectorAll(`.podium-slot`)];
        expect(plates.map((plate) => plate.className)).toEqual([`podium-slot p1`, `podium-slot p2`, `podium-slot p3`]);
        expect(plates[0]?.textContent).toBe(`1sealbotBOT1712by quinn, 214 gamesPlay`);
        expect(plates[0]?.querySelector(`.podium-meta a`)?.getAttribute(`href`)).toBe(`/players/quinn`);
        expect(plates[2]?.textContent).toBe(`3quinn150357 games`);
        // Only a bot that would start a game now offers Play.
        await waitFor(() => {
            expect(within(podium).getAllByRole(`link`, { name: /^Play / }).map((link) => link.getAttribute(`href`))).toEqual([`/play?bot=sealbot`]);
        });
    });

    it('stand fewer towers for fewer players, first in the middle', async () => {
        serve(() => board.slice(0, 2));
        render(<LadderScreen />);
        const podium = await screen.findByRole(`region`, { name: `Top of the ladder` });
        expect(within(podium).getAllByRole(`img`)[0]?.querySelectorAll(`g.stone`)).toHaveLength(11);
        cleanup();
        serve(() => board.slice(0, 1));
        render(<LadderScreen />);
        const alone = await screen.findByRole(`region`, { name: `Top of the ladder` });
        expect(within(alone).getAllByRole(`img`)[0]?.querySelectorAll(`g.stone`)).toHaveLength(6);
        expect(alone.querySelector(`.podium-plates`)?.getAttribute(`data-places`)).toBe(`1`);
    });

    it('hold the kind and the window in the address and read the board they name', async () => {
        window.history.replaceState(null, ``, `/ladder?kind=bots`);
        const reads = serve(() => board);
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        expect(screen.getByRole(`button`, { name: `Bots` }).getAttribute(`aria-pressed`)).toBe(`true`);
        fireEvent.change(screen.getByLabelText(`Played`), { target: { value: `all` } });
        expect(window.location.search).toBe(`?kind=bots&active=all`);
        await waitFor(() => {
            expect(reads.filter((url) => url.startsWith(`/api/leaderboard`)).at(-1)).toBe(`/api/leaderboard?kind=bots&active=all`);
        });
        fireEvent.click(screen.getByRole(`button`, { name: `All` }));
        expect(window.location.search).toBe(`?active=all`);
    });

    it('find a name among the rows, keeping their ranks and marking the one named', async () => {
        serve(() => board);
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        fireEvent.change(screen.getByLabelText(`Find a name`), { target: { value: `HEXTIDE` } });
        const rows = [...document.querySelectorAll(`tbody tr`)];
        expect(rows.map((row) => row.querySelector(`td`)?.textContent)).toEqual([`2`]);
        expect(rows[0]?.classList.contains(`found`)).toBe(true);
        fireEvent.change(screen.getByLabelText(`Find a name`), { target: { value: `zz` } });
        expect(document.querySelector(`tbody .table-note`)?.textContent).toBe(`No player on this ladder matches zz`);
    });

    it('say where the signed-in player stands and take them to their row, clearing the search', async () => {
        serve(() => board, quinn);
        render(<LadderScreen />);
        expect(await screen.findByText(`You are 3rd with 1503`)).toBeTruthy();
        fireEvent.change(screen.getByLabelText(`Find a name`), { target: { value: `seal` } });
        expect(document.querySelector(`tr.you`)).toBe(null);
        fireEvent.click(screen.getByRole(`button`, { name: `Show my row` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(document.querySelector(`tr.you`));
        });
        expect(screen.getByLabelText<HTMLInputElement>(`Find a name`).value).toBe(``);
    });

    it('tell a provisional player their rating is still settling', async () => {
        serve(() => board, { ...quinn, name: `newcomer`, provisional: true });
        render(<LadderScreen />);
        expect(await screen.findByText(`Your rating is still settling; you join the ladder once it is no longer provisional.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Show my row` })).toBe(null);
    });

    it('send a quiet month to all time, where ranked players still stand', async () => {
        serve((search) => (search.includes(`active=all`) ? board : []));
        render(<LadderScreen />);
        expect(await screen.findByRole(`heading`, { name: `No ranked player played in the last 30 days` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Show all time` }).getAttribute(`href`)).toBe(`/ladder?active=all`);
    });

    it('count the ranked players and the bots online in one sentence, a zero in words', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(
                            url.startsWith(`/api/bots`)
                                ? [
                                      { name: `sealbot`, ownerName: `quinn`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 0, levels: null, analyzer: null },
                                      { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1690, provisional: false, liveGames: 0, levels: null, analyzer: null },
                                  ]
                                : board,
                        ),
                    ),
                ),
            ),
        );
        render(<LadderScreen />);
        await waitFor(() => {
            expect(document.querySelector(`.pulse`)?.textContent).toBe(`3 ranked players; 2 bots online, 1 open for challenges`);
        });
        cleanup();
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(new Response(JSON.stringify(url.startsWith(`/api/bots`) ? [] : board))),
            ),
        );
        render(<LadderScreen />);
        await waitFor(() => {
            expect(document.querySelector(`.pulse`)?.textContent).toBe(`3 ranked players; no bots online`);
        });
    });

    it('keep the board when the directory does not load', async () => {
        stubBoard(board);
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        expect(document.querySelector(`.pulse`)?.textContent).toBe(`3 ranked players`);
    });

    it('never mark a leaderboard rating provisional', async () => {
        stubBoard(board);
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        expect(document.querySelector(`.prov`)).toBe(null);
    });

    it('carry aria-pressed on exactly the active kind pill', async () => {
        stubBoard(board);
        render(<LadderScreen />);
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
        render(<LadderScreen />);
        expect(await screen.findByText(`No ranked players yet`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
        expect(screen.getByRole(`link`, { name: `Browse bots` }).getAttribute(`href`)).toBe(`/bots`);
    });

    it('offer a retry when the first load fails', async () => {
        stubBoard([], 500);
        render(<LadderScreen />);
        expect(await screen.findByText(`The ladder did not load`)).toBeTruthy();
        stubBoard(board);
        fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
        await waitFor(() => {
            expect(screen.getByRole(`table`)).toBeTruthy();
        });
    });

    it('hold the retry of a rate-limited load for its wait, counting it down', async () => {
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        try {
            vi.stubGlobal(
                `fetch`,
                vi.fn(() =>
                    Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `2` } })),
                ),
            );
            render(<LadderScreen />);
            expect(await screen.findByText(`The ladder did not load`)).toBeTruthy();
            const retry = screen.getByRole(`button`, { name: `Try again` });
            const shown = () => document.querySelector(`.empty [aria-hidden="true"]`)?.textContent;
            await waitFor(() => {
                expect(shown()).toBe(`Too many tries; try again in 2 s`);
            });
            const reads = () => vi.mocked(fetch).mock.calls.filter(([url]) => typeof url === `string` && url.startsWith(`/api/leaderboard`)).length;
            const before = reads();
            fireEvent.click(retry);
            await act(async () => {});
            expect(reads()).toBe(before);
            expect(document.querySelector(`.empty [role="status"] .sr-only`)?.textContent).toBe(`Too many tries; try again in 2 s`);
            expect(retry.getAttribute(`aria-disabled`)).toBe(`true`);
            await act(async () => {});
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(shown()).toBe(`Too many tries; try again in 1 s`);
            act(() => {
                vi.advanceTimersByTime(1000);
            });
            expect(screen.queryByText(/try again in/u)).toBe(null);
            expect(retry.getAttribute(`aria-disabled`)).toBe(null);
            fireEvent.click(retry);
            await waitFor(() => {
                expect(reads()).toBe(before + 1);
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it('tint the signed-in player\'s own row', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(url === `/api/me` ? { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } : board),
                    ),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<LadderScreen />);
        await screen.findByRole(`table`);
        await waitFor(() => {
            expect(document.querySelector(`tr.you .player-name`)?.textContent).toBe(`quinn`);
        });
        expect(document.querySelectorAll(`tr.you`)).toHaveLength(1);
        meStore.reset();
    });
});
