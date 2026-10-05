import { persistedStore, useStore } from '../store';

export interface BoardSettings {
    numbers: boolean;
    glare: boolean;
}

export const defaultBoardSettings: BoardSettings = {
    numbers: false,
    glare: true,
};

/** Where this browser keeps the board settings, as the privacy policy names it. */
export const boardSettingsStorageKey = `hexo-arena.board-rendering.v1`;

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

// The glare is off on the root, so every stone on the page, previews
// included, drops it at once.
function apply(settings: BoardSettings): void {
    if (typeof document !== `undefined`) document.documentElement.dataset.glare = settings.glare ? `on` : `off`;
}

const stored = persistedStore(boardSettingsStorageKey, parseBoardSettings, (settings) => JSON.stringify(settings), apply);

/**
 * The rendering preferences as a store: the settings panel and the game
 * drawer write, every game board reads, and the API keeps no settings.
 * `start` puts the stored glare choice on the root before the first render.
 */
export const boardSettingsStore = {
    read: stored.read,
    subscribe: stored.subscribe,
    update: (changes: Partial<BoardSettings>): void => {
        stored.set({ ...stored.read(), ...changes });
    },
    start: stored.start,
};

export function useBoardSettings(): readonly [BoardSettings, typeof boardSettingsStore.update] {
    return [useStore(stored), boardSettingsStore.update];
}
