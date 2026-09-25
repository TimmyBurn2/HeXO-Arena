import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../stored';

export interface BoardSettings {
    numbers: boolean;
    coords: boolean;
}

export const defaultBoardSettings: BoardSettings = {
    numbers: false,
    coords: false,
};

const storageKey = `hexarena.board-rendering.v1`;

/**
 * The stored settings are our own earlier writes behind a versioned key,
 * so anything unexpected folds back to the defaults rather than failing.
 */
export function parseBoardSettings(raw: string | null): BoardSettings {
    if (raw === null) return defaultBoardSettings;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return defaultBoardSettings;
    }
    if (typeof value !== `object` || value === null) return defaultBoardSettings;
    const record = value as Record<string, unknown>;
    return {
        numbers: record.numbers === true,
        coords: record.coords === true,
    };
}

let current: BoardSettings | null = null;
const listeners = new Set<() => void>();

function read(): BoardSettings {
    if (current === null) {
        current = parseBoardSettings(readStored(storageKey));
    }
    return current;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function update(changes: Partial<BoardSettings>): void {
    current = { ...read(), ...changes };
    writeStored(storageKey, JSON.stringify(current));
    for (const listener of listeners) listener();
}

/**
 * The rendering preferences as a store: Profile writes, every game board
 * reads, and the API keeps no settings.
 */
export const boardSettingsStore = {
    read,
    subscribe,
    update,
};

export function useBoardSettings(): readonly [BoardSettings, typeof boardSettingsStore.update] {
    const settings = useSyncExternalStore(boardSettingsStore.subscribe, read, read);
    return [settings, boardSettingsStore.update];
}
