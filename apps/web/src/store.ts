import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from './stored';

/** A value the page shares between components, read and watched through `useStore`. */
export interface Store<T> {
    readonly read: () => T;
    readonly subscribe: (listener: () => void) => () => void;
    readonly set: (next: T) => void;
}

function listening(): { subscribe: (listener: () => void) => () => void; notify: () => void } {
    const listeners = new Set<() => void>();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify() {
            for (const listener of listeners) listener();
        },
    };
}

/** A store holding `initial` until set. */
export function createStore<T>(initial: T): Store<T> {
    let current = initial;
    const { subscribe, notify } = listening();
    return {
        read: () => current,
        subscribe,
        set(next) {
            current = next;
            notify();
        },
    };
}

/** The store's value, rendering again whenever it is set. */
export function useStore<T>(store: Store<T>): T {
    return useSyncExternalStore(store.subscribe, store.read, store.read);
}

/** A browser preference as a store, kept in this browser's storage. */
export interface PersistedStore<T> extends Store<T> {
    /** Put the stored value's effect on the page before the first render. */
    readonly start: () => void;
    /** Test seam: read the browser's storage again. */
    readonly reset: () => void;
}

/**
 * A preference kept under `key`: `parse` reads what is stored, falling back
 * to a default for anything it does not know, `write` turns a value back into
 * text, and `apply` puts a value's effect on the page, where it has one.
 */
export function persistedStore<T>(key: string, parse: (raw: string | null) => T, write: (value: T) => string, apply: (value: T) => void = () => undefined): PersistedStore<T> {
    // Storage is read on first use, not at import, so a page that blocks it costs nothing until a preference is asked for.
    let current: { readonly value: T } | null = null;
    const { subscribe, notify } = listening();
    function read(): T {
        current ??= { value: parse(readStored(key)) };
        return current.value;
    }
    return {
        read,
        subscribe,
        set(next) {
            current = { value: next };
            writeStored(key, write(next));
            apply(next);
            notify();
        },
        start() {
            apply(read());
        },
        reset() {
            current = null;
        },
    };
}
