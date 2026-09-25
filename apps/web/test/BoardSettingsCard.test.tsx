// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardSettingsCard } from '../src/board/BoardSettingsCard';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';
import { defaultTheme, themeStore } from '../src/theme/themes';

afterEach(() => {
    cleanup();
    boardSettingsStore.update(defaultBoardSettings);
    themeStore.choose(defaultTheme);
});

function boardFrame(container: HTMLElement): HTMLElement {
    return container.querySelector(`.board-frame`) as HTMLElement;
}

describe('BoardSettingsCard', () => {
    it('restyle the whole site when the theme choice changes', () => {
        const { container } = render(<BoardSettingsCard />);
        fireEvent.click(container.querySelector(`input[value="walnut"]`) as HTMLInputElement);
        expect(document.documentElement.dataset.theme).toBe(`walnut`);
    });

    it('toggle the overlay attributes from the checkboxes', () => {
        const { container } = render(<BoardSettingsCard />);
        const frame = boardFrame(container);
        fireEvent.click(container.querySelectorAll(`input[type="checkbox"]`)[0] as HTMLInputElement);
        fireEvent.click(container.querySelectorAll(`input[type="checkbox"]`)[1] as HTMLInputElement);
        expect(frame.hasAttribute(`data-numbers`)).toBe(true);
        expect(frame.hasAttribute(`data-coords`)).toBe(true);
    });

    it('persist the theme so every page renders in it', () => {
        const { container } = render(<BoardSettingsCard />);
        fireEvent.click(container.querySelector(`input[value="walnut"]`) as HTMLInputElement);
        expect(themeStore.read()).toBe(`walnut`);
        expect(window.localStorage.getItem(`hexarena.theme.v1`)).toBe(`walnut`);
    });

    it('paint the pending, focus, and last-move rings on the preview', () => {
        const { container } = render(<BoardSettingsCard />);
        expect(container.querySelectorAll(`polygon.ring-pending`)).toHaveLength(1);
        expect(container.querySelectorAll(`polygon.ring-focus`)).toHaveLength(1);
        expect(container.querySelectorAll(`polygon.last-ring`)).toHaveLength(2);
    });
});
