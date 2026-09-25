// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BoardSettingsCard } from '../src/board/BoardSettingsCard';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';

afterEach(() => {
    cleanup();
    boardSettingsStore.update(defaultBoardSettings);
});

function boardFrame(container: HTMLElement): HTMLElement {
    return container.querySelector(`.board-frame`) as HTMLElement;
}

describe('BoardSettingsCard', () => {
    it('swap the palette attribute when the palette choice changes', () => {
        const { container } = render(<BoardSettingsCard />);
        fireEvent.click(container.querySelector(`input[value="walnut"]`) as HTMLInputElement);
        expect(boardFrame(container).getAttribute(`data-board`)).toBe(`walnut`);
    });

    it('swap the stone style attribute when the stone choice changes', () => {
        const { container } = render(<BoardSettingsCard />);
        fireEvent.click(container.querySelector(`input[value="hex"]`) as HTMLInputElement);
        expect(boardFrame(container).getAttribute(`data-stones`)).toBe(`hex`);
    });

    it('toggle the overlay attributes from the checkboxes', () => {
        const { container } = render(<BoardSettingsCard />);
        const frame = boardFrame(container);
        fireEvent.click(container.querySelectorAll(`input[type="checkbox"]`)[0] as HTMLInputElement);
        fireEvent.click(container.querySelectorAll(`input[type="checkbox"]`)[1] as HTMLInputElement);
        expect(frame.hasAttribute(`data-numbers`)).toBe(true);
        expect(frame.hasAttribute(`data-coords`)).toBe(true);
    });

    it('persist the choice so every board renders from it', () => {
        const { container } = render(<BoardSettingsCard />);
        fireEvent.click(container.querySelector(`input[value="walnut"]`) as HTMLInputElement);
        expect(boardSettingsStore.read().palette).toBe(`walnut`);
    });

    it('paint the pending, focus, and last-move rings on the preview', () => {
        const { container } = render(<BoardSettingsCard />);
        expect(container.querySelectorAll(`polygon.ring-pending`)).toHaveLength(1);
        expect(container.querySelectorAll(`polygon.ring-focus`)).toHaveLength(1);
        expect(container.querySelectorAll(`polygon.last-ring`)).toHaveLength(2);
    });
});
