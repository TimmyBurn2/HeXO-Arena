// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/AppShell';
import { navigate } from '../src/router/use-route';

afterEach(() => {
    cleanup();
    window.history.replaceState(null, ``, `/`);
    vi.unstubAllGlobals();
});

function stubHealthOk(): void {
    vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
}

// The tab strip repeats the same items, so nav assertions scope to the bar.
function topbar(): HTMLElement {
    return document.querySelector(`header.topbar`) as HTMLElement;
}

function topLink(name: string): HTMLElement {
    const link = [...topbar().querySelectorAll(`a`)].find((a) => a.textContent === name);
    if (link === undefined) throw new Error(`no topbar link ${name}`);
    return link;
}

describe('AppShell', () => {
    it('render the four nav items with the arena active on the landing route', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        expect(topbar().querySelector(`.nav-links .nav-link`)?.textContent).toBe(`Arena`);
        expect(topbar().querySelectorAll(`.nav-links .nav-link`).length).toBe(3);
        expect(topbar().querySelector(`.nav-right .nav-link`)?.textContent).toBe(`Profile`);
        expect(topLink(`Arena`).getAttribute(`aria-current`)).toBe(`page`);
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(null);
    });

    it('mark exactly one top bar item active per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(`page`);
        navigate(`/connect`);
        await waitFor(() => {
            expect(topLink(`Connect`).getAttribute(`aria-current`)).toBe(`page`);
        });
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(null);
    });

    it('repeat the same four items in the tab strip', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        const tabbar = document.querySelector(`nav.tabbar`) as HTMLElement;
        expect([...tabbar.querySelectorAll(`a`)].map((a) => a.textContent)).toEqual([
            `Arena`,
            `Bots`,
            `Connect`,
            `Profile`,
        ]);
    });

    it('navigate in the SPA without a reload', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        fireEvent.click(topLink(`Bots`));
        await waitFor(() => {
            expect(window.location.pathname).toBe(`/bots`);
        });
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { name: `Bots` })).toBeTruthy();
        });
    });

    it('render the 404 screen with a way back', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/nope`);
        render(<AppShell />);
        expect(await screen.findByRole(`heading`, { name: `not found` })).toBeTruthy();
        const back = document.querySelector(`main .btn-ghost`) as HTMLElement;
        expect(back.textContent).toBe(`Arena`);
        expect(back.getAttribute(`href`)).toBe(`/`);
    });

    it('banner the paused state from the health probe', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))));
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        await waitFor(() => {
            expect(screen.getByRole(`status`).textContent).toBe(`starting games is paused; live games continue`);
        });
    });

    it('title the document per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        await waitFor(() => {
            expect(document.title).toBe(`Bots - hexarena`);
        });
        navigate(`/connect`);
        await waitFor(() => {
            expect(document.title).toBe(`Connect - hexarena`);
        });
    });

    it('offer a skip link to the main landmark', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        const skip = screen.getByRole(`link`, { name: `skip to content` });
        expect(skip.getAttribute(`href`)).toBe(`#main`);
        expect(document.getElementById(`main`)).toBeTruthy();
    });

    it('write the embed tags per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        await waitFor(() => {
            expect(document.title).toBe(`hexarena - bot arena for HeXO`);
        });
        expect(document.querySelector(`meta[property="og:title"]`)?.getAttribute(`content`)).toBe(
            `hexarena - bot arena for HeXO`,
        );
        expect(document.querySelector(`meta[property="og:description"]`)?.getAttribute(`content`)).toBe(
            `ranked ladder for HeXO bots and humans`,
        );
    });
});
