import { fireEvent, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';

/** A read a page makes on its beat, and what it answers this time. */
export interface BeatRead {
    readonly path: string;
    readonly answer: unknown;
}

/**
 * Presses a control the moment a read answering as `read` says shows
 * `said`, before that render's effects have run, as a press does that comes
 * while the page draws a read: React runs those effects before the press's
 * render.
 * Every other request goes on to the fetch stubbed before.
 */
export async function pressAsReadLands(read: BeatRead, said: string, control: () => HTMLElement): Promise<void> {
    const served = globalThis.fetch;
    let asked = false;
    vi.stubGlobal(`fetch`, (url: string, init?: RequestInit) => {
        if (url !== read.path || init?.method !== undefined) return served(url, init);
        asked = true;
        return Promise.resolve(new Response(JSON.stringify(read.answer)));
    });
    let pressed = false;
    const observer = new MutationObserver(() => {
        if (pressed || !document.body.textContent.includes(said)) return;
        pressed = true;
        observer.disconnect();
        fireEvent.click(control());
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    // Coming back into view reads at once, as the beat does;
    // a page listens for it in an effect of its first read's render, which may still be to run.
    await waitFor(
        () => {
            if (!asked) document.dispatchEvent(new Event(`visibilitychange`));
            expect(pressed).toBe(true);
        },
        { timeout: 5_000 },
    );
}
