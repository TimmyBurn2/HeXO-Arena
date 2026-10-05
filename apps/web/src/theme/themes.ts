import { useSyncExternalStore } from 'react';
import { readStored, writeStored } from '../stored';
import { text } from '../text';

/**
 * Every theme the site ships, in picker order, with the line crediting
 * where its palette comes from; each id has exactly one sheet under
 * styles/themes, which the vocabulary test holds both ways.
 */
export const themes = [
    { id: `ink`, label: text.settings.themes.ink.name, credit: text.settings.themes.ink.credit },
    { id: `hds`, label: text.settings.themes.hds.name, credit: text.settings.themes.hds.credit },
    { id: `htttx`, label: text.settings.themes.htttx.name, credit: text.settings.themes.htttx.credit },
    { id: `tyto`, label: text.settings.themes.tyto.name, credit: text.settings.themes.tyto.credit },
    { id: `omok`, label: text.settings.themes.omok.name, credit: text.settings.themes.omok.credit },
    { id: `six`, label: text.settings.themes.six.name, credit: text.settings.themes.six.credit },
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
    `--board-link`,
    `--board-number-x`,
    `--board-number-o`,
    `--board-pending`,
    `--board-last`,
    `--board-win`,
    `--board-win-casing`,
] as const;

/** Where this browser keeps the chosen theme, as the privacy policy names it. */
export const themeStorageKey = `hexo-arena.theme.v1`;

/** The stored choice, or the default. */
export function parseTheme(stored: string | null): ThemeId {
    return themes.find((theme) => theme.id === stored)?.id ?? defaultTheme;
}

let current: ThemeId | null = null;
const listeners = new Set<() => void>();

function read(): ThemeId {
    current ??= parseTheme(readStored(themeStorageKey));
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
    writeStored(themeStorageKey, theme);
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
