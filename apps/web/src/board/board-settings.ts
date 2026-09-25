import { useSyncExternalStore } from 'react';

export type BoardPalette = `slate` | `walnut`;
export type StoneStyle = `disc` | `hex` | `glyph`;

export interface BoardSettings {
    palette: BoardPalette;
    stones: StoneStyle;
    numbers: boolean;
    coords: boolean;
}

export const defaultBoardSettings: BoardSettings = {
    palette: `slate`,
    stones: `hex`,
    numbers: false,
    coords: false,
};

const storageKey = `hexarena.board-rendering.v1`;
const palettes: readonly BoardPalette[] = [`slate`, `walnut`];
const stoneStyles: readonly StoneStyle[] = [`disc`, `hex`, `glyph`];

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
    const palette = palettes.find((candidate) => candidate === record.palette);
    const stones = stoneStyles.find((candidate) => candidate === record.stones);
    return {
        palette: palette ?? defaultBoardSettings.palette,
        stones: stones ?? defaultBoardSettings.stones,
        numbers: record.numbers === true,
        coords: record.coords === true,
    };
}

function storage(): Storage | null {
    return typeof window === `undefined` ? null : window.localStorage;
}

let current: BoardSettings | null = null;
const listeners = new Set<() => void>();

function read(): BoardSettings {
    if (current === null) {
        current = parseBoardSettings(storage()?.getItem(storageKey) ?? null);
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
    storage()?.setItem(storageKey, JSON.stringify(current));
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
