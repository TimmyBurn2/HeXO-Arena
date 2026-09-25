import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../stored';

/**
 * Every theme the site ships; each id has exactly one sheet under
 * styles/themes, which the vocabulary test holds both ways.
 */
export const themes = [
    { id: `ink`, label: `Ink` },
    { id: `slate`, label: `Slate` },
    { id: `walnut`, label: `Walnut` },
] as const;

export type ThemeId = (typeof themes)[number][`id`];

export const defaultTheme: ThemeId = `ink`;

/**
 * The colors a theme must name, all of them and only them; brand colors
 * are shared and never set by a theme.
 */
export const themeVocabulary = [
    `--c-bg`,
    `--c-bg-raised`,
    `--c-bg-overlay`,
    `--c-bg-input`,
    `--c-bg-hover`,
    `--c-bg-active`,
    `--c-border`,
    `--c-border-strong`,
    `--c-text`,
    `--c-text-dim`,
    `--c-good`,
    `--c-good-solid`,
    `--c-bad`,
    `--c-bad-solid`,
    `--c-warn`,
    `--c-online`,
    `--c-offline`,
    `--c-backdrop`,
    `--board-bg`,
    `--board-cell`,
    `--board-line`,
    `--board-frontier`,
    `--board-stone-x`,
    `--board-stone-o`,
    `--board-focus`,
    `--board-number-x`,
    `--board-number-o`,
    `--board-coord`,
] as const;

const storageKey = `hexarena.theme.v1`;
// A stored board palette names the theme it matches, so a viewer who
// chose one keeps that look.
const legacyKey = `hexarena.board-rendering.v1`;

function isThemeId(value: unknown): value is ThemeId {
    return themes.some((theme) => theme.id === value);
}

/** The stored choice, the legacy palette carried over, or the default. */
export function parseTheme(stored: string | null, legacy: string | null): ThemeId {
    if (isThemeId(stored)) return stored;
    if (legacy !== null) {
        try {
            const value: unknown = JSON.parse(legacy);
            if (typeof value === `object` && value !== null && `palette` in value && isThemeId(value.palette)) {
                return value.palette;
            }
        } catch {
            return defaultTheme;
        }
    }
    return defaultTheme;
}

let current: ThemeId | null = null;
const listeners = new Set<() => void>();

function read(): ThemeId {
    current ??= parseTheme(readStored(storageKey), readStored(legacyKey));
    return current;
}

function apply(theme: ThemeId): void {
    if (typeof document !== `undefined`) document.documentElement.dataset.theme = theme;
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function choose(theme: ThemeId): void {
    current = theme;
    writeStored(storageKey, theme);
    apply(theme);
    for (const listener of listeners) listener();
}

/**
 * The look as a store: the root carries the theme attribute, so one
 * attribute swap restyles every surface and board at once.
 */
export const themeStore = {
    read,
    subscribe,
    choose,
    /** Put the stored theme on the root before the first render. */
    start(): void {
        apply(read());
    },
};

export function useTheme(): readonly [ThemeId, typeof themeStore.choose] {
    const theme = useSyncExternalStore(themeStore.subscribe, read, read);
    return [theme, themeStore.choose];
}
