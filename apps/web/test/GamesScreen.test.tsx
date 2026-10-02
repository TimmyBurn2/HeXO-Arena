// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishedGameEntry, FinishedGamesPage, GamePlayer } from '@hexo-arena/contract';
import { navigate } from '../src/router/use-route';
import { GamesScreen } from '../src/screens/GamesScreen';

const hextide: GamePlayer = { name: `hextide`, rating: 1712, provisional: false, kind: `bot` };
const quietlake: GamePlayer = { name: `quietlake`, rating: 1690, provisional: true, kind: `bot` };

function game(index: number, overrides: Partial<FinishedGameEntry> = {}): FinishedGameEntry {
    return {
        gameId: `g-${String(index)}`,
        players: { x: hextide, o: quietlake },
        winner: `x`,
        reason: `six-in-a-row`,
        timeControl: { mode: `turn`, turnTimeMs: 10_000 },
        openingPlies: 5,
        turns: 38,
        finishedAt: new Date(Date.now() - 3 * 3_600_000 - index * 60_000).toISOString(),
        rated: true,
        voided: false,
        ...overrides,
    };
}

const record = { games: 41, won: 24, lost: 15, undecided: 2, voided: 0, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };

type Answer = FinishedGamesPage | number;

// Each finished-games read answers by its query string; the live list is empty.
function serve(answer: (search: string) => Answer): ReturnType<typeof vi.fn> {
    const fetch = vi.fn((url: string) => {
        const [path = ``, search = ``] = url.split(`?`);
        if (path !== `/api/games/finished`) return Promise.resolve(new Response(`[]`));
        const reply = answer(search);
        if (typeof reply === `number`) return Promise.resolve(new Response(JSON.stringify({ error: `no`, code: `not_found` }), { status: reply }));
        return Promise.resolve(new Response(JSON.stringify(reply)));
    });
    vi.stubGlobal(`fetch`, fetch);
    return fetch;
}

function open(path: string): void {
    window.history.replaceState(null, ``, path);
    render(<GamesScreen />);
}

// The filters past Player live in the panel the Filters button opens.
function openFilters(): HTMLElement {
    fireEvent.click(screen.getByRole(`button`, { name: /^Filters/u }));
    return screen.getByRole(`dialog`, { name: `Filters` });
}

function reads(fetch: ReturnType<typeof vi.fn>): string[] {
    return fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(`/api/games/finished`));
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
});

