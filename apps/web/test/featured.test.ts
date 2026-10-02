// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FinishedGameEntry, GamePlayer, GameSnapshot, LiveGameEntry } from '@hexo-arena/contract';
import { featuredResultMs, pickFeatured, useFeatured } from '../src/home/featured';
import type { LiveView } from '../src/live/use-live-replay';

const bot = (name: string, rating: number): GamePlayer => ({ name, rating, provisional: false, kind: `bot` });
const guest: GamePlayer = { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` };

function entry(gameId: string, x: GamePlayer, o: GamePlayer): LiveGameEntry {
    return {
        gameId,
        players: { x, o },
        timeControl: { mode: `unlimited` },
        toMove: `o`,
        rated: x.kind !== `guest` && o.kind !== `guest`,
        cells: [{ x: 0, y: 0, side: `x` }],
        clock: { mode: `unlimited` },
    };
}

function view(game: LiveGameEntry): LiveView {
    return { entry: game, cells: game.cells, toMove: game.toMove, readAt: 0 };
}

function finished(gameId: string): GameSnapshot {
    return {
        gameId,
        players: { x: bot(`hextide`, 1600), o: bot(`pebble`, 1500) },
        openingPlies: 1,
        board: { cells: [{ x: 0, y: 0, side: `x` }] },
        timeControl: { mode: `unlimited` },
        status: `finished`,
        winner: `x`,
        reason: `surrender`,
        voided: false,
    };
}

function latest(gameId: string): FinishedGameEntry {
    return {
        gameId,
        players: { x: bot(`hextide`, 1600), o: bot(`pebble`, 1500) },
        winner: `x`,
        reason: `surrender`,
        timeControl: { mode: `unlimited` },
        openingPlies: 1,
        turns: 1,
        finishedAt: `2026-10-01T10:00:00.000Z`,
        rated: true,
        voided: false,
    };
}

// Every snapshot read answers the finished game of that id.
function stubSnapshots(): void {
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(finished(decodeURIComponent(url.split(`/`).at(-1) ?? ``)))))),
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const strong = entry(`strong`, bot(`hextide`, 1900), bot(`sealbot`, 1800));
const weak = entry(`weak`, bot(`pebble`, 1300), bot(`lantern`, 1200));
const guestGame = entry(`guest`, bot(`apex`, 2400), guest);

describe('pickFeatured', () => {
    it('prefers a rated game, then the highest average rating, then the newer game', () => {
        expect(pickFeatured([weak, guestGame, strong])?.gameId).toBe(`strong`);
        expect(pickFeatured([guestGame])?.gameId).toBe(`guest`);
        const twin = entry(`twin`, bot(`hextide`, 1900), bot(`sealbot`, 1800));
        expect(pickFeatured([twin, strong])?.gameId).toBe(`twin`);
        expect(pickFeatured([])).toBeUndefined();
    });
});

describe('useFeatured', () => {
    it('waits while the live list is out, and shows the best game from the first read', () => {
        const { result, rerender } = renderHook(({ live }) => useFeatured(live, null), { initialProps: { live: null as LiveView[] | null } });
        expect(result.current.kind).toBe(`pending`);
        rerender({ live: [view(weak), view(strong)] });
        expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `strong` } } });
    });

    it('settles when each render hands it a fresh list of the same games', async () => {
        let renders = 0;
        // A render that keeps causing the next would never return, so a bound turns it into a failure.
        const { result } = renderHook(() => {
            renders += 1;
            if (renders > 50) throw new Error(`the hook renders without end`);
            return useFeatured([view(weak), view(strong)], null);
        });
        await waitFor(() => {
            expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `strong` } } });
        });
        const settled = renders;
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(renders).toBe(settled);
        expect(renders).toBeLessThan(10);
    });

    it('holds its game while a better one starts, then shows the result for five seconds before the next', async () => {
        stubSnapshots();
        const { result, rerender } = renderHook(({ live }) => useFeatured(live, null), { initialProps: { live: [view(weak)] } });
        await waitFor(() => {
            expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `weak` } } });
        });
        rerender({ live: [view(strong), view(weak)] });
        expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `weak` } } });
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] });
        rerender({ live: [view(strong)] });
        expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `weak` } } });
        // The wait advances the fake clock by its own beat, well under a second.
        await vi.waitFor(() => {
            expect(result.current).toMatchObject({ kind: `ended`, snapshot: { gameId: `weak` } });
        });
        act(() => {
            vi.advanceTimersByTime(featuredResultMs - 1_000);
        });
        expect(result.current.kind).toBe(`ended`);
        act(() => {
            vi.advanceTimersByTime(1_000);
        });
        expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `strong` } } });
    });

    it('gives the slot up at once when the game that left has no finished record', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(`{}`, { status: 404 }))));
        const { result, rerender } = renderHook(({ live }) => useFeatured(live, null), { initialProps: { live: [view(guestGame)] } });
        await waitFor(() => {
            expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `guest` } } });
        });
        rerender({ live: [view(weak)] });
        await waitFor(() => {
            expect(result.current).toMatchObject({ kind: `live`, view: { entry: { gameId: `weak` } } });
        });
    });

    it('freezes the latest finished game when nothing is live, and has nothing without one', async () => {
        stubSnapshots();
        const { result, rerender } = renderHook(({ newest }) => useFeatured([], newest), {
            initialProps: { newest: undefined as FinishedGameEntry | null | undefined },
        });
        expect(result.current.kind).toBe(`pending`);
        rerender({ newest: latest(`g-last`) });
        await waitFor(() => {
            expect(result.current).toMatchObject({ kind: `last`, snapshot: { gameId: `g-last` } });
        });
        rerender({ newest: null });
        expect(result.current.kind).toBe(`none`);
    });
});
