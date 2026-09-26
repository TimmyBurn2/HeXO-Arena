// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiscordButton } from '../src/components/DiscordButton';

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
