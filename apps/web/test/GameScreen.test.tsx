// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    o: { name: `tom`, rating: 1503, provisional: false, kind: `user` as const },
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
    status: `finished`,
    winner: `x`,
    reason: `six-in-a-row`,
} as GameSnapshot;

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
            expect(document.title).toBe(`hextide vs tom - HeXO Arena`);
        });
        expect(document.querySelector(`meta[name="description"]`)?.getAttribute(`content`)).toBe(`Live; tom to move; turn clock`);
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
        expect(exit.map((link) => [link.textContent, link.getAttribute(`href`)])).toEqual([[`Ladder`, `/`]]);
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

    it('offer a retry and the way to the ladder when the game does not load', async () => {
        stubGame(runningSnapshot, 500);
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `The game did not load` })).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Try again` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Ladder` }).getAttribute(`href`)).toBe(`/ladder`);
    });

    it('freeze into the finished state with the result, the win line, and the record open', async () => {
        stubGame(finishedSnapshot);
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` })).toBeTruthy();
        expect(document.querySelector(`polyline.win-line`)).toBeTruthy();
        // The exit and the result chip both lead to the ladder.
        expect(screen.getAllByRole(`link`, { name: `Ladder` }).map((link) => link.getAttribute(`href`))).toEqual([`/`, `/ladder`]);
        expect(document.querySelector(`#drawer-body`)?.hasAttribute(`hidden`)).toBe(true);
        expect(document.querySelector(`.board-control`)?.getAttribute(`role`)).toBe(`group`);
        // The phone sheet's peek carries the result only while the open sheet covers the chip.
        expect(document.querySelector(`.peek-line`)?.textContent).not.toBe(`hextide won with six in a row`);
        await openWithM();
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`hextide won with six in a row`);
        fireEvent.keyDown(window, { key: `m` });
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs tom - HeXO Arena`);
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
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`5 o: (5,0) (6,0)`);
        fireEvent.click(screen.getByRole(`tab`, { name: `Moves` }));
        expect(document.querySelector(`.peek-line`)?.textContent).toBe(`hextide won with six in a row`);
    });

    it('foot the drawer under either tab with the standing links, each opening a new tab', async () => {
        stubGame(runningSnapshot);
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs you` });
        await openWithM();
        for (const tab of [`Moves`, `Game`]) {
            fireEvent.click(screen.getByRole(`tab`, { name: tab }));
            const links = [...document.querySelectorAll(`#drawer-body .drawer-foot a`)];
            expect(links.map((link) => [link.getAttribute(`aria-label`), link.getAttribute(`href`), link.getAttribute(`target`)])).toEqual([
                [`Credits, opens in a new tab`, `/credits`, `_blank`],
                [`Bot API, opens in a new tab`, `https://github.com/TimmyBurn2/Hexo-Bot-Api`, `_blank`],
            ]);
            expect(links.every((link) => link.getAttribute(`rel`) === `noreferrer`)).toBe(true);
        }
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
            await screen.findByRole(`heading`);
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
        expect(screen.getByRole(`link`, { name: `Ladder` }).getAttribute(`href`)).toBe(`/ladder`);
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
            stream.emit(`finish`, { winner: `x`, reason: `timeout`, clock: { mode: `turn`, remainingTurnMs: 0 } });
        });
        expect(await screen.findByText(`hextide won on time`, { selector: `.hud-result` })).toBeTruthy();
        expect(stream.readyState).toBe(FakeEventSource.CLOSED);
    });
});

describe('GameScreen for a watcher', () => {
    it('name both players on their chips and leave the board without selection or keys', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        expect(await screen.findByRole(`heading`, { name: `hextide vs tom` })).toBeTruthy();
        expect(document.querySelector(`.hud-top-left .hud-name`)?.textContent).toBe(`tom`);
        expect(document.querySelector(`.hud-bottom-left .hud-name`)?.textContent).toBe(`hextideBOT`);
        expect(document.querySelector(`.hud-bottom-center .hud-turn`)?.textContent).toBe(`tom is thinking`);
        expect(document.querySelector(`.hud-bottom-center .tag`)?.textContent).toBe(`watching`);
        const control = document.querySelector(`.board-control`);
        expect(control?.getAttribute(`role`)).toBe(`group`);
        expect(control?.getAttribute(`tabindex`)).toBe(`0`);
        expect(control?.getAttribute(`aria-label`)).toBe(`Board, watching hextide vs tom, tom to move`);
        fireEvent.click(document.querySelector(`polygon.cell`) as Element);
        expect(document.querySelector(`.ring-pending`)).toBe(null);
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs tom - HeXO Arena`);
        });
    });

    it('keep the record and facts in the drawer and drop the actions', async () => {
        stubGame(watched(runningSnapshot));
        render(<GameScreen gameId="g-run" />);
        await screen.findByRole(`heading`, { name: `hextide vs tom` });
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
        await screen.findByRole(`heading`, { name: `hextide vs tom` });
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

    it('name the winner in the result, never you', async () => {
        stubGame(watched(finishedSnapshot));
        render(<GameScreen gameId="g-end" />);
        expect(await screen.findByText(`hextide won with six in a row`, { selector: `.hud-result` })).toBeTruthy();
        await waitFor(() => {
            expect(document.title).toBe(`hextide vs tom - HeXO Arena`);
        });
    });
});
