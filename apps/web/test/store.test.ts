// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore, persistedStore, useStore } from '../src/store';

afterEach(() => {
    window.localStorage.clear();
});

describe('createStore', () => {
    it('holds its value until set, and tells each listener until it stops listening', () => {
        const store = createStore(1);
        const heard = vi.fn();
        const stop = store.subscribe(heard);
        expect(store.read()).toBe(1);
        store.set(2);
        expect(store.read()).toBe(2);
        expect(heard).toHaveBeenCalledTimes(1);
        stop();
        store.set(3);
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('renders a reader again whenever it is set', () => {
        const store = createStore(`a`);
        const { result } = renderHook(() => useStore(store));
        act(() => {
            store.set(`b`);
        });
        expect(result.current).toBe(`b`);
    });
});

describe('persistedStore', () => {
    const parse = (raw: string | null) => (raw === `on` ? `on` : `off`);

    it('reads this browser\'s storage on first use, not before', () => {
        window.localStorage.setItem(`k`, `on`);
        const store = persistedStore(`k`, parse, (value) => value);
        window.localStorage.setItem(`k`, `off`);
        expect(store.read()).toBe(`off`);
        window.localStorage.setItem(`k`, `on`);
        expect(store.read()).toBe(`off`);
        store.reset();
        expect(store.read()).toBe(`on`);
    });

    it('writes every value set, puts its effect on the page, and tells its listeners', () => {
        const apply = vi.fn();
        const heard = vi.fn();
        const store = persistedStore(`k`, parse, (value) => value, apply);
        store.subscribe(heard);
        store.set(`on`);
        expect(window.localStorage.getItem(`k`)).toBe(`on`);
        expect(apply).toHaveBeenCalledWith(`on`);
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('puts the stored value\'s effect on the page at start', () => {
        window.localStorage.setItem(`k`, `on`);
        const apply = vi.fn();
        persistedStore(`k`, parse, (value) => value, apply).start();
        expect(apply).toHaveBeenCalledWith(`on`);
    });
});
