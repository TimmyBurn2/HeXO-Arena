import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../stored';

export interface BoardSettings {
    numbers: boolean;
    glare: boolean;
}

export const defaultBoardSettings: BoardSettings = {
    numbers: false,
    glare: true,
};

const storageKey = `hexo-arena.board-rendering.v1`;

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
        glare: record.glare !== false,
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

// The glare is off on the root, so every stone on the page, previews
// included, drops it at once.
function apply(settings: BoardSettings): void {
    if (typeof document !== `undefined`) document.documentElement.dataset.glare = settings.glare ? `on` : `off`;
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
    apply(current);
    for (const listener of listeners) listener();
}

/**
 * The rendering preferences as a store: the settings panel and the game
 * drawer write, every game board reads, and the API keeps no settings.
 */
export const boardSettingsStore = {
    read,
    subscribe,
    update,
    /** Put the stored glare choice on the root before the first render. */
    start(): void {
        apply(read());
    },
};

export function useBoardSettings(): readonly [BoardSettings, typeof boardSettingsStore.update] {
    const settings = useSyncExternalStore(boardSettingsStore.subscribe, read, read);
    return [settings, boardSettingsStore.update];
}
