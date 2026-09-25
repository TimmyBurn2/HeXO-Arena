// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';
import { defaultTheme, themeStore } from '../src/theme/themes';

afterEach(() => {
    cleanup();
    boardSettingsStore.update(defaultBoardSettings);
    themeStore.choose(defaultTheme);
});

describe('ProfileScreen', () => {
    it('offer the discord sign-in and the connect path', () => {
        render(<ProfileScreen />);
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(
            `/api/auth/discord/login`,
        );
        expect(screen.getByRole(`link`, { name: `Connect` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('carry the look section in heading order', () => {
        render(<ProfileScreen />);
        const headings = screen.getAllByRole(`heading`).map((heading) => heading.textContent);
        expect(headings).toEqual([`Profile`, `Identity`, `Look`]);
    });

    it('switch the theme from the settings controls', () => {
        render(<ProfileScreen />);
        fireEvent.click(screen.getByRole(`radio`, { name: `Walnut` }));
        expect(document.documentElement.dataset.theme).toBe(`walnut`);
    });
});
