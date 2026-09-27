// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@hexo-arena/contract';
import { Identity } from '../src/identity/Identity';
import { meStore } from '../src/me';
import type { Route } from '../src/router/route';
import { Settings } from '../src/settings/Settings';

function serve(me: Me, posts: string[] = [], logout = 204): void {
    let session = me;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === `POST`) {
                posts.push(url);
                if (url === `/api/auth/logout` && logout === 204) session = null;
                return Promise.resolve(new Response(null, { status: logout }));
            }
            return Promise.resolve(new Response(JSON.stringify(session), { status: 200 }));
        }),
    );
    meStore.reset();
    meStore.start();
}

function stubPhone(): void {
    vi.stubGlobal(`matchMedia`, (query: string) => ({
        matches: query === `(max-width: 30rem)`,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
    }));
}

function panel(): HTMLDialogElement | null {
    return document.querySelector(`dialog.identity-panel`);
}

const bots: Route = { name: `bots` };

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
    window.history.replaceState(null, ``, `/`);
});

describe('Identity', () => {
    it('offer the discord sign-in and no menu when nobody is signed in', async () => {
        serve(null);
        render(<Identity route={bots} />);
        expect((await screen.findByRole(`link`, { name: `Sign in with Discord` })).getAttribute(`href`)).toBe(`/api/auth/discord/login`);
        expect(screen.queryByRole(`button`)).toBe(null);
    });

    it('open a popover from the signed-in name with the rating, where to go, and sign-out', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<Identity route={bots} />);
        const button = await screen.findByRole(`button`, { name: `tom` });
        expect(button.getAttribute(`aria-expanded`)).toBe(`false`);
        expect(button.getAttribute(`aria-haspopup`)).toBe(`dialog`);
        fireEvent.click(button);
        const dialog = panel();
        expect(dialog?.open).toBe(true);
        expect(dialog?.dataset.mode).toBe(`popover`);
        expect(button.getAttribute(`aria-expanded`)).toBe(`true`);
        expect(button.getAttribute(`aria-controls`)).toBe(`identity-panel`);
        expect(screen.getByRole(`dialog`, { name: `tom` })).toBe(dialog);
        expect(document.querySelector(`.identity-head`)?.textContent).toBe(`tom, rating 1503`);
        expect(document.querySelector(`[role="menu"], [role="menuitem"]`)).toBe(null);
        const rows = [...(dialog?.querySelectorAll(`.identity-row`) ?? [])];
        expect(rows.map((row) => [row.tagName, row.textContent, row.getAttribute(`href`)])).toEqual([
            [`A`, `Profile`, `/profile`],
            [`A`, `Build a bot`, `/connect`],
            [`BUTTON`, `Sign out`, null],
        ]);
        expect(document.activeElement).toBe(screen.getByRole(`link`, { name: `Profile` }));
    });

    it('show a provisional rating as the dim trailing question', async () => {
        serve({ kind: `user`, name: `quietowner`, rating: 1420, provisional: true });
        render(<Identity route={bots} />);
        fireEvent.click(await screen.findByRole(`button`, { name: `quietowner` }));
        const rating = document.querySelector(`.identity-head-rating`);
        expect(rating?.textContent).toBe(`, rating 1420?`);
        expect(rating?.querySelector(`.prov`)?.textContent).toBe(`?`);
    });

    it('mark the page the panel links to as current', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<Identity route={{ name: `profile` }} />);
        const button = await screen.findByRole(`button`, { name: `tom` });
        expect(button.classList.contains(`active`)).toBe(true);
        fireEvent.click(button);
        expect(screen.getByRole(`link`, { name: `Profile` }).getAttribute(`aria-current`)).toBe(`page`);
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`aria-current`)).toBe(null);
    });

    it('name a guest as unrated and offer the sign-in, then ending the session', async () => {
        serve({ kind: `guest`, name: `Guest k3f9` });
        render(<Identity route={bots} />);
        const button = await screen.findByRole(`button`, { name: `Guest k3f9, unrated` });
        fireEvent.click(button);
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(panel()?.contains(signIn)).toBe(true);
        expect(document.activeElement).toBe(signIn);
        expect(panel()?.querySelector(`.discord-sign-in .note`)?.textContent).toBe(`Discord shares your username only; no email.`);
        const end = screen.getByRole(`button`, { name: `End guest session` });
        expect(document.getElementById(end.getAttribute(`aria-describedby`) ?? ``)?.textContent).toBe(`Your guest games end with it.`);
        expect(signIn.compareDocumentPosition(end) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('close on Esc and the close button, handing focus back to the button', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<Identity route={bots} />);
        const button = await screen.findByRole(`button`, { name: `tom` });
        fireEvent.click(button);
        fireEvent.keyDown(screen.getByRole(`link`, { name: `Profile` }), { key: `Escape` });
        expect(panel()).toBe(null);
        expect(document.activeElement).toBe(button);
        fireEvent.click(button);
        fireEvent.click(screen.getByRole(`button`, { name: `Close menu` }));
        expect(panel()).toBe(null);
        expect(document.activeElement).toBe(button);
        fireEvent.click(button);
        fireEvent.click(button);
        expect(panel()).toBe(null);
    });

    it('close when focus moves back past its button, leaving focus where it went', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(
            <>
                <a href="/bots">before</a>
                <Identity route={bots} />
            </>,
        );
        const button = await screen.findByRole(`button`, { name: `tom` });
        fireEvent.click(button);
        act(() => {
            button.focus();
        });
        expect(panel()).not.toBe(null);
        const before = screen.getByRole(`link`, { name: `before` });
        act(() => {
            before.focus();
        });
        expect(panel()).toBe(null);
        expect(document.activeElement).toBe(before);
    });

    it('close on a link, leaving focus to the next screen', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<Identity route={bots} />);
        const button = await screen.findByRole(`button`, { name: `tom` });
        fireEvent.click(button);
        fireEvent.click(screen.getByRole(`link`, { name: `Build a bot` }));
        expect(window.location.pathname).toBe(`/connect`);
        expect(panel()).toBe(null);
        expect(document.activeElement).not.toBe(button);
    });

    it('open as a modal sheet below the phone breakpoint', async () => {
        stubPhone();
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<Identity route={bots} />);
        fireEvent.click(await screen.findByRole(`button`, { name: `tom` }));
        expect(panel()?.dataset.mode).toBe(`sheet`);
    });

    it('keep at most one of settings and who is here open', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(
            <>
                <Settings />
                <Identity route={bots} />
            </>,
        );
        const who = await screen.findByRole(`button`, { name: `tom` });
        const gear = screen.getByRole(`button`, { name: `Settings` });
        fireEvent.click(gear);
        expect(document.querySelector(`dialog.settings`)).not.toBe(null);
        fireEvent.click(who);
        expect(document.querySelector(`dialog.settings`)).toBe(null);
        expect(panel()).not.toBe(null);
        expect(gear.getAttribute(`aria-expanded`)).toBe(`false`);
        fireEvent.click(gear);
        expect(panel()).toBe(null);
        expect(document.querySelector(`dialog.settings`)).not.toBe(null);
        expect(who.getAttribute(`aria-expanded`)).toBe(`false`);
    });

    it('sign out from the panel and put focus on the sign-in that takes its place', async () => {
        const posts: string[] = [];
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false }, posts);
        render(<Identity route={bots} />);
        fireEvent.click(await screen.findByRole(`button`, { name: `tom` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Sign out` }));
        const signIn = await screen.findByRole(`link`, { name: `Sign in with Discord` });
        expect(posts).toEqual([`/api/auth/logout`]);
        expect(panel()).toBe(null);
        await waitFor(() => {
            expect(document.activeElement).toBe(signIn);
        });
    });

    it('end a guest session from the panel the same way', async () => {
        const posts: string[] = [];
        serve({ kind: `guest`, name: `Guest k3f9` }, posts);
        render(<Identity route={bots} />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Guest k3f9, unrated` }));
        fireEvent.click(screen.getByRole(`button`, { name: `End guest session` }));
        // The panel's own sign-in goes with it; the bar's takes its place.
        await waitFor(() => {
            expect(panel()).toBe(null);
        });
        const signIn = screen.getByRole(`link`, { name: `Sign in with Discord` });
        expect(posts).toEqual([`/api/auth/logout`]);
        await waitFor(() => {
            expect(document.activeElement).toBe(signIn);
        });
    });

    it('say so and keep the panel when sign-out does not land', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false }, [], 500);
        render(<Identity route={bots} />);
        fireEvent.click(await screen.findByRole(`button`, { name: `tom` }));
        fireEvent.click(screen.getByRole(`button`, { name: `Sign out` }));
        expect((await screen.findByRole(`alert`)).textContent).toBe(`Sign-out did not reach the server; you are still signed in`);
        expect(panel()).not.toBe(null);
        expect(screen.getByRole(`button`, { name: `Sign out` }).hasAttribute(`disabled`)).toBe(false);
    });
});
