// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { lastTurnOf, shownAtTurn, stepStone, stepTurn, turnOf, useReplay } from '../src/game/replay';

// Five opening stones, then turns of two; the last turn holds one stone.
const range = { opening: 5, total: 12 };

afterEach(() => {
    window.history.replaceState(null, ``, `/`);
});

describe('the replay steps', () => {
    it('number turns from the origin, the opening counting as its first turns', () => {
        expect([1, 3, 5, 6, 7, 11, 12].map(turnOf)).toEqual([0, 1, 2, 3, 3, 5, 6]);
    });

    it('step a turn from the opening to the end, finishing a turn left halfway', () => {
        const forward: number[] = [];
        for (let shown = range.opening; shown < range.total; shown = stepTurn(shown, 1, range)) forward.push(shown);
        expect(forward).toEqual([5, 7, 9, 11]);
        expect(stepTurn(11, 1, range)).toBe(12);
        expect(stepTurn(6, 1, range)).toBe(7);
        expect(stepTurn(12, 1, range)).toBe(12);
    });

    it('step a turn back to a turn\'s start, never into the opening', () => {
        expect(stepTurn(12, -1, range)).toBe(11);
        expect(stepTurn(11, -1, range)).toBe(9);
        expect(stepTurn(8, -1, range)).toBe(7);
        expect(stepTurn(7, -1, range)).toBe(5);
        expect(stepTurn(5, -1, range)).toBe(5);
    });

    it('step a stone at a time inside the range, the opening showing whole', () => {
        expect(stepStone(7, -1, range)).toBe(6);
        expect(stepStone(5, -1, range)).toBe(5);
        expect(stepStone(12, 1, range)).toBe(12);
    });

    it('open a turn at its end, inside the range', () => {
        expect(shownAtTurn(0, range)).toBe(5);
        expect(shownAtTurn(3, range)).toBe(7);
        expect(shownAtTurn(6, range)).toBe(12);
        expect(shownAtTurn(99, range)).toBe(12);
    });

    it('ring the shown stones of the last turn, and none in the opening', () => {
        const stones = Array.from({ length: 12 }, (_, index) => index);
        expect(lastTurnOf(stones, 5, range)).toEqual([]);
        expect(lastTurnOf(stones, 7, range)).toEqual([5, 6]);
        expect(lastTurnOf(stones, 6, range)).toEqual([5]);
        expect(lastTurnOf(stones, 12, range)).toEqual([11]);
    });
});

describe('useReplay', () => {
    it('opens at the turn a link names, writes each step back in place, and drops it at the end', () => {
        window.history.replaceState(null, ``, `/game/g1?turn=3&x=1`);
        const length = window.history.length;
        const { result } = renderHook(() => useReplay(range, true));
        expect(result.current.shown).toBe(7);
        expect(result.current.following).toBe(false);
        act(() => {
            result.current.go(9);
        });
        expect(window.location.search).toBe(`?turn=4&x=1`);
        act(() => {
            result.current.go(12);
        });
        expect(result.current.following).toBe(true);
        expect(window.location.search).toBe(`?x=1`);
        expect(window.history.length).toBe(length);
    });

    it('follows the latest stone until it is held, and holds where it stands as stones arrive', () => {
        const { result, rerender } = renderHook(({ total }) => useReplay({ opening: 1, total }, true), { initialProps: { total: 9 } });
        expect(result.current.shown).toBe(9);
        rerender({ total: 11 });
        expect(result.current.shown).toBe(11);
        act(() => {
            result.current.follow(false);
        });
        // Held at the latest stone is held, not following.
        expect(result.current.following).toBe(false);
        rerender({ total: 13 });
        expect(result.current.shown).toBe(11);
        expect(result.current.following).toBe(false);
        act(() => {
            result.current.follow(true);
        });
        expect(result.current.shown).toBe(13);
    });

    it('ignores a link\'s turn where the board does not replay', () => {
        window.history.replaceState(null, ``, `/game/g1?turn=1`);
        const { result } = renderHook(() => useReplay(range, false));
        expect(result.current.shown).toBe(12);
    });
});