describe('GamesScreen', () => {
    it('list the newest games: both seats at their rating before, the result in words, the clock, opening, length, and when', async () => {
        serve(() => ({ games: [game(0), game(1, { winner: null, reason: `aborted`, openingPlies: 1, turns: 1, timeControl: { mode: `unlimited` } })], page: 1, pages: 1, total: 2 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/game/g-0`, `/game/g-1`]);
        const [won, aborted] = rows as [HTMLElement, HTMLElement];
        expect(won.textContent).toBe(`hextideBOT1712vsquietlakeBOT1690?hextide won with six in a rowturn clock 10 s5 stones38 turns3 h ago`);
        expect(aborted.textContent).toContain(`No winner; the game was aborted`);
        expect(aborted.textContent).toContain(`unlimitedOrigin only1 turn`);
        expect(screen.getByText(`Newest first; guest games are not kept, so they never show here.`)).toBeTruthy();
        expect(screen.getByText(`2 games`)).toBeTruthy();
    });

    it('keep a voided game in the list, tagged voided beside its result', async () => {
        serve(() => ({ games: [game(0, { voided: true, rated: false }), game(1)], page: 1, pages: 1, total: 2 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        const [voided, kept] = rows as [HTMLElement, HTMLElement];
        expect(voided.querySelector(`.game-row-result`)?.textContent).toBe(`hextide won with six in a rowvoided`);
        expect(voided.querySelector(`.game-row-result .tag`)?.textContent).toBe(`voided`);
        expect(kept.querySelector(`.tag`)).toBe(null);
    });

    it('hold Player beside one Filters button, Against and Side waiting in its panel for a player and Result offering No winner alone', async () => {
        const fetch = serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(screen.getByRole(`search`).querySelectorAll(`input, select`)).toHaveLength(1);
        expect(screen.queryByLabelText(`Against`)).toBe(null);
        const panel = openFilters();
        expect(within(panel).getByText(`Against, Side, Won, and Lost wait for a name in Player.`)).toBeTruthy();
        expect([...panel.querySelectorAll(`label`)].map((label) => label.textContent)).toEqual([`Against`, `Result`, `Side`, `Ending`, `Clock`, `Opening`, `Who played`, `Before`]);
        expect(within(panel).getByLabelText(`Opening`).getAttribute(`aria-describedby`)).toBe(`games-opening-note`);
        expect(document.getElementById(`games-opening-note`)?.textContent).toBe(`Opening counts the stones on the board before the first turn, the origin and random ones near it.`);
        for (const name of [`Against`, `Side`]) expect(within(panel).getByLabelText<HTMLInputElement>(name).disabled).toBe(true);
        const result = within(panel).getByLabelText<HTMLSelectElement>(`Result`);
        expect(result.disabled).toBe(false);
        expect([...result.options].map((option) => option.textContent)).toEqual([`Any`, `No winner`]);
        const player = screen.getByLabelText(`Player`);
        fireEvent.change(player, { target: { value: `hextide` } });
        expect(window.location.search).toBe(``);
        fireEvent.keyDown(player, { key: `Enter` });
        expect(window.location.search).toBe(`?player=hextide`);
        await waitFor(() => {
            expect(within(panel).getByLabelText<HTMLSelectElement>(`Side`).disabled).toBe(false);
        });
        expect(within(panel).queryByText(`Against, Side, Won, and Lost wait for a name in Player.`)).toBe(null);
        expect([...within(panel).getByLabelText<HTMLSelectElement>(`Result`).options].map((option) => option.textContent)).toEqual([`Any`, `Won`, `Lost`, `No winner`]);
        fireEvent.change(within(panel).getByLabelText(`Clock`), { target: { value: `turn` } });
        fireEvent.change(within(panel).getByLabelText(`Side`), { target: { value: `o` } });
        expect(window.location.search).toBe(`?player=hextide&side=o&clock=turn`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?player=hextide&side=o&clock=turn`);
        });
        expect(screen.getByRole(`button`, { name: `Filters (2)` }).getAttribute(`aria-expanded`)).toBe(`true`);
        const chips = screen.getByRole(`group`, { name: `Active filters` });
        expect(within(chips).getAllByRole(`button`).map((chip) => chip.getAttribute(`aria-label`) ?? chip.textContent)).toEqual([
            `Remove hextide`,
            `Remove as o`,
            `Remove turn clock`,
            `Clear filters`,
        ]);
        fireEvent.click(within(panel).getByRole(`button`, { name: `Show games` }));
        expect(screen.queryByRole(`dialog`, { name: `Filters` })).toBe(null);
    });

    it('filter games without a winner with no player named', async () => {
        serve(() => ({ games: [game(0, { winner: null, reason: `aborted` })], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        fireEvent.change(within(openFilters()).getByLabelText(`Result`), { target: { value: `none` } });
        expect(window.location.search).toBe(`?result=none`);
        expect(screen.getByRole(`button`, { name: `Filters (1)` })).toBeTruthy();
    });

    it('take a chip away with whatever needed it, and clear every filter at once', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games?player=hextide&vs=quietlake&side=x&clock=match`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        fireEvent.click(screen.getByRole(`button`, { name: `Remove hextide` }));
        expect(window.location.search).toBe(`?clock=match`);
        await waitFor(() => {
            expect(document.activeElement?.getAttribute(`aria-label`)).toBe(`Remove match clock`);
        });
        fireEvent.click(screen.getByRole(`button`, { name: `Clear filters` }));
        expect(window.location.pathname + window.location.search).toBe(`/games`);
        expect(screen.queryByRole(`group`, { name: `Active filters` })).toBe(null);
    });

    it('head two players\' meetings with three figures and the split by side', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 41, record }));
        open(`/games?player=HexTide&vs=quietlake`);
        const head = await screen.findByRole(`heading`, { level: 2, name: /against/u });
        expect(head.textContent).toBe(`hextideBOT against quietlakeBOT`);
        const section = head.closest(`section`) as HTMLElement;
        expect([...section.querySelectorAll(`li`)].map((item) => item.textContent)).toEqual([`24hextide won`, `15quietlake won`, `2No winner`]);
        expect(within(section).getByText(`41 games; hextide won 14 and lost 6 as x, and won 10 and lost 9 as o.`)).toBeTruthy();
    });

    it('say under two players\' meetings how many voided games their figures leave out', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 43, record: { ...record, voided: 2 } }));
        open(`/games?player=hextide&vs=quietlake`);
        const head = await screen.findByRole(`heading`, { level: 2, name: /against/u });
        const section = head.closest(`section`) as HTMLElement;
        expect(section.querySelector(`.games-h2h-split`)?.textContent).toBe(`41 games; hextide won 14 and lost 6 as x, and won 10 and lost 9 as o. 2 voided games are left out.`);
    });

    it('name the one of two names no player holds', async () => {
        const fetch = serve((search) => (search === `player=hextide` ? { games: [game(0)], page: 1, pages: 1, total: 1 } : 404));
        open(`/games?player=hextide&vs=nobody`);
        expect(await screen.findByRole(`heading`, { name: `No player named nobody` })).toBeTruthy();
        expect(reads(fetch)).toEqual([`/api/games/finished?player=hextide&vs=nobody`, `/api/games/finished?player=hextide`]);
        expect(screen.getByRole(`link`, { name: `All games of hextide` }).getAttribute(`href`)).toBe(`/games?player=hextide`);
    });

    it('clear every filter when the first of two names is the unknown one', async () => {
        serve(() => 404);
        open(`/games?player=nobody&vs=hextide&reason=timeout`);
        expect(await screen.findByRole(`heading`, { name: `No player named nobody` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Clear filters` }).getAttribute(`href`)).toBe(`/games`);
    });

    it('greet day one with the way to a live game and to a bot of your own', async () => {
        serve(() => ({ games: [], page: 1, pages: 0, total: 0 }));
        open(`/games`);
        expect(await screen.findByRole(`heading`, { name: `No finished games yet` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Watch a live game` }).getAttribute(`href`)).toBe(`/games/live`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('name the filters nothing matches, and offer to clear them', async () => {
        serve(() => ({ games: [], page: 1, pages: 0, total: 0, record: { ...record, games: 0, won: 0, lost: 0, undecided: 0 } }));
        open(`/games?player=hextide&reason=timeout&opening=1`);
        expect(await screen.findByRole(`heading`, { name: `No games match these filters` })).toBeTruthy();
        expect(screen.getByText(`No finished game matches hextide, on time, origin only.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Clear filters` })).toBeTruthy();
    });

    it('say where the page stands, link every page between Previous and Next, and take the keyboard to the page turned to', async () => {
        serve((search) => {
            const page = Number(new URLSearchParams(search).get(`page`) ?? `1`);
            return { games: [game(page * 20)], page, pages: 7, total: 134 };
        });
        open(`/games?page=3`);
        await screen.findByText(`Page 3 of 7; 134 games`);
        const nav = screen.getByRole(`navigation`, { name: `Pages` });
        expect(within(nav).getAllByRole(`link`).map((link) => link.textContent)).toEqual([`Previous`, `1`, `2`, `3`, `4`, `5`, `6`, `7`, `Next`]);
        expect(within(nav).getByRole(`link`, { name: `Page 3` }).getAttribute(`aria-current`)).toBe(`page`);
        expect(within(nav).getByRole(`link`, { name: `Next` }).getAttribute(`href`)).toBe(`/games?page=4`);
        fireEvent.click(within(nav).getByRole(`link`, { name: `Page 5` }));
        expect(window.location.search).toBe(`?page=5`);
        await screen.findByText(`Page 5 of 7; 134 games`);
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`list`, { name: `Games, page 5` }));
        });
        fireEvent.click(within(screen.getByRole(`navigation`, { name: `Pages` })).getByRole(`link`, { name: `Page 1` }));
        expect(window.location.pathname + window.location.search).toBe(`/games`);
        await screen.findByText(`Page 1 of 7; 134 games`);
        const first = screen.getByRole(`navigation`, { name: `Pages` });
        expect(within(first).queryByRole(`link`, { name: `Previous` })).toBe(null);
        expect(within(first).getByText(`Previous`).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('end at the last page, Next standing without a link, and take a page past it there', async () => {
        serve((search) => {
            const page = Number(new URLSearchParams(search).get(`page`) ?? `1`);
            return { games: page > 3 ? [] : [game(page * 20)], page, pages: 3, total: 55 };
        });
        open(`/games?clock=turn&page=9`);
        await screen.findByText(`Page 3 of 3; 55 games`);
        expect(window.location.search).toBe(`?clock=turn&page=3`);
        expect(within(screen.getByRole(`navigation`, { name: `Pages` })).queryByRole(`link`, { name: `Next` })).toBe(null);
    });

    it('say past 200 games that an earlier date reaches older ones, and open Before in Filters', async () => {
        serve(() => ({ games: Array.from({ length: 20 }, (_, index) => game(index)), page: 10, pages: 10, total: 1234 }));
        open(`/games?player=hextide&page=10`);
        expect(await screen.findByText(`Showing the newest 200 of 1,234; pick an earlier date in Filters for older games.`)).toBeTruthy();
        expect(screen.getByText(`Page 10 of 10; 1,234 games`)).toBeTruthy();
        expect(screen.queryByLabelText(`Before`)).toBe(null);
        fireEvent.click(screen.getByRole(`button`, { name: `Pick a date` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByLabelText(`Before`));
        });
        expect(screen.getByRole(`button`, { name: /^Filters/u }).getAttribute(`aria-expanded`)).toBe(`true`);
        fireEvent.change(screen.getByLabelText(`Before`), { target: { value: `2026-09-01` } });
        expect(window.location.search).toBe(`?player=hextide&before=2026-09-01`);
    });

    it('tidy an address the list cannot take, in place', async () => {
        serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games?vs=quietlake&clock=blitz&reason=timeout`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(window.location.search).toBe(`?reason=timeout`);
    });

    it('offer a retry when the games do not load', async () => {
        serve(() => 500);
        open(`/games`);
        expect(await screen.findByRole(`heading`, { name: `The games did not load` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Try again` })).toBeTruthy();
    });

    it('follow the address when Back returns to an earlier filter', async () => {
        const fetch = serve(() => ({ games: [game(0)], page: 1, pages: 1, total: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        const panel = openFilters();
        act(() => {
            navigate(`/games?clock=unlimited`);
        });
        expect(within(panel).getByLabelText<HTMLSelectElement>(`Clock`).value).toBe(`unlimited`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?clock=unlimited`);
        });
    });
});
