// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { useAsync, type AsyncOptions } from '../src/api/use-async';
import { useNow } from '../src/use-now';

// A load whose answers the test hands out one at a time, in the order it was called.
function deferredLoad<T>() {
    const waiting: { resolve: (value: T) => void; reject: (cause: unknown) => void }[] = [];
    const load = vi.fn(
        () =>
            new Promise<T>((resolve, reject) => {
                waiting.push({ resolve, reject });
            }),
    );
    const next = () => {
        const answer = waiting.shift();
        if (answer === undefined) throw new Error(`no read is out`);
        return answer;
    };
    return {
        load,
        answer: (value: T) => {
            next().resolve(value);
        },
        fail: (cause: unknown) => {
            next().reject(cause);
        },
        out: () => waiting.length,
    };
}

// Runs a step, then lets the hook take in what it set off.
async function settle(step: () => void): Promise<void> {
    await act(async () => {
        step();
        await Promise.resolve();
    });
}

// Moves the fake clock on, letting each read it sets off begin.
async function pass(ms: number): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
    });
}

let visibility: DocumentVisibilityState = `visible`;

beforeEach(() => {
    visibility = `visible`;
    Object.defineProperty(document, `visibilityState`, { configurable: true, get: () => visibility });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useAsync', () => {
    it('loads on mount, and keeps the data on screen through a failed read', async () => {
        const read = deferredLoad<string>();
        const { result } = renderHook(() => useAsync(read.load));
        expect(result.current).toMatchObject({ data: null, loading: true, pending: true, error: false });
        await settle(() => {
            read.answer(`first`);
        });
        expect(result.current).toMatchObject({ data: `first`, loading: false, pending: false, error: false });
        act(() => {
            result.current.reload();
        });
        expect(result.current).toMatchObject({ data: `first`, loading: false, pending: true });
        await settle(() => {
            read.fail(new ApiError(500, null, `down`));
        });
        expect(result.current).toMatchObject({ data: `first`, error: true, missing: false });
    });

    it('shows the error frame\'s wait for a failure with nothing to show, and loading again on its retry', async () => {
        const read = deferredLoad<string>();
        const { result } = renderHook(() => useAsync(read.load));
        await settle(() => {
            read.fail(new ApiError(429, `rate_limited`, `slow down`, 30));
        });
        expect(result.current).toMatchObject({ data: null, loading: false, error: true, limited: 30 });
        act(() => {
            result.current.reload();
        });
        expect(result.current).toMatchObject({ loading: true, error: false, limited: null });
    });

    it('says a read that answered not found is missing', async () => {
        const read = deferredLoad<string>();
        const { result } = renderHook(() => useAsync(read.load));
        await settle(() => {
            read.fail(new ApiError(404, `not_found`, `gone`));
        });
        expect(result.current).toMatchObject({ data: null, error: true, missing: true });
    });

    it('shows the last load\'s data while the next one reads, unless asked to show nothing', async () => {
        const read = deferredLoad<string>();
        const other = deferredLoad<string>();
        const { result, rerender } = renderHook(({ load, keep }: { load: () => Promise<string>; keep: boolean }) => useAsync(load, { keep }), {
            initialProps: { load: read.load, keep: true },
        });
        await settle(() => {
            read.answer(`first`);
        });
        rerender({ load: other.load, keep: true });
        expect(result.current).toMatchObject({ data: `first`, pending: true });
        rerender({ load: other.load, keep: false });
        expect(result.current).toMatchObject({ data: null, loading: true });
        await settle(() => {
            other.answer(`second`);
        });
        expect(result.current.data).toBe(`second`);
    });

    it('reads nothing while not enabled, and holds nothing meanwhile', async () => {
        const read = deferredLoad<string>();
        const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useAsync(read.load, { enabled }), { initialProps: { enabled: false } });
        expect(read.load).not.toHaveBeenCalled();
        expect(result.current).toMatchObject({ data: null, loading: false, pending: false, error: false });
        rerender({ enabled: true });
        await settle(() => {
            read.answer(`now`);
        });
        expect(result.current.data).toBe(`now`);
        rerender({ enabled: false });
        expect(result.current.data).toBe(null);
    });

    it('shows what an action answered with in place of the last read', async () => {
        const read = deferredLoad<number>();
        const { result } = renderHook(() => useAsync(read.load));
        await settle(() => {
            read.answer(1);
        });
        act(() => {
            result.current.replace((held) => (held ?? 0) + 10);
        });
        expect(result.current.data).toBe(11);
    });

    describe('on a beat', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        function beating(every: NonNullable<AsyncOptions<string>[`every`]>) {
            const read = deferredLoad<string>();
            const view = renderHook(() => useAsync(read.load, { every }));
            return { read, ...view };
        }

        it('reads again on the beat while the page is in view, and at once when it comes back into view', async () => {
            const { read } = beating(1000);
            await settle(() => {
                read.answer(`first`);
            });
            await pass(1000);
            expect(read.load).toHaveBeenCalledTimes(2);
            await settle(() => {
                read.answer(`second`);
            });
            visibility = `hidden`;
            await pass(5000);
            expect(read.load).toHaveBeenCalledTimes(2);
            visibility = `visible`;
            await settle(() => {
                document.dispatchEvent(new Event(`visibilitychange`));
            });
            expect(read.load).toHaveBeenCalledTimes(3);
        });

        it('lets a slow read land rather than start another on the beat', async () => {
            const { read, result } = beating(1000);
            await pass(3000);
            expect(read.load).toHaveBeenCalledTimes(1);
            await settle(() => {
                read.answer(`slow`);
            });
            expect(result.current.data).toBe(`slow`);
        });

        it('keeps a failure on screen while the beat reads again', async () => {
            const { read, result } = beating(1000);
            await settle(() => {
                read.fail(new ApiError(500, null, `down`));
            });
            await pass(1000);
            expect(read.out()).toBe(1);
            expect(result.current).toMatchObject({ pending: true, loading: false, error: true });
        });

        it('takes the beat from the data, and stops it for one that answered not found', async () => {
            const { read } = beating((data) => (data === `running` ? 1000 : null));
            await settle(() => {
                read.answer(`over`);
            });
            await pass(5000);
            expect(read.load).toHaveBeenCalledTimes(1);

            const watched = beating((data) => (data === `running` ? 1000 : null));
            await settle(() => {
                watched.read.answer(`running`);
            });
            await pass(1000);
            await settle(() => {
                watched.read.fail(new ApiError(404, `not_found`, `gone`));
            });
            await pass(5000);
            expect(watched.read.load).toHaveBeenCalledTimes(2);
        });
    });
});

describe('useNow', () => {
    it('steps once a beat while on, and holds where it stood while off', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        const { result, rerender } = renderHook(({ on }: { on: boolean }) => useNow(on), { initialProps: { on: true } });
        expect(result.current).toBe(10_000);
        await pass(2000);
        expect(result.current).toBe(12_000);
        rerender({ on: false });
        await pass(2000);
        expect(result.current).toBe(12_000);
    });
});
