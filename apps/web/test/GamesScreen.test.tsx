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

const record = { games: 41, won: 24, lost: 15, undecided: 2, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };

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
        serve(() => ({ games: [game(0), game(1, { winner: null, reason: `aborted`, openingPlies: 1, turns: 1, timeControl: { mode: `unlimited` } })], next: null, previous: null, page: 1 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        expect(rows.map((row) => row.getAttribute(`href`))).toEqual([`/game/g-0`, `/game/g-1`]);
        const [won, aborted] = rows as [HTMLElement, HTMLElement];
        expect(won.textContent).toBe(`hextideBOT1712vsquietlakeBOT1690?hextide won with six in a rowturn clock 10 s5 stones38 turns3 h ago`);
        expect(aborted.textContent).toContain(`No winner; the game was aborted`);
        expect(aborted.textContent).toContain(`unlimitedOrigin only1 turn`);
        expect(screen.getByText(`Newest first; guest games are not kept, so they never show here.`)).toBeTruthy();
        expect(screen.getByText(`Page 1`)).toBeTruthy();
    });

    it('keep a voided game in the list, tagged voided beside its result', async () => {
        serve(() => ({ games: [game(0, { voided: true, rated: false }), game(1)], next: null, previous: null, page: 1 }));
        open(`/games`);
        const rows = await screen.findAllByRole(`link`, { name: /hextide/u });
        const [voided, kept] = rows as [HTMLElement, HTMLElement];
        expect(voided.querySelector(`.game-row-result`)?.textContent).toBe(`hextide won with six in a rowvoided`);
        expect(voided.querySelector(`.game-row-result .tag`)?.textContent).toBe(`voided`);
        expect(kept.querySelector(`.tag`)).toBe(null);
    });

    it('keep Against, Result, and Side off until a player is named, and hold every filter in the address', async () => {
        const fetch = serve(() => ({ games: [game(0)], next: null, previous: null, page: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        for (const name of [`Against`, `Result`, `Side`]) expect(screen.getByLabelText<HTMLInputElement>(name).disabled).toBe(true);
        const player = screen.getByLabelText(`Player`);
        fireEvent.change(player, { target: { value: `hextide` } });
        expect(window.location.search).toBe(``);
        fireEvent.keyDown(player, { key: `Enter` });
        expect(window.location.search).toBe(`?player=hextide`);
        await waitFor(() => {
            expect(screen.getByLabelText<HTMLSelectElement>(`Side`).disabled).toBe(false);
        });
        fireEvent.change(screen.getByLabelText(`Clock`), { target: { value: `turn` } });
        fireEvent.change(screen.getByLabelText(`Side`), { target: { value: `o` } });
        expect(window.location.search).toBe(`?player=hextide&side=o&clock=turn`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?player=hextide&side=o&clock=turn`);
        });
        const chips = screen.getByRole(`group`, { name: `Active filters` });
        expect(within(chips).getAllByRole(`button`).map((chip) => chip.getAttribute(`aria-label`) ?? chip.textContent)).toEqual([
            `Remove hextide`,
            `Remove as o`,
            `Remove turn clock`,
            `Clear filters`,
        ]);
    });

    it('take a chip away with whatever needed it, and clear every filter at once', async () => {
        serve(() => ({ games: [game(0)], next: null, previous: null, page: 1 }));
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
        serve(() => ({ games: [game(0)], next: null, previous: null, page: 1, record }));
        open(`/games?player=HexTide&vs=quietlake`);
        const head = await screen.findByRole(`heading`, { level: 2, name: /against/u });
        expect(head.textContent).toBe(`hextideBOT against quietlakeBOT`);
        const section = head.closest(`section`) as HTMLElement;
        expect([...section.querySelectorAll(`li`)].map((item) => item.textContent)).toEqual([`24hextide won`, `15quietlake won`, `2No winner`]);
        expect(within(section).getByText(`41 games; hextide won 14 and lost 6 as x, and won 10 and lost 9 as o.`)).toBeTruthy();
    });

    it('name the one of two names no player holds', async () => {
        const fetch = serve((search) => (search === `player=hextide` ? { games: [game(0)], next: null, previous: null, page: 1 } : 404));
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
        serve(() => ({ games: [], next: null, previous: null, page: 1 }));
        open(`/games`);
        expect(await screen.findByRole(`heading`, { name: `No finished games yet` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Watch a live game` }).getAttribute(`href`)).toBe(`/games/live`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('name the filters nothing matches, and offer to clear them', async () => {
        serve(() => ({ games: [], next: null, previous: null, page: 1, record: { ...record, games: 0, won: 0, lost: 0, undecided: 0 } }));
        open(`/games?player=hextide&reason=timeout&opening=1`);
        expect(await screen.findByRole(`heading`, { name: `No games match these filters` })).toBeTruthy();
        expect(screen.getByText(`No finished game matches hextide, on time, origin only.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Clear filters` })).toBeTruthy();
    });

    it('page on with Older and back with Newer, the way it came', async () => {
        serve((search) => ({ games: [game(search === `` ? 0 : 20)], next: search === `` ? `2.40` : null, previous: null, page: search === `` ? 1 : 2 }));
        open(`/games`);
        await screen.findByText(`Page 1`);
        expect(screen.getByRole<HTMLButtonElement>(`button`, { name: `Newer` }).disabled).toBe(true);
        fireEvent.click(screen.getByRole(`button`, { name: `Older` }));
        expect(window.location.search).toBe(`?cursor=2.40`);
        await screen.findByText(`Page 2`);
        expect(screen.getByRole<HTMLButtonElement>(`button`, { name: `Older` }).disabled).toBe(true);
        // The page turned to takes the keyboard, where the window has scrolled.
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`list`, { name: `Games, page 2` }));
        });
        fireEvent.click(screen.getByRole(`button`, { name: `Newer` }));
        expect(window.location.pathname + window.location.search).toBe(`/games`);
        await screen.findByText(`Page 1`);
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByRole(`list`, { name: `Games, page 1` }));
        });
    });

    it('step back from a linked tenth page to the ninth', async () => {
        const pages: Record<string, FinishedGamesPage> = {
            'cursor=10.40': { games: [game(180)], next: null, previous: `9.61`, page: 10 },
            'cursor=9.61': { games: [game(160)], next: `10.40`, previous: `8.82`, page: 9 },
        };
        serve((search) => pages[search] ?? 404);
        open(`/games?cursor=10.40`);
        await screen.findByText(`Page 10`);
        fireEvent.click(screen.getByRole(`button`, { name: `Newer` }));
        expect(window.location.search).toBe(`?cursor=9.61`);
        await screen.findByText(`Page 9`);
    });

    it('say at the tenth page that a Before date reaches older games, and open Before', async () => {
        serve(() => ({ games: Array.from({ length: 20 }, (_, index) => game(index)), next: null, previous: null, page: 10 }));
        open(`/games?player=hextide&cursor=10.400`);
        expect(await screen.findByText(`The newest 200 games for these filters; pick a Before date to reach older games.`)).toBeTruthy();
        expect(screen.queryByLabelText(`Before`)).toBe(null);
        fireEvent.click(screen.getByRole(`button`, { name: `Pick a date` }));
        await waitFor(() => {
            expect(document.activeElement).toBe(screen.getByLabelText(`Before`));
        });
        expect(screen.getByRole(`button`, { name: `More filters` }).getAttribute(`aria-expanded`)).toBe(`true`);
        fireEvent.change(screen.getByLabelText(`Before`), { target: { value: `2026-09-01` } });
        expect(window.location.search).toBe(`?player=hextide&before=2026-09-01`);
    });

    it('tidy an address the list cannot take, in place', async () => {
        serve(() => ({ games: [game(0)], next: null, previous: null, page: 1 }));
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
        const fetch = serve(() => ({ games: [game(0)], next: null, previous: null, page: 1 }));
        open(`/games`);
        await screen.findAllByRole(`link`, { name: /hextide/u });
        act(() => {
            navigate(`/games?clock=unlimited`);
        });
        expect(screen.getByLabelText<HTMLSelectElement>(`Clock`).value).toBe(`unlimited`);
        await waitFor(() => {
            expect(reads(fetch).at(-1)).toBe(`/api/games/finished?clock=unlimited`);
        });
    });
});
