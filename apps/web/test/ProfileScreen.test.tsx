// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';

afterEach(() => {
    cleanup();
    boardSettingsStore.update(defaultBoardSettings);
});

describe('ProfileScreen', () => {
    it('offer the discord sign-in and the connect path', () => {
        render(<ProfileScreen />);
        expect(screen.getByRole(`link`, { name: `Sign in with Discord` }).getAttribute(`href`)).toBe(
            `/api/auth/discord/login`,
        );
        expect(screen.getByRole(`link`, { name: `Connect` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('carry the board rendering section in heading order', () => {
        render(<ProfileScreen />);
        const headings = screen.getAllByRole(`heading`).map((heading) => heading.textContent);
        expect(headings).toEqual([`Profile`, `Identity`, `Board rendering`]);
    });

    it('swap the live preview palette from the settings controls', () => {
        render(<ProfileScreen />);
        const frame = document.querySelector(`.board-frame`) as HTMLElement;
        expect(frame.getAttribute(`data-board`)).toBe(defaultBoardSettings.palette);
        fireEvent.click(screen.getByRole(`radio`, { name: `walnut` }));
        expect(frame.getAttribute(`data-board`)).toBe(`walnut`);
        expect(boardSettingsStore.read().palette).toBe(`walnut`);
    });
});
