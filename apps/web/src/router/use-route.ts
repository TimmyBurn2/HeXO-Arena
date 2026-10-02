import { useSyncExternalStore } from 'react';
import { parseRoute, type Route } from './route';

const listeners = new Set<() => void>();

// useSyncExternalStore re-reads the snapshot every render, so the parsed
// route is cached per pathname and only navigation re-parses it.
let cached: { path: string; route: Route } | null = null;

function currentRoute(): Route {
    const path = window.location.pathname;
    if (cached === null || cached.path !== path) {
        cached = { path, route: parseRoute(path) };
    }
    return cached.route;
}

function notify(): void {
    for (const listener of listeners) listener();
}

/**
 * Client navigation: push the path, scroll up, and let every subscriber
 * re-read the location.
 * `landing` names the control the next screen puts focus in, instead of
 * its content, as {@link landingOf} reads it; `replace` takes the place of
 * the current entry, for a page Back should not return to.
 * Popstate feeds the same listeners, so back and forward behave like any
 * navigation.
 */
export function navigate(path: string, how: { landing?: Landing; replace?: boolean } = {}): void {
    if (window.location.pathname + window.location.search === path) return;
    const state = how.landing === undefined ? null : { landing: how.landing };
    if (how.replace === true) {
        window.history.replaceState(state, ``, path);
    } else {
        window.history.pushState(state, ``, path);
    }
    window.scrollTo(0, 0);
    notify();
}

/** A control a screen can take focus to when a navigation asks for it. */
export type Landing = `bot-name`;

/** The control this entry asked its screen to focus, until the screen takes it. */
export function landingOf(): Landing | null {
    const state: unknown = window.history.state;
    if (typeof state !== `object` || state === null) return null;
    return Reflect.get(state, `landing`) === `bot-name` ? `bot-name` : null;
}

/** The screen has taken the focus it was asked for; a return to the entry asks nothing. */
export function landed(): void {
    window.history.replaceState(null, ``);
}

export function useRoute(): Route {
    return useSyncExternalStore(subscribe, currentRoute, currentRoute);
}

function currentSearch(): string {
    return window.location.search;
}

/** The query string, for a screen whose state lives in its address. */
export function useSearch(): string {
    return useSyncExternalStore(subscribe, currentSearch, currentSearch);
}

function currentHash(): string {
    return window.location.hash;
}

/** The fragment, for a screen whose state a link carries there, out of the server's sight. */
export function useHash(): string {
    return useSyncExternalStore(subscribe, currentHash, currentHash);
}

function currentPath(): string {
    return window.location.pathname;
}

/** The pathname itself, for the rare screen two paths share. */
export function usePath(): string {
    return useSyncExternalStore(subscribe, currentPath, currentPath);
}

export function subscribe(listener: () => void): () => void {
    if (listeners.size === 0) {
        window.addEventListener(`popstate`, onPopState);
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            window.removeEventListener(`popstate`, onPopState);
        }
    };
}

function onPopState(): void {
    notify();
}
