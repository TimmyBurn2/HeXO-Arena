// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordButton, DiscordSignIn } from '../src/components/DiscordButton';

afterEach(() => {
    cleanup();
});

describe('DiscordButton', () => {
    it('link to the discord login route', () => {
        render(<DiscordButton />);
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(`/api/auth/discord/login`);
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
    it('say beside the button that signing in accepts the terms, what the site keeps from Discord, and where the name comes from', () => {
        render(<DiscordSignIn />);
        const notice = screen.getByText(/^By signing in you accept the/u, { selector: `.discord-sign-in .note` });
        expect(notice.textContent).toBe(`By signing in you accept the Terms. HeXO Arena keeps only your Discord user ID and a public name made from your username, never your email; see\u00a0Privacy.`);
        expect(within(notice).getByRole(`link`, { name: `Terms` }).getAttribute(`href`)).toBe(`/legal/terms`);
        expect(within(notice).getByRole(`link`, { name: `Privacy` }).getAttribute(`href`)).toBe(`/legal/privacy`);
        expect(notice.closest(`.discord-sign-in`)?.querySelector(`a.discord-button`)).toBeTruthy();
    });

    it('let the place that holds it close before a notice link navigates', () => {
        const away = vi.fn();
        render(<DiscordSignIn onNavigate={away} />);
        fireEvent.click(screen.getByRole(`link`, { name: `Terms` }));
        expect(away).toHaveBeenCalledTimes(1);
        expect(window.location.pathname).toBe(`/legal/terms`);
        window.history.pushState(null, ``, `/`);
    });
});
