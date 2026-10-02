// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onlyLegal } from './legal-deploy';
import type { GameSnapshot } from '@hexo-arena/contract';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';
import { meStore } from '../src/me';
import { GameScreen } from '../src/screens/GameScreen';
import { FakeEventSource, stubEventSource } from './event-source';

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

const players = {
    x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` as const },
    o: { name: `quinn`, rating: 1503, provisional: false, kind: `user` as const },
};

const runningSnapshot = {
    gameId: `g-run`,
    you: `o`,
    players,
    openingPlies: 3,
    board: {
        cells: [
            { x: 0, y: 0, side: `x` as const },
            { x: 1, y: -1, side: `o` as const },
            { x: 0, y: 1, side: `o` as const },
        ],
    },
    timeControl: { mode: `turn`, turnTimeMs: 50_000 },
    status: `in-progress`,
    toMove: `o`,
    clock: { mode: `turn`, remainingTurnMs: 47_000 },
} as GameSnapshot;

const finishedSnapshot = {
    gameId: `g-end`,
    you: `o`,
    players,
    openingPlies: 3,
    board: { cells: finishedCells },
    timeControl: { mode: `turn`, turnTimeMs: 50_000 },
    status: `finished`,
    winner: `x`,
    reason: `six-in-a-row`,
    voided: false,
} as GameSnapshot;

// A game before its first turn: the opening alone on the board.
const freshSnapshot = { ...runningSnapshot, gameId: `g-new`, toMove: `x` } as GameSnapshot;

const records: Record<string, unknown> = {
    hextide: { name: `hextide`, kind: `bot`, rating: 1690, deviation: 48, provisional: false, rank: 2, games: 120, won: 70, lost: 48, undecided: 2, asX: { games: 60, won: 36 }, asO: { games: 60, won: 34 }, forfeits: { disconnect: 0, terminated: 0 }, opponents: [], firstGameAt: `2026-09-01T10:00:00Z`, lastGameAt: `2026-10-01T10:00:00Z`, placings: [] },
    quinn: { name: `quinn`, kind: `human`, rating: 1503, deviation: 96, provisional: true, rank: null, games: 14, won: 6, lost: 8, undecided: 0, asX: { games: 7, won: 3 }, asO: { games: 7, won: 3 }, forfeits: { disconnect: 0, terminated: 0 }, opponents: [], firstGameAt: `2026-09-20T10:00:00Z`, lastGameAt: `2026-10-01T10:00:00Z` },
};

// One finished game of a player's history, against pebble, won or lost from their seat.
function past(name: string, index: number, won: boolean) {
    const seat = { name, rating: 1500, provisional: false, kind: name === `quinn` ? `user` : `bot` };
    const other = { name: `pebble`, rating: 1500, provisional: false, kind: `bot` };
    return { gameId: `g-${name}-${String(index)}`, players: { x: seat, o: other }, winner: won ? `x` : `o`, reason: `six-in-a-row`, timeControl: { mode: `unlimited` }, openingPlies: 1, turns: 20, finishedAt: `2026-10-01T10:00:00Z`, rated: true, voided: false };
}

// The game, both players' records and histories, and their meetings, as the rundown reads them.
function stubRundown(snapshot: GameSnapshot, meetings = { games: 41, won: 24, lost: 15, undecided: 2, voided: 0, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } }): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            const [path = ``, search = ``] = url.split(`?`);
            const params = new URLSearchParams(search);
            if (path.startsWith(`/api/players/`)) {
                const record = records[decodeURIComponent(path.slice(`/api/players/`.length))];
                return Promise.resolve(record === undefined ? new Response(null, { status: 404 }) : new Response(JSON.stringify(record)));
            }
            if (path === `/api/games/finished`) {
                const player = params.get(`player`) ?? ``;
                if (params.has(`vs`)) return Promise.resolve(new Response(JSON.stringify({ games: [], page: 1, pages: 3, total: 41, record: meetings })));
                const results = player === `hextide` ? [true, true, false, true, false, true] : [false, true];
                return Promise.resolve(new Response(JSON.stringify({ games: results.map((won, index) => past(player, index, won)), page: 1, pages: 1, total: results.length })));
            }
            return Promise.resolve(new Response(JSON.stringify(snapshot)));
        }),
    );
    stubEventSource(snapshot);
}

function stubGame(snapshot: GameSnapshot, status = 200): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(snapshot), { status }))),
    );
    stubEventSource(status === 200 ? snapshot : null);
}

// The same games as a watcher reads them: no side of their own.
function watched(snapshot: GameSnapshot): GameSnapshot {
    const { you: _seat, ...rest } = snapshot;
    return rest;
}

// The m listener registers in an effect that can land after the first
// paint a test waits on, so the key is pressed until the drawer answers.
async function openWithM(): Promise<void> {
    await waitFor(() => {
        fireEvent.keyDown(window, { key: `m` });
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(false);
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState(null, ``, `/`);
    boardSettingsStore.update(defaultBoardSettings);
});

describe('GameScreen', () => {
    it('lay the board, both players, and the turn over the stage while running', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { name: `hextide vs you` })).toBeTruthy();
        expect(document.querySelector(`.hud-top-left .hud-name`)?.textContent).toBe(`hextideBOT`);
        expect(document.querySelector(`.hud-bottom-left .hud-name`)?.textContent).toBe(`you`);
        expect(document.querySelector(`.hud-bottom-center .hud-turn`)?.textContent).toBe(`Your turn`);
        expect(document.querySelector(`.hud-bottom-center .hud-hint`)?.textContent).toBe(`2 stones`);
        expect(document.querySelector(`.board-control`)?.getAttribute(`aria-label`)).toBe(`Board, your turn: 2 stones`);
        expect(document.querySelector(`.board-control`)?.getAttribute(`tabindex`)).toBe(`0`);
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs quinn - HeXO Arena`);
        });
        expect(document.querySelector(`meta[name="description"]`)?.getAttribute(`content`)).toBe(`Live; quinn to move; turn clock 50 s`);
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
        await openWithM();
        expect(document.querySelectorAll(`.feed .feed-line`)).toHaveLength(1);
        // The opening line keeps each turn's stones together: the origin, then one pair.
        expect([...document.querySelectorAll(`.feed .feed-group`)].map((group) => group.textContent)).toEqual([`x: (0,0)`, `o: (1,-1) (0,1)`]);
        // The opening's label shows its turn span and reads it out in words,
        // in the feed and in the peek that repeats the last line.
        for (const label of [`.feed-n`, `.peek-line`]) {
            expect(document.querySelector(`${label} [aria-hidden="true"]`)?.textContent).toBe(`op 0-1`);
            expect(document.querySelector(`${label} .sr-only`)?.textContent).toBe(`opening, turns 0 to 1,`);
        }
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByRole(`button`, { name: `Resign` })).toBeTruthy();
        const exit = [...document.querySelectorAll(`#drawer-panel-game a`)];
        expect(exit.map((link) => [link.textContent, link.getAttribute(`href`)])).toEqual([[`Home`, `/`]]);
        expect(document.querySelector(`#drawer-body .drawer-foot`)).toBeTruthy();
        fireEvent.keyDown(screen.getByRole(`tab`, { name: `Game` }), { key: `Escape` });
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
    });

    it('tell a seated player on a running clock that leaving does not resign, and no one else', async () => {
        const note = `Leaving does not resign; your clock keeps running.`;
        for (const [snapshot, shown] of [
            [runningSnapshot, true],
            [{ ...runningSnapshot, clock: { mode: `unlimited` } } as GameSnapshot, false],
            [watched(runningSnapshot), false],
        ] as const) {
            stubGame(snapshot);
            render(<GameScreen gameId="g-run" />);
            await screen.findByRole(`heading`, { level: 1 });
            await openWithM();
            fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
            expect(screen.queryByText(note) !== null).toBe(shown);
            cleanup();
        }
    });

    it('name the clock in the facts, and leave the row out once the clock is gone', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { level: 1 });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByText(`Turn clock`, { selector: `.facts dd` })).toBeTruthy();
        cleanup();
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect([...document.querySelectorAll(`.facts dt`)].map((term) => term.textContent)).toEqual([`Opening`, `Your side`, `Result`]);
    });

    it('say on the Game tab what the opening placed before the first turn', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { level: 1 });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByText(`Opening`, { selector: `.facts dt` }).nextElementSibling?.textContent).toBe(`The origin and 2 random stones near it, placed before the first turn`);
    });

    it('offer a retry and the way home when the game does not load', async () => {
        stubGame(runningSnapshot, 500);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `The game did not load` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Try again` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Home` }).getAttribute(`href`)).toBe(`/`);
    });

    it('hold the retry of a game whose read was rate-limited for its wait', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `5` } })),
            ),
        );
        stubEventSource(null);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `The game did not load` })).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`.stage-message .sr-only`)?.textContent).toBe(`Too many tries; try again in 5 s`);
        });
        expect(screen.getByRole(`button`, { name: `Try again` }).getAttribute(`aria-disabled`)).toBe(`true`);
    });

    it('open nothing on a held Try again, and count down again when the reopen after the wait is refused too', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `5` } })),
            ),
        );
        stubEventSource(null);
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            render(<GameScreen gameId="g-run" />);
            const spoken = () => document.querySelector(`.stage-message .sr-only`)?.textContent;
            await waitFor(() => {
                expect(spoken()).toBe(`Too many tries; try again in 5 s`);
            });
            const opened = FakeEventSource.opened.length;
            fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_000);
            });
            expect(FakeEventSource.opened.length).toBe(opened);
            await act(async () => {
                await vi.advanceTimersByTimeAsync(4_500);
            });
            expect(FakeEventSource.opened.length).toBe(opened + 1);
            await waitFor(() => {
                expect(spoken()).toBe(`Too many tries; try again in 5 s`);
            });
            expect(screen.getByRole(`button`, { name: `Try again` }).getAttribute(`aria-disabled`)).toBe(`true`);
        } finally {
            vi.useRealTimers();
        }
    });

    it(`try again at once when Try again is pressed after the wait, before the stage's own reopen`, async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `1` } })),
            ),
        );
        stubEventSource(null);
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
            render(<GameScreen gameId="g-run" />);
            await waitFor(() => {
                expect(document.querySelector(`.stage-message .sr-only`)?.textContent).toBe(`Too many tries; try again in 1 s`);
            });
            const opened = FakeEventSource.opened.length;
            await act(async () => {
                await vi.advanceTimersByTimeAsync(1_200);
            });
            fireEvent.click(screen.getByRole(`button`, { name: `Try again` }));
            await act(async () => {});
            expect(FakeEventSource.opened.length).toBe(opened + 1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('count the wait of a rate-limited turn down in its note, then give the hint back', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((_url: string, init?: RequestInit) =>
                Promise.resolve(
                    init?.method === `POST`
                        ? new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `3` } })
                        : new Response(JSON.stringify(runningSnapshot), { status: 200 }),
                ),
            ),
        );
        stubEventSource(runningSnapshot);
        vi.useFakeTimers({ toFake: [`setInterval`, `clearInterval`, `Date`] });
        try {
            render(<GameScreen gameId="g-run" />);
            await screen.findByText(`Your turn`);
            const control = document.querySelector(`.board-control`) as HTMLElement;
            fireEvent.keyDown(control, { key: `ArrowRight` });
            fireEvent.keyDown(control, { key: `Enter` });
            fireEvent.keyDown(control, { key: `ArrowRight` });
            fireEvent.keyDown(control, { key: `Enter` });
            const shown = () => document.querySelector(`.hud-note [aria-hidden="true"]`)?.textContent;
            await waitFor(() => {
                expect(shown()).toBe(`Too many tries; try again in 3 s`);
            });
            expect(document.querySelector(`.hud-note .sr-only`)?.textContent).toBe(`Too many tries; try again in 3 s`);
            await act(async () => {});
            act(() => {
                vi.advanceTimersByTime(1_000);
            });
            expect(shown()).toBe(`Too many tries; try again in 2 s`);
            fireEvent.click(document.querySelector(`polygon.cell[data-x="0"][data-y="0"]`) as SVGElement);
            expect(document.querySelector(`.hud-note`)?.textContent).toBe(`That cell is taken`);
            fireEvent.keyDown(control, { key: `Escape` });
            // The wait comes back saying the time it has left, not the time it began with.
            expect(document.querySelector(`.hud-note .sr-only`)?.textContent).toBe(`Too many tries; try again in 2 s`);
            act(() => {
                vi.advanceTimersByTime(2_000);
            });
            expect(document.querySelector(`.hud-note`)).toBe(null);
        } finally {
            vi.useRealTimers();
        }
    });

    it('freeze into the finished state with the result, the win line, and the record open', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` })).toBeTruthy();
        expect(document.querySelector(`polyline.win-line`)).toBeTruthy();
        // The exit leads home; the chip under the board holds the replay and the result.
        expect(screen.getAllByRole(`link`, { name: `Home` }).map((link) => link.getAttribute(`href`))).toEqual([`/`]);
        expect(document.querySelector(`.hud-bottom-center [role="slider"]`)?.getAttribute(`aria-valuetext`)).toBe(`Turn 5 of 5`);
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        expect(document.querySelector(`.board-control`)?.getAttribute(`role`)).toBe(`group`);
        // The phone sheet's peek carries the result only while the open sheet covers the chip.
        expect(document.querySelector(`.peek-line`)?.textContent).not.toBe(`hextide won with six in a row`);
        await openWithM();
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`hextide won with six in a row`);
        fireEvent.keyDown(window, { key: `m` });
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs quinn - HeXO Arena`);
        });
        expect(document.querySelector(`meta[name="description"]`)?.getAttribute(`content`)).toBe(`hextide won with six in a row`);
    });

    it('show the board keys on the game tab only while the game runs', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(document.querySelector(`.game-facts kbd`)).toBeTruthy();
        cleanup();
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(document.querySelector(`.game-facts .facts`)).toBeTruthy();
        expect(document.querySelector(`.game-facts kbd`)).toBe(null);
    });

    it('state a finished result once on the game tab, in its row and not the peek', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`hextide won with six in a row`);
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByText(`hextide won with six in a row`, { selector: `.facts dd` })).toBeTruthy();
        // A replay's peek holds its steps, so the Game tab leaves it the steps alone.
        expect(document.querySelector(`.peek-line`)).toBe(null);
        expect(document.querySelector(`.peek-scrub [role="slider"]`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`tab`, { name: `Moves` }));
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`hextide won with six in a row`);
    });

    it('tag a voided game beside its result and tell a watcher it is unrated because the operator voided it', async () => {
        if (finishedSnapshot.status !== `finished`) throw new Error(`the finished snapshot is not finished`);
        stubGame(watched({ ...finishedSnapshot, voided: true }));
        render(<GameScreen gameId="g-end" />);
        const result = await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        expect(result.closest(`.hud-replay-line`)?.querySelector(`.tag`)?.textContent).toBe(`voided`);
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        const rated = screen.getByText(`Rated`, { selector: `.facts dt` });
        expect(rated.nextElementSibling?.textContent).toBe(`No, the operator voided it`);
    });

    it('foot the drawer under either tab with the standing links, then the legal ones, each opening a new tab', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        for (const tab of [`Moves`, `Game`]) {
            fireEvent.click(screen.getByRole(`tab`, { name: tab }));
            const links = [...document.querySelectorAll(`#drawer-body .drawer-foot a`)];
            expect(links.map((link) => [link.getAttribute(`aria-label`), link.getAttribute(`href`), link.getAttribute(`target`)])).toEqual([
                [`Tournaments, opens in a new tab`, `/tournaments`, `_blank`],
                [`Build a bot, opens in a new tab`, `/connect`, `_blank`],
                [`Credits, opens in a new tab`, `/credits`, `_blank`],
                [`Bot API, opens in a new tab`, `https://github.com/TimmyBurn2/Hexo-Bot-Api`, `_blank`],
                [`Impressum / Legal notice, opens in a new tab`, `/legal/imprint`, `_blank`],
                [`Privacy, opens in a new tab`, `/legal/privacy`, `_blank`],
                [`Terms, opens in a new tab`, `/legal/terms`, `_blank`],
                [`Licenses, opens in a new tab`, `/third-party-licenses.txt`, `_blank`],
            ]);
            expect(links.every((link) => link.getAttribute(`rel`) === `noreferrer`)).toBe(true);
        }
    });

    it('foot the drawer with only the legal documents the deployment has', async () => {
        onlyLegal(`privacy`);
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        const legal = [...document.querySelectorAll(`#drawer-body .drawer-foot .legal-links a`)];
        expect(legal.map((link) => link.getAttribute(`href`))).toEqual([`/legal/privacy`, `/third-party-licenses.txt`]);
    });

    it('open the Game tab at its top, whatever the Moves tab had scrolled to', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        const moves = document.getElementById(`drawer-panel-moves`) as HTMLElement;
        moves.scrollTop = 55;
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect((document.getElementById(`drawer-panel-game`) as HTMLElement).scrollTop).toBe(0);
    });

    it('keep two tabs, Moves and Game, both reached by arrow keys either way', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        expect(screen.getAllByRole(`tab`).map((tab) => tab.textContent)).toEqual([`Moves`, `Game`]);
        const moves = screen.getByRole(`tab`, { name: `Moves` });
        fireEvent.keyDown(moves, { key: `ArrowRight` });
        expect(screen.getByRole(`tab`, { name: `Game` }).getAttribute(`aria-selected`)).toBe(`true`);
        expect(document.activeElement).toBe(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.keyDown(screen.getByRole(`tab`, { name: `Game` }), { key: `ArrowRight` });
        expect(moves.getAttribute(`aria-selected`)).toBe(`true`);
        fireEvent.keyDown(moves, { key: `ArrowLeft` });
        expect(screen.getByRole(`tab`, { name: `Game` }).getAttribute(`aria-selected`)).toBe(`true`);
        fireEvent.keyDown(screen.getByRole(`tab`, { name: `Game` }), { key: `ArrowLeft` });
        expect(document.activeElement).toBe(moves);
    });

    it('head the moves with the stone numbers switch, writing the one stored setting', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        const head = document.querySelector(`#drawer-panel-moves .moves-head`);
        expect(head?.nextElementSibling?.classList.contains(`feed`)).toBe(true);
        const frame = document.querySelector(`.board-frame`);
        expect(screen.getAllByRole(`switch`).map((toggle) => toggle.closest(`label`)?.textContent)).toEqual([`Stone numbers`]);
        fireEvent.click(screen.getByRole(`switch`, { name: `Stone numbers` }));
        expect(boardSettingsStore.read()).toEqual({ numbers: true, glare: true });
        expect(JSON.parse(window.localStorage.getItem(`hexo-arena.board-rendering.v1`) ?? `null`)).toEqual({ numbers: true, glare: true });
        expect(frame?.hasAttribute(`data-numbers`)).toBe(true);
    });

    it('offer no theme choice and no settings gear anywhere in a game', async () => {
        for (const snapshot of [runningSnapshot, finishedSnapshot, watched(runningSnapshot)]) {
            stubGame(snapshot);
            render(<GameScreen gameId="g-any" />);
            await screen.findByRole(`heading`, { level: 1 });
            await openWithM();
            for (const tab of [`Moves`, `Game`]) {
                fireEvent.click(screen.getByRole(`tab`, { name: tab }));
                expect(screen.queryAllByRole(`radio`)).toEqual([]);
                expect(screen.queryByRole(`button`, { name: `Settings` })).toBe(null);
            }
            cleanup();
        }
    });

    it('not-found for an unknown game', async () => {
        stubGame(runningSnapshot, 404);
        render(<GameScreen gameId="g-x" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `No such game` })).toBeTruthy();
        expect(screen.getByText(`That game does not exist; guest games are gone once their session ends.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Home` }).getAttribute(`href`)).toBe(`/`);
        await waitFor(() => {
            expect(document.title).toBe(`Not found - HeXO Arena`);
        });
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
        stubEventSource(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        fireEvent.click(screen.getByRole(`button`, { name: `Game panel` }));
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign` }));
        expect(screen.getByRole(`button`, { name: `Resign and lose` })).toBeTruthy();
        expect(posts).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Resign and lose` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/games/g-run/resign`]);
        });
        expect(await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` })).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByRole(`tab`, { name: `Moves` }).getAttribute(`aria-selected`)).toBe(`true`);
        });
    });

    it('say so when a resign does not land and keep the button live', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((_url: string, init?: RequestInit) =>
                Promise.resolve(
                    init?.method === `POST`
                        ? new Response(`{}`, { status: 502 })
                        : new Response(JSON.stringify(runningSnapshot), { status: 200 }),
                ),
            ),
        );
        stubEventSource(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign and lose` }));
        expect(await screen.findByRole(`alert`)).toHaveProperty(`textContent`, `The resignation was not sent; try again`);
        expect(screen.getByRole(`button`, { name: `Resign` })).toBeTruthy();
    });

    it('hold Resign while its request runs, keeping it focusable and sending once', async () => {
        const held: { answer: (() => void) | null } = { answer: null };
        const posts: string[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                if (init?.method !== `POST`) return Promise.resolve(new Response(JSON.stringify(runningSnapshot), { status: 200 }));
                posts.push(url);
                return new Promise<Response>((resolve) => {
                    held.answer = () => {
                        resolve(new Response(`{}`, { status: 502 }));
                    };
                });
            }),
        );
        stubEventSource(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign` }));
        const confirm = screen.getByRole(`button`, { name: `Resign and lose` });
        fireEvent.click(confirm);
        await waitFor(() => {
            expect(confirm.getAttribute(`aria-disabled`)).toBe(`true`);
        });
        expect(confirm.hasAttribute(`disabled`)).toBe(false);
        fireEvent.click(confirm);
        expect(posts).toHaveLength(1);
        act(() => {
            held.answer?.();
        });
        expect(await screen.findByRole(`alert`)).toHaveProperty(`textContent`, `The resignation was not sent; try again`);
        expect(posts).toHaveLength(1);
    });

    it('say the wait when a resign is rate-limited', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((_url: string, init?: RequestInit) =>
                Promise.resolve(
                    init?.method === `POST`
                        ? new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `3` } })
                        : new Response(JSON.stringify(runningSnapshot), { status: 200 }),
                ),
            ),
        );
        stubEventSource(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Resign and lose` }));
        await waitFor(() => {
            expect(document.querySelector(`#drawer-body [role="alert"] .sr-only`)?.textContent).toBe(`Too many tries; try again in 3 s`);
        });
        const resign = screen.getByRole(`button`, { name: `Resign` });
        expect(resign.getAttribute(`aria-disabled`)).toBe(`true`);
        expect(resign.hasAttribute(`disabled`)).toBe(false);
        fireEvent.click(resign);
        expect(screen.queryByRole(`button`, { name: `Resign and lose` })).toBe(null);
        const shown = () => document.querySelector(`#drawer-body [role="alert"] [aria-hidden="true"]`)?.textContent;
        await waitFor(
            () => {
                expect(shown()).toBe(`Too many tries; try again in 2 s`);
            },
            { timeout: 2_000 },
        );
        await waitFor(
            () => {
                expect(document.querySelector(`#drawer-body [role="alert"]`)).toBe(null);
            },
            { timeout: 3_000 },
        );
        expect(resign.getAttribute(`aria-disabled`)).toBe(null);
    });

    it('name the player in their own chip and mark a guest unrated', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(
                        JSON.stringify(url === `/api/me` ? { kind: `guest`, name: `Guest k3f9`, liveGames: [] } : runningSnapshot),
                    ),
                ),
            ),
        );
        stubEventSource(runningSnapshot);
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
        fireEvent.click(screen.getByRole(`button`, { name: `Game panel` }));
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(false);
        (document.querySelector(`.drawer-tab`) as HTMLElement).focus();
        fireEvent.click(document.querySelector(`.drawer-close`) as HTMLElement);
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        expect(document.activeElement).not.toBe(document.body);
    });

    it('keep the board and say so when the connection drops, then resync on the fresh snapshot', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        act(() => {
            FakeEventSource.latest().fail(false);
        });
        expect(await screen.findByText(`Connection lost; reconnecting`)).toBeTruthy();
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(3);
        const resynced = { ...runningSnapshot, board: { cells: finishedCells.slice(0, 5) }, toMove: `o` } as GameSnapshot;
        act(() => {
            FakeEventSource.latest().emit(`snapshot`, resynced);
        });
        expect(await screen.findByText(`Your turn`)).toBeTruthy();
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(5);
    });

    it('reopen a refused stream after a plain read, keeping the board', async () => {
        stubGame(runningSnapshot);
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        act(() => {
            FakeEventSource.latest().fail(true);
        });
        expect(await screen.findByText(`Connection lost; reconnecting`)).toBeTruthy();
        const before = FakeEventSource.opened.length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(2_100);
        });
        expect(FakeEventSource.opened.length).toBe(before + 1);
        await waitFor(() => {
            expect(screen.queryByText(`Connection lost; reconnecting`)).toBe(null);
        });
        vi.useRealTimers();
    });

    it('wait out the wait a rate-limited read names before reopening the stream', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn(() =>
                Promise.resolve(new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `5` } })),
            ),
        );
        stubEventSource(runningSnapshot);
        vi.useFakeTimers({ shouldAdvanceTime: true });
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        act(() => {
            FakeEventSource.latest().fail(true);
        });
        const before = FakeEventSource.opened.length;
        await act(async () => {
            await vi.advanceTimersByTimeAsync(4_900);
        });
        expect(FakeEventSource.opened.length).toBe(before);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(200);
        });
        expect(FakeEventSource.opened.length).toBe(before + 1);
        vi.useRealTimers();
    });

    it('apply turn events as they land and hold a turn the move answer already placed', async () => {
        const answered = {
            ...runningSnapshot,
            board: { cells: [...runningSnapshot.board.cells, { x: 3, y: 0, side: `o` }, { x: 4, y: 0, side: `o` }] },
            toMove: `x`,
        } as GameSnapshot;
        vi.stubGlobal(
            `fetch`,
            vi.fn(() => Promise.resolve(new Response(JSON.stringify(answered), { status: 200 }))),
        );
        stubEventSource(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByText(`Your turn`);
        const control = document.querySelector(`.board-control`) as HTMLElement;
        fireEvent.keyDown(control, { key: `ArrowRight` });
        fireEvent.keyDown(control, { key: `Enter` });
        fireEvent.keyDown(control, { key: `ArrowRight` });
        fireEvent.keyDown(control, { key: `Enter` });
        expect(await screen.findByText(`hextide is thinking`)).toBeTruthy();
        const stream = FakeEventSource.latest();
        act(() => {
            stream.emit(`turn`, { turn: 2, side: `o`, cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }], toMove: `x`, clock: { mode: `turn`, remainingTurnMs: 40_000 } });
        });
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(5);
        act(() => {
            stream.emit(`turn`, { turn: 3, side: `x`, cells: [{ x: -1, y: 0 }, { x: -2, y: 0 }], toMove: `o`, clock: { mode: `turn`, remainingTurnMs: 45_000 } });
        });
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(7);
        expect(await screen.findByText(`Your turn`)).toBeTruthy();
        act(() => {
            stream.emit(`finish`, { winner: `x`, reason: `timeout`, voided: false, clock: { mode: `turn`, remainingTurnMs: 0 } });
        });
        expect(await screen.findByText(`hextide won on time`, { selector: `.hud-result` })).toBeTruthy();
        expect(stream.readyState).toBe(FakeEventSource.CLOSED);
    });
});

