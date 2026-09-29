// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordButton, DiscordSignIn } from '../src/components/DiscordButton';

afterEach(() => {
    cleanup();
});

describe('DiscordButton', () => {
    it('link to the discord login route, returning to the page it is on', () => {
        window.history.replaceState(null, ``, `/game/g1`);
        render(<DiscordButton />);
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fgame%2Fg1`);
        window.history.replaceState(null, ``, `/`);
    });

    it('let a guarded link ignore the second click of a double click, and follow any other', () => {
        render(<DiscordButton next="/ladder" guard />);
        const link = screen.getByRole(`link`, { name: `Sign in with Discord` });
        // The document hears a click after the link's own handler, and keeps the test page in place.
        const seen: boolean[] = [];
        const hear = (event: Event) => {
            seen.push(event.defaultPrevented);
            event.preventDefault();
        };
        document.addEventListener(`click`, hear);
        fireEvent.click(link, { detail: 2 });
        fireEvent.click(link, { detail: 1 });
        fireEvent.click(link, { detail: 0 });
        document.removeEventListener(`click`, hear);
        expect(seen).toEqual([true, false, false]);
    });

    it('read the address again whenever it could be followed, on a page that rewrites its query in place', () => {
        window.history.replaceState(null, ``, `/play?bot=devbot-c`);
        render(<DiscordButton />);
        const link = screen.getByRole(`link`, { name: `Sign in with Discord` });
        const expected = (next: string) => `/api/auth/discord/login?next=${encodeURIComponent(next)}`;
        for (const [event, path] of [
            [`focus`, `/play?bot=hextide`],
            [`pointerDown`, `/play?bot=quietlake`],
            [`contextMenu`, `/play?bot=pebble`],
        ] as const) {
            window.history.replaceState(null, ``, path);
            fireEvent[event](link);
            expect(link.getAttribute(`href`)).toBe(expected(path));
        }
        window.history.replaceState(null, ``, `/`);
    });

    it('return to the path it is given instead', () => {
        window.history.replaceState(null, ``, `/game/g1`);
        render(<DiscordButton next="/ladder" />);
        const link = screen.getByRole(`link`, { name: `Sign in with Discord` });
        link.addEventListener(`click`, (event) => {
            event.preventDefault();
        });
        fireEvent.click(link);
        expect(link.getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fladder`);
        window.history.replaceState(null, ``, `/`);
    });

    it('show sign in beside the symbol and hide the rest of the name from the eye', () => {
        render(<DiscordButton />);
        const link = screen.getByRole(`link`);
        const hidden = link.querySelector(`.sr-only`);
        expect(hidden?.textContent).toBe(` with Discord`);
        expect(link.textContent.replace(hidden?.textContent ?? ``, ``)).toBe(`Sign in`);
    });

    it('hide the symbol from assistive technology while the link keeps its name', () => {
        render(<DiscordButton />);
        const link = screen.getByRole(`link`, { name: `Sign in with Discord` });
        const symbol = link.querySelector(`svg`);
        expect(symbol?.getAttribute(`aria-hidden`)).toBe(`true`);
        expect(symbol?.getAttribute(`focusable`)).toBe(`false`);
    });

    it('draw the symbol from the official path and view box', () => {
        render(<DiscordButton />);
        const symbol = screen.getByRole(`link`).querySelector(`svg`);
        expect(symbol?.getAttribute(`viewBox`)).toBe(`0 0 126.644 96`);
        expect(symbol?.querySelector(`path`)?.getAttribute(`d`)?.startsWith(`M81.15,0c-1.2376`)).toBe(true);
    });
});

describe('DiscordSignIn', () => {
    it('say beside the button that the email stays with Discord and a first sign-in asks for the name, the terms left to that step', () => {
        render(<DiscordSignIn />);
        const line = screen.getByText(/^Your email stays with Discord/u, { selector: `.discord-sign-in .note` });
        expect(line.textContent).toBe(`Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`);
        expect(within(line).getByRole(`link`, { name: `Privacy` }).getAttribute(`href`)).toBe(`/legal/privacy`);
        expect(within(line).queryByRole(`link`, { name: `Terms` })).toBe(null);
        expect(line.closest(`.discord-sign-in`)?.querySelector(`a.discord-button`)).toBeTruthy();
    });

    it('let the place that holds it close before the privacy link navigates', () => {
        const away = vi.fn();
        render(<DiscordSignIn onNavigate={away} />);
        fireEvent.click(screen.getByRole(`link`, { name: `Privacy` }));
        expect(away).toHaveBeenCalledTimes(1);
        expect(window.location.pathname).toBe(`/legal/privacy`);
        window.history.pushState(null, ``, `/`);
    });
});
