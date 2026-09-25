/**
 * Read a browser preference; blocked storage (private modes, disabled site
 * data) throws on access, and a preference is never worth an error.
 */
export function readStored(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

/** Write a browser preference, dropping it when storage refuses. */
export function writeStored(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // The choice still applies for this page's life.
    }
}