describe('GameScreen for a watcher', () => {
    it('name both players on their chips and leave the board without selection or keys', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { name: `hextide vs quinn` })).toBeTruthy();
        expect(document.querySelector(`.hud-top-left .hud-name`)?.textContent).toBe(`quinn`);
        expect(document.querySelector(`.hud-bottom-left .hud-name`)?.textContent).toBe(`hextideBOT`);
        expect(document.querySelector(`.hud-bottom-center .hud-turn`)?.textContent).toBe(`quinn is thinking`);
        expect(document.querySelector(`.hud-bottom-center .tag`)?.textContent).toBe(`watching`);
        const control = document.querySelector(`.board-control`);
        expect(control?.getAttribute(`role`)).toBe(`group`);
        expect(control?.getAttribute(`tabindex`)).toBe(`0`);
        expect(control?.getAttribute(`aria-label`)).toBe(`Board, watching hextide vs quinn, quinn to move`);
        fireEvent.click(document.querySelector(`polygon.cell`) as Element);
        expect(document.querySelector(`.ring-pending`)).toBe(null);
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs quinn - HeXO Arena`);
        });
    });

    it('keep the record and facts in the drawer and drop the actions', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.queryByRole(`button`, { name: `Resign` })).toBe(null);
        expect(document.querySelector(`.game-facts .note`)?.textContent).toBe(`With the board focused, arrows scroll it; m opens this panel.`);
        expect(screen.getByText(`Yes`, { selector: `.facts dd` })).toBeTruthy();
        expect(document.querySelector(`.peek-row .hud-name`)?.textContent).toBe(`hextideBOT`);
    });

    it('read a refused stream as a busy one, calmly, while a plain read still answers', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        act(() => {
            FakeEventSource.latest().fail(true);
        });
        expect(await screen.findByText(`Many watching; the board catches up shortly`)).toBeTruthy();
        expect(screen.queryByText(`Connection lost; reconnecting`)).toBe(null);
    });

    it('mark a guest seat unrated and the game unrated in the facts', async () => {
        const guestGame = {
            ...watched(runningSnapshot),
            players: { ...players, o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` as const } },
        } as GameSnapshot;
        stubGame(guestGame);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs Guest k3f9` });
        expect(document.querySelector(`.hud-top-left .tag`)?.textContent).toBe(`unrated`);
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByText(`No, a guest is playing`, { selector: `.facts dd` })).toBeTruthy();
    });

    it('hold the frame a stepped-back watcher left as stones land, and leave the record closed at the finish', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        const frame = () => document.querySelector(`.board-camera .board-svg`)?.getAttribute(`viewBox`);
        const opened = frame();
        const stream = FakeEventSource.latest();
        act(() => {
            stream.emit(`turn`, { turn: 2, side: `o`, cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }], toMove: `x`, clock: { mode: `turn`, remainingTurnMs: 40_000 } });
        });
        // Following, the camera takes each new position.
        expect(frame()).not.toBe(opened);
        fireEvent.click(screen.getAllByRole(`button`, { name: `Go back a turn` })[0] as HTMLElement);
        const held = frame();
        act(() => {
            stream.emit(`turn`, { turn: 3, side: `x`, cells: [{ x: -1, y: 0 }, { x: -2, y: 0 }], toMove: `o`, clock: { mode: `turn`, remainingTurnMs: 45_000 } });
        });
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(3);
        expect(frame()).toBe(held);
        act(() => {
            stream.emit(`finish`, { winner: `x`, reason: `timeout`, voided: false, clock: { mode: `turn`, remainingTurnMs: 0 } });
        });
        expect(await screen.findByText(`hextide won on time`, { selector: `.hud-result` })).toBeTruthy();
        expect(frame()).toBe(held);
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        fireEvent.click(screen.getAllByRole(`button`, { name: `Go to the end` })[0] as HTMLElement);
        expect(document.querySelectorAll(`g.stone`)).toHaveLength(7);
        expect(frame()).not.toBe(held);
    });

    it('open the record at the finish of a game the watcher follows', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        act(() => {
            FakeEventSource.latest().emit(`finish`, { winner: `x`, reason: `timeout`, voided: false, clock: { mode: `turn`, remainingTurnMs: 0 } });
        });
        expect(await screen.findByText(`hextide won on time`, { selector: `.hud-result` })).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(false);
        });
    });

    it('tell a seated player when the operator voided the game', async () => {
        if (finishedSnapshot.status !== `finished`) throw new Error(`the finished snapshot is not finished`);
        stubGame({ ...finishedSnapshot, voided: true });
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.getByText(`Your side`, { selector: `.facts dt` }).nextElementSibling?.textContent).toBe(`o`);
        expect(screen.getByText(`Rated`, { selector: `.facts dt` }).nextElementSibling?.textContent).toBe(`No, the operator voided it`);
    });

    it('say on the Game tab how many voided games the two players\' record leaves out', async () => {
        const record = { games: 41, won: 24, lost: 15, undecided: 2, voided: 2, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.startsWith(`/api/games/finished`) ? { games: [], page: 1, pages: 3, total: 43, record } : watched(finishedSnapshot))))),
        );
        stubEventSource(watched(finishedSnapshot));
        render(<GameScreen gameId="g-end" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        const row = (await screen.findByRole(`link`, { name: `41 games` })).closest<HTMLElement>(`.facts-row`);
        expect(row?.querySelector(`dd`)?.textContent).toBe(`hextide won 24 and quinn 15 of their 41 games; 2 voided games are left out`);
    });

    it('lay a rundown above the board before the first turn: each player\'s rating and deviation, expected score, and last five results, and their head to head', async () => {
        stubRundown(watched(freshSnapshot));
        render(<GameScreen gameId="g-new" />);
        const card = await screen.findByRole(`region`, { name: `Rundown` });
        await within(card).findByText(`0.74`);
        const sides = [...card.querySelectorAll(`.rundown-side`)];
        expect(sides.map((side) => side.querySelector(`.rundown-name`)?.textContent)).toEqual([`hextideBOT`, `quinn`]);
        expect(sides.map((side) => side.querySelector(`.rundown-rating`)?.textContent)).toEqual([`1690`, `1503?`]);
        expect(sides.map((side) => side.querySelector(`.rundown-deviation`)?.textContent)).toEqual([`deviation 48`, `deviation 96`]);
        // Each side's E from the contract's function: the opponent's deviation is what counts.
        expect(sides.map((side) => side.querySelector(`.rundown-expected`)?.textContent)).toEqual([`Expected score0.74`, `Expected score0.26`]);
        expect(sides.map((side) => side.querySelector(`.rundown-form`)?.getAttribute(`aria-label`))).toEqual([`Last 5: won, won, lost, won, lost`, `Last 2: lost, won`]);
        expect(card.querySelector(`.rundown-meetings`)?.textContent).toBe(`hextide won 24 and quinn 15 of their 41 games`);
        expect(within(card).getByRole(`link`, { name: `41 games` }).getAttribute(`href`)).toBe(`/games?player=hextide&vs=quinn`);
        // The card keeps its own room above the position, which the camera leaves clear.
        expect(document.querySelector<HTMLElement>(`.board-host`)?.hasAttribute(`data-rundown`)).toBe(true);
    });

    it('take the rundown off the board at the first turn and keep it on the Game tab while the game runs', async () => {
        stubRundown(watched(freshSnapshot));
        render(<GameScreen gameId="g-new" />);
        await screen.findByRole(`region`, { name: `Rundown` });
        act(() => {
            FakeEventSource.latest().emit(`turn`, { turn: 2, side: `x`, cells: [{ x: 3, y: 3 }, { x: 4, y: 4 }], toMove: `o`, clock: { mode: `turn`, remainingTurnMs: 50_000 } });
        });
        await waitFor(() => {
            expect(document.querySelector(`.hud-rundown`)).toBe(null);
        });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        const card = within(document.getElementById(`drawer-panel-game`) as HTMLElement).getByRole(`region`, { name: `Rundown` });
        await within(card).findByText(`0.74`);
        expect(card.querySelector(`.rundown-meetings`)).toBe(null);
    });

    it('hide the rundown on request, leaving the board as it was', async () => {
        stubRundown(watched(freshSnapshot));
        render(<GameScreen gameId="g-new" />);
        const card = await screen.findByRole(`region`, { name: `Rundown` });
        fireEvent.click(within(card).getByRole(`button`, { name: `Hide the rundown` }));
        expect(screen.queryByRole(`region`, { name: `Rundown` })).toBe(null);
        expect(document.querySelector<HTMLElement>(`.board-host`)?.hasAttribute(`data-rundown`)).toBe(false);
    });

    it('lay no rundown over a game already under way, nor one that is over', async () => {
        stubRundown(watched({ ...runningSnapshot, board: { cells: [...runningSnapshot.board.cells, { x: 3, y: 3, side: `o` }, { x: 4, y: 4, side: `o` }] } }));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { level: 1 });
        expect(screen.queryByRole(`region`, { name: `Rundown` })).toBe(null);
        cleanup();
        stubRundown(watched(finishedSnapshot));
        render(<GameScreen gameId="g-end" />);
        await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.queryByRole(`region`, { name: `Rundown` })).toBe(null);
    });

    it('leave the expected scores out of a rundown with a guest, whose game is unrated', async () => {
        const guest = { ...freshSnapshot, players: { x: players.x, o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` } } } as GameSnapshot;
        stubRundown(watched(guest));
        render(<GameScreen gameId="g-new" />);
        const card = await screen.findByRole(`region`, { name: `Rundown` });
        await within(card).findByText(`deviation 48`);
        expect(card.querySelectorAll(`.rundown-expected`)).toHaveLength(0);
        expect(card.querySelector(`.rundown-meetings`)).toBe(null);
        expect(card.querySelectorAll(`.rundown-side`)[1]?.textContent).toContain(`unrated`);
    });

    it('lead from the Game tab to the two players\' games, with their record', async () => {
        const record = { games: 41, won: 24, lost: 15, undecided: 2, voided: 0, asX: { games: 21, won: 14, lost: 6 }, asO: { games: 20, won: 10, lost: 9 } };
        const reads: string[] = [];
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) => {
                reads.push(url);
                return Promise.resolve(new Response(JSON.stringify(url.startsWith(`/api/games/finished`) ? { games: [], page: 1, pages: 3, total: 41, record } : watched(finishedSnapshot))));
            }),
        );
        stubEventSource(watched(finishedSnapshot));
        render(<GameScreen gameId="g-end" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        const line = await screen.findByRole(`link`, { name: `41 games` });
        expect(line.getAttribute(`href`)).toBe(`/games?player=hextide&vs=quinn`);
        const row = line.closest<HTMLElement>(`.facts-row`);
        if (row === null) throw new Error(`the line stands in no facts row`);
        expect(row.querySelector(`dt`)?.textContent).toBe(`Head to head`);
        expect(row.querySelector(`dd`)?.textContent).toBe(`hextide won 24 and quinn 15 of their 41 games`);
        expect(within(row).getByRole(`link`, { name: `hextide` }).getAttribute(`href`)).toBe(`/bots/hextide`);
        expect(within(row).getByRole(`link`, { name: `quinn` }).getAttribute(`href`)).toBe(`/players/quinn`);
        expect(reads).toContain(`/api/games/finished?player=hextide&vs=quinn`);
    });

    it('name a tournament game\'s place on the Game tab, leading to its tournament', async () => {
        const tournamentGame = { ...watched(finishedSnapshot), tournament: { id: `t_autumnrobin1`, name: `Autumn round robin`, round: 4, game: 2 } } as GameSnapshot;
        stubGame(tournamentGame);
        render(<GameScreen gameId="g-end" />);
        await screen.findByRole(`heading`, { name: `hextide vs quinn` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        const line = await screen.findByRole(`link`, { name: `Autumn round robin, round 4, game 2 of 2` });
        expect(line.getAttribute(`href`)).toBe(`/tournaments/t_autumnrobin1`);
        expect(line.closest(`.facts-row`)?.querySelector(`dt`)?.textContent).toBe(`Tournament`);
    });

    it('leave the head-to-head out of a game a guest sits in, which is never kept', async () => {
        const guestGame = { ...watched(finishedSnapshot), players: { ...players, o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` as const } } } as GameSnapshot;
        stubGame(guestGame);
        render(<GameScreen gameId="g-end" />);
        await screen.findByRole(`heading`, { name: `hextide vs Guest k3f9` });
        await openWithM();
        fireEvent.click(screen.getByRole(`tab`, { name: `Game` }));
        expect(screen.queryByText(`Head to head`)).toBe(null);
        expect(vi.mocked(fetch).mock.calls.some(([url]) => typeof url === `string` && url.startsWith(`/api/games/finished`))).toBe(false);
    });

    it('name the winner in the result, never you', async () => {
        stubGame(watched(finishedSnapshot));
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` })).toBeTruthy();
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs quinn - HeXO Arena`);
        });
    });
});
