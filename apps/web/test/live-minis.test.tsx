// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { GameCell, LiveGameEntry } from '@hexo-arena/contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardSettingsStorageKey } from '../src/board/board-settings';
import { LiveGameGrid } from '../src/live/LiveGameCard';
import { MiniBoard } from '../src/live/MiniBoard';
import { liveReplayMs, useLiveReplay, type LiveView } from '../src/live/use-live-replay';

const opening: GameCell[] = [
    { x: 0, y: 0, side: `x` },
    { x: 1, y: -1, side: `o` },
    { x: 0, y: 1, side: `o` },
    { x: 2, y: 0, side: `x` },
    { x: -1, y: 2, side: `x` },
];
const turnFirst: GameCell = { x: 2, y: -2, side: `o` };
const turn: GameCell[] = [turnFirst, { x: -2, y: 1, side: `o` }];

const game = (cells: GameCell[], toMove: `x` | `o` = `o`): LiveGameEntry => ({
    gameId: `g-live`,
    players: {
        x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
        o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
    },
    timeControl: { mode: `turn`, turnTimeMs: 30_000 },
    toMove,
    rated: false,
    cells,
    clock: { mode: `turn`, remainingTurnMs: 21_000 },
});

let list: LiveGameEntry[] = [];
let reads = 0;
let reduced = false;

function setVisibility(state: `visible` | `hidden`): void {
    Object.defineProperty(document, `visibilityState`, { value: state, configurable: true });
    document.dispatchEvent(new Event(`visibilitychange`));
}

function Probe() {
    const view = useLiveReplay();
    return (
        <ul>
            {view.games?.map((shown) => (
                <li key={shown.entry.gameId} data-testid={shown.entry.gameId}>
                    {`${String(shown.cells.length)} ${shown.toMove}`}
                </li>
            ))}
        </ul>
    );
}

async function flush(ms = 0): Promise<void> {
    await act(async () => {
        vi.advanceTimersByTime(ms);
        await Promise.resolve();
        await Promise.resolve();
    });
}

