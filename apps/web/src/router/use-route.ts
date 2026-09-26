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
 * Popstate feeds the same listeners, so back and forward behave like any
 * navigation.
 */
export function navigate(path: string): void {
    if (window.location.pathname + window.location.search === path) return;
    window.history.pushState(null, ``, path);
    window.scrollTo(0, 0);
    notify();
}

export function useRoute(): Route {
    return useSyncExternalStore(subscribe, currentRoute, currentRoute);
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
