// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';
import { Settings } from '../src/settings/Settings';
import { defaultTheme, themes, themeStore } from '../src/theme/themes';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    boardSettingsStore.update(defaultBoardSettings);
    themeStore.choose(defaultTheme);
    window.localStorage.clear();
});

function gear(): HTMLElement {
    return screen.getByRole(`button`, { name: `Settings` });
}

function panel(): HTMLDialogElement | null {
    return document.querySelector(`dialog.settings`);
}

function open(): HTMLDialogElement {
    fireEvent.click(gear());
    const dialog = panel();
    if (dialog === null) throw new Error(`the settings panel did not open`);
    return dialog;
}

function stubPhone(): void {
    vi.stubGlobal(`matchMedia`, (query: string) => ({
        matches: query === `(max-width: 30rem)`,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    }));
}

describe('Settings', () => {
    it('open from the gear as a popover with focus on the checked theme', () => {
        themeStore.choose(`omok`);
        render(<Settings />);
        expect(gear().getAttribute(`aria-expanded`)).toBe(`false`);
        const dialog = open();
        expect(dialog.hasAttribute(`open`)).toBe(true);
        expect(dialog.dataset.mode).toBe(`popover`);
        expect(gear().getAttribute(`aria-expanded`)).toBe(`true`);
        expect(document.activeElement).toBe(screen.getByRole(`radio`, { name: `Omok` }));
    });

    it('open as a modal sheet below the phone breakpoint', () => {
        stubPhone();
        render(<Settings />);
        expect(open().dataset.mode).toBe(`sheet`);
    });

    it('hold the theme and the board aids and nothing else', () => {
        render(<Settings />);
        open();
        expect(screen.getAllByRole(`radio`).map((radio) => radio.getAttribute(`value`))).toEqual(themes.map((theme) => theme.id));
        expect(screen.getAllByRole(`switch`).map((toggle) => toggle.closest(`label`)?.textContent)).toEqual([
            `Stone numbers`,
            `Stone glare`,
        ]);
        expect(screen.getByRole(`group`, { name: `Theme` })).toBeTruthy();
        expect(screen.getByRole(`group`, { name: `Board` })).toBeTruthy();
        expect(document.querySelector(`.settings-foot`)?.textContent).toBe(
            `Saved in this browser. Every theme but Ink takes its colors from a community project; see Credits.`,
        );
    });

    it('name each look on its card and describe it by its credit line', () => {
        render(<Settings />);
        open();
        for (const theme of themes) {
            const radio = screen.getByRole(`radio`, { name: theme.label });
            const credit = document.getElementById(radio.getAttribute(`aria-describedby`) ?? ``);
            expect(credit?.textContent).toBe(theme.credit);
            expect(radio.closest(`label`)?.contains(credit ?? null)).toBe(true);
        }
    });

    it('close on the credits link, leaving focus to the credits page', () => {
        window.history.replaceState(null, ``, `/`);
        render(<Settings />);
        open();
        fireEvent.click(screen.getByRole(`link`, { name: `Credits` }));
        expect(window.location.pathname).toBe(`/credits`);
        expect(panel()).toBeNull();
        expect(document.activeElement).not.toBe(gear());
    });

    it('close from the gear, the close button, and Esc, handing focus back to the gear', () => {
        render(<Settings />);
        open();
        fireEvent.click(gear());
        expect(panel()).toBeNull();

        open();
        fireEvent.click(screen.getByRole(`button`, { name: `Close settings` }));
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(gear());

        open();
        fireEvent.keyDown(screen.getByRole(`radio`, { name: `Ink` }), { key: `Escape` });
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(gear());
        expect(gear().getAttribute(`aria-expanded`)).toBe(`false`);
    });

    it('close the popover on a click outside it and keep it open on a click inside', () => {
        render(
            <>
                <Settings />
                <p>elsewhere</p>
            </>,
        );
        open();
        fireEvent.click(screen.getByRole(`heading`, { name: `Settings` }));
        expect(panel()).not.toBeNull();
        fireEvent.click(screen.getByText(`elsewhere`));
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(gear());
    });

    it('close the popover when focus tabs on past it, leaving focus where it went', () => {
        render(
            <>
                <Settings />
                <a href="/profile">next</a>
            </>,
        );
        open();
        const next = screen.getByRole(`link`, { name: `next` });
        act(() => {
            next.focus();
        });
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(next);
    });

    it('close the sheet from its backdrop and when the browser closes it', () => {
        stubPhone();
        render(<Settings />);
        const dialog = open();
        fireEvent.click(dialog);
        expect(panel()).toBeNull();
        fireEvent(open(), new Event(`close`));
        expect(panel()).toBeNull();
        expect(document.activeElement).toBe(gear());
    });

    it('put a chosen theme on the root and in storage at once', () => {
        render(<Settings />);
        open();
        fireEvent.click(screen.getByRole(`radio`, { name: `Omok` }));
        expect(document.documentElement.dataset.theme).toBe(`omok`);
        expect(themeStore.read()).toBe(`omok`);
        expect(window.localStorage.getItem(`hexo-arena.theme.v1`)).toBe(`omok`);
        expect(screen.getByRole(`radio`, { name: `Omok` }).matches(`:checked`)).toBe(true);
    });

    it('write the board aid to the stored setting every board reads', () => {
        render(<Settings />);
        open();
        fireEvent.click(screen.getByRole(`switch`, { name: `Stone numbers` }));
        expect(JSON.parse(window.localStorage.getItem(`hexo-arena.board-rendering.v1`) ?? `null`)).toEqual({ numbers: true, glare: true });
        expect(boardSettingsStore.read()).toEqual({ numbers: true, glare: true });
        fireEvent.click(screen.getByRole(`switch`, { name: `Stone numbers` }));
        expect(JSON.parse(window.localStorage.getItem(`hexo-arena.board-rendering.v1`) ?? `null`)).toEqual({ numbers: false, glare: true });
    });

    it('turn the glare off everywhere from its switch, on by default', () => {
        render(<Settings />);
        open();
        const glare = screen.getByRole(`switch`, { name: `Stone glare` });
        expect(glare.matches(`:checked`)).toBe(true);
        fireEvent.click(glare);
        expect(JSON.parse(window.localStorage.getItem(`hexo-arena.board-rendering.v1`) ?? `null`)).toEqual({ numbers: false, glare: false });
        expect(document.documentElement.dataset.glare).toBe(`off`);
    });

    it('draw every swatch in its own theme while another is active', () => {
        themeStore.choose(`ink`);
        render(<Settings />);
        open();
        for (const theme of themes) {
            const card = screen.getByRole(`radio`, { name: theme.label }).closest(`label`);
            const swatch = card?.querySelector(`svg.theme-swatch`);
            expect(swatch?.getAttribute(`data-theme-preview`)).toBe(theme.id);
            expect(swatch?.querySelectorAll(`polygon.cell`)).toHaveLength(4);
            for (const side of [`x`, `o`]) {
                expect(swatch?.querySelector(`polygon.body.b-${side}`)).not.toBeNull();
                expect(swatch?.querySelector(`polygon.stone-mark.m-${side}`)).not.toBeNull();
            }
        }
        expect(document.documentElement.dataset.theme).toBe(`ink`);
    });
});