beforeEach(() => {
    list = [];
    reads = 0;
    reduced = false;
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`] });
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => {
            if (url === `/api/games`) reads += 1;
            return Promise.resolve(new Response(JSON.stringify(url === `/api/games` ? list : null)));
        }),
    );
    vi.stubGlobal(
        `matchMedia`,
        vi.fn((query: string) => ({ matches: reduced && query.includes(`reduce`), addEventListener() {}, removeEventListener() {} })),
    );
    setVisibility(`visible`);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
});

describe('MiniBoard', () => {
    const shown: LiveView = { entry: game([...opening, ...turn]), cells: [...opening, ...turn], toMove: `x`, readAt: Date.now() };

    it('draw a game read-only: every stone, the last turn ringed, and a label naming both seats and whose turn it is', () => {
        const { container } = render(<MiniBoard game={shown} />);
        expect(screen.getByRole(`img`, { name: `Board, sealbot vs Guest k3f9, sealbot to move` })).toBeTruthy();
        expect(container.querySelectorAll(`g.stone`)).toHaveLength(7);
        const rings = [...container.querySelectorAll(`.last-ring`)].map((ring) => ring.getAttribute(`transform`));
        const lastTwo = [...container.querySelectorAll(`g.stone`)].slice(-2).map((stone) => stone.getAttribute(`transform`));
        expect(rings).toEqual(lastTwo);
        expect(container.querySelectorAll(`[tabindex], [data-marks], .board-control`)).toHaveLength(0);
    });

    it('ring only the stone of a turn half landed, and the whole last turn once it lands', () => {
        const half: LiveView = { entry: shown.entry, cells: [...opening, turnFirst], toMove: `o`, readAt: Date.now() };
        const { container, rerender } = render(<MiniBoard game={half} />);
        const stonesAt = () => [...container.querySelectorAll(`g.stone`)].map((stone) => stone.getAttribute(`transform`));
        const rings = () => [...container.querySelectorAll(`.last-ring`)].map((ring) => ring.getAttribute(`transform`));
        expect(rings()).toEqual(stonesAt().slice(-1));
        rerender(<MiniBoard game={shown} />);
        expect(rings()).toEqual(stonesAt().slice(-2));
    });

    it('frame the stones rather than the whole field', () => {
        const { container } = render(<MiniBoard game={shown} />);
        const [, , width] = (container.querySelector(`svg`)?.getAttribute(`viewBox`) ?? ``).split(` `).map(Number);
        expect(width).toBeLessThan(12 * Math.sqrt(3) * 28);
    });

    it('never number its stones, whatever the board setting', () => {
        window.localStorage.setItem(boardSettingsStorageKey, JSON.stringify({ numbers: true, glare: true }));
        const { container } = render(<MiniBoard game={shown} />);
        expect(container.querySelector(`[data-numbers]`)).toBe(null);
    });
});

describe('LiveGameGrid', () => {
    it('say whose turn it is as the board shows it, and hold the clock back until the read has landed', () => {
        const entry = game([...opening, ...turn], `x`);
        const readAt = Date.now();
        const { rerender } = render(<LiveGameGrid games={[{ entry, cells: [...opening, turnFirst], toMove: `o`, readAt }]} level={2} />);
        const card = screen.getByRole(`article`);
        expect(card.textContent).toContain(`Guest k3f9 to move`);
        expect(within(card).queryByRole(`timer`)).toBe(null);
        rerender(<LiveGameGrid games={[{ entry, cells: entry.cells, toMove: `x`, readAt }]} level={2} />);
        expect(card.textContent).toContain(`sealbot to move`);
        expect(within(card).queryByRole(`timer`)).not.toBe(null);
    });

    it('name a bot at a level other than its default by name and level, on the card and its board, tagged unrated', () => {
        const base = game([...opening, ...turn], `x`);
        const entry: LiveGameEntry = {
            ...base,
            players: { x: { name: `sealbot`, rating: null, provisional: false, kind: `bot`, level: { id: `deep`, label: `deep`, budget: { depthTurns: 8 } } }, o: { name: `quinn`, rating: 1503, provisional: false, kind: `user` } },
        };
        render(<LiveGameGrid games={[{ entry, cells: entry.cells, toMove: `x`, readAt: Date.now() }]} level={2} />);
        const card = screen.getByRole(`article`);
        expect(within(card).getByRole(`link`).textContent).toBe(`Watch sealbot @ deepBOTvsquinn`);
        expect(card.querySelector(`.live-name`)?.getAttribute(`title`)).toBe(`depth 8 turns`);
        expect(card.textContent).toContain(`sealbot @ deep to move`);
        expect(card.querySelector(`.live-card-meta .tag`)?.textContent).toBe(`unrated`);
        expect(within(card).getByRole(`img`, { name: `Board, sealbot @ deep vs quinn, sealbot @ deep to move` })).toBeTruthy();
    });

    it('count the clock from its read, however late the board lands', () => {
        const entry = game([...opening, ...turn], `x`);
        render(<LiveGameGrid games={[{ entry, cells: entry.cells, toMove: `x`, readAt: Date.now() - 4_000 }]} level={2} />);
        expect(screen.getByRole(`timer`).textContent).toBe(`00:17`);
    });

    it('keep counting down from its read once it ticks', async () => {
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `setInterval`, `clearInterval`, `Date`, `performance`] });
        const entry = game([...opening, ...turn], `x`);
        render(<LiveGameGrid games={[{ entry, cells: entry.cells, toMove: `x`, readAt: Date.now() - 4_000 }]} level={2} />);
        expect(screen.getByRole(`timer`).textContent).toBe(`00:17`);
        await act(async () => {
            vi.advanceTimersByTime(1_000);
            await Promise.resolve();
        });
        expect(screen.getByRole(`timer`).textContent).toBe(`00:16`);
    });

    it('put the heading before the board, so heading navigation lands on the game first', () => {
        const entry = game(opening);
        render(<LiveGameGrid games={[{ entry, cells: entry.cells, toMove: `o`, readAt: Date.now() }]} level={2} />);
        const heading = screen.getByRole(`heading`, { level: 2 });
        const board = screen.getByRole(`img`);
        expect(heading.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('useLiveReplay', () => {
    it(`reread the list every ${String(liveReplayMs / 1000)} s while the page is in view, and at once when it shows again`, async () => {
        list = [game(opening)];
        render(<Probe />);
        await flush();
        expect(reads).toBe(1);
        await flush(liveReplayMs);
        expect(reads).toBe(2);
        setVisibility(`hidden`);
        await flush(3 * liveReplayMs);
        expect(reads).toBe(2);
        setVisibility(`visible`);
        await flush();
        expect(reads).toBe(3);
    });

    it('show a game it sees first whole, then land new stones one at a time across the interval', async () => {
        list = [game(opening)];
        render(<Probe />);
        await flush();
        expect(screen.getByTestId(`g-live`).textContent).toBe(`5 o`);
        list = [game([...opening, ...turn], `x`)];
        await flush(liveReplayMs);
        expect(screen.getByTestId(`g-live`).textContent).toBe(`5 o`);
        await flush(liveReplayMs / 3);
        expect(screen.getByTestId(`g-live`).textContent).toBe(`6 o`);
        await flush(liveReplayMs / 3);
        expect(screen.getByTestId(`g-live`).textContent).toBe(`7 x`);
    });

    it('land new stones all at once when the reader asks for reduced motion', async () => {
        reduced = true;
        list = [game(opening)];
        render(<Probe />);
        await flush();
        list = [game([...opening, ...turn], `x`)];
        await flush(liveReplayMs);
        expect(screen.getByTestId(`g-live`).textContent).toBe(`7 x`);
    });

    it('show a game whole at once when a read changes a stone it already showed', async () => {
        list = [game(opening)];
        render(<Probe />);
        await flush();
        const moved = opening.map((cell, index) => (index === 1 ? { ...cell, x: 5 } : cell));
        list = [game([...moved, ...turn], `x`)];
        await flush(liveReplayMs);
        expect(screen.getByTestId(`g-live`).textContent).toBe(`7 x`);
    });

    it('drop a game the list no longer holds', async () => {
        list = [game(opening)];
        render(<Probe />);
        await flush();
        list = [];
        await flush(liveReplayMs);
        expect(screen.queryByTestId(`g-live`)).toBe(null);
    });
});
