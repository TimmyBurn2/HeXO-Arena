import { useSyncExternalStore } from 'react';
import { siteName } from '@hexo-arena/contract';
import { readStored, writeStored } from '../stored';

/**
 * Every theme the site ships, in picker order, with the line crediting
 * where its palette comes from; each id has exactly one sheet under
 * styles/themes, which the vocabulary test holds both ways.
 */
export const themes = [
    { id: `ink`, label: `Ink`, credit: siteName },
    { id: `hds`, label: `HDS`, credit: `hexo.did.science, via MineKing` },
    { id: `htttx`, label: `HTTTX`, credit: `HeXO Renderer by MineKing` },
    { id: `tyto`, label: `Tyto`, credit: `Tyto's Strix, via MineKing` },
    { id: `omok`, label: `Omok`, credit: `HeXO Renderer by MineKing` },
    { id: `six`, label: `Six`, credit: `playsix by CixMango` },
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
    `--board-pending`,
    `--board-last`,
    `--board-win`,
    `--board-win-casing`,
] as const;

const storageKey = `hexo-arena.theme.v1`;

/** The stored choice, or the default. */
export function parseTheme(stored: string | null): ThemeId {
    return themes.find((theme) => theme.id === stored)?.id ?? defaultTheme;
}

let current: ThemeId | null = null;
const listeners = new Set<() => void>();

function read(): ThemeId {
    current ??= parseTheme(readStored(storageKey));
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
