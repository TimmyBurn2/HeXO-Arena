// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@hexo-arena/contract';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { meStore } from '../src/me';

const roster = [
    { name: `sealbot`, ownerName: `tom`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 0 },
    { name: `quietlake`, ownerName: `tom`, online: false, openForChallenges: false, rating: 1461, provisional: true, liveGames: 0 },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1690, provisional: false, liveGames: 0 },
];

function serve(me: Me, posts: string[] = []): void {
    let session = me;
    vi.stubGlobal(
        `fetch`,
        vi.fn((url: string, init?: RequestInit) => {
            if (init?.method === `POST`) {
                posts.push(url);
                if (url === `/api/auth/logout`) session = null;
                return Promise.resolve(new Response(null, { status: 204 }));
            }
            const body = url === `/api/me` ? session : roster;
            return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
        }),
    );
    meStore.reset();
    meStore.start();
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    meStore.reset();
    window.history.replaceState(null, ``, `/`);
});

describe('ProfileScreen', () => {
    it('offer the discord sign-in and the way to build a bot when signed out', async () => {
        serve(null);
        window.history.replaceState(null, ``, `/profile`);
        render(<ProfileScreen />);
        const signIn = await screen.findByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fprofile`);
        expect(signIn.classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText((_content, element) => element?.matches(`.discord-sign-in .note`) === true && element.textContent === `Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('carry identity alone, the look living behind the settings gear', async () => {
        serve(null);
        render(<ProfileScreen />);
        await screen.findByRole(`link`, { name: `Sign in with Discord` });
        const headings = screen.getAllByRole(`heading`).map((heading) => heading.textContent);
        expect(headings).toEqual([`Profile`]);
        expect(screen.queryAllByRole(`radio`)).toEqual([]);
        expect(screen.queryAllByRole(`switch`)).toEqual([]);
        expect(document.querySelector(`.board-frame`)).toBe(null);
    });

    it('show a user their name, rating, and only their own bots with room for another', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        render(<ProfileScreen />);
        expect(await screen.findByText(`tom`, { selector: `.identity-name` })).toBeTruthy();
        expect(document.querySelector(`.identity-number`)?.textContent).toBe(`1503`);
        await waitFor(() => {
            expect(document.querySelectorAll(`.bot-card:not(.bot-card-new)`)).toHaveLength(2);
        });
        expect(screen.getByText(`2 of 3`)).toBeTruthy();
        expect(screen.getByText(`Delisted bots are hidden here but still count toward your limit of 3 bots.`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Build a bot` }).getAttribute(`href`)).toBe(`/connect`);
        expect(document.querySelector(`a[href="/bots/hextide"]`)).toBe(null);
    });

    it('hold the retry of rate-limited bots for their wait', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    url === `/api/me`
                        ? new Response(JSON.stringify({ kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] }))
                        : new Response(JSON.stringify({ error: `slow down`, code: `rate_limited` }), { status: 429, headers: { 'retry-after': `8` } }),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<ProfileScreen />);
        expect(await screen.findByText(`Your bots did not load`)).toBeTruthy();
        await waitFor(() => {
            expect(document.querySelector(`.empty .sr-only`)?.textContent).toBe(`Too many tries; try again in 8 s`);
        });
    });

    it('show the person their pattern and the Discord account they signed in with', async () => {
        serve({ kind: `user`, name: `mira-hex`, rating: 1000, provisional: true, discord: { username: `mira.hex`, displayName: `Mira` }, liveGames: [] });
        render(<ProfileScreen />);
        expect(await screen.findByText(`Signed in with Discord as Mira (@mira.hex)`)).toBeTruthy();
        expect(document.querySelector(`.identity-plate .sigil-plate svg.sigil`)).toBeTruthy();
        cleanup();
        serve({ kind: `user`, name: `mira-hex`, rating: 1000, provisional: true, discord: { username: `mira.hex`, displayName: null }, liveGames: [] });
        render(<ProfileScreen />);
        expect(await screen.findByText(`Signed in with Discord as @mira.hex`)).toBeTruthy();
        cleanup();
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        render(<ProfileScreen />);
        await screen.findByText(`tom`, { selector: `.identity-name` });
        expect(screen.queryByText(/^Signed in with Discord/u)).toBe(null);
    });

    it('sign a user out and forget them', async () => {
        const posts: string[] = [];
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] }, posts);
        render(<ProfileScreen />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Sign out` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/auth/logout`]);
        });
        await waitFor(() => {
            expect(meStore.read()).toEqual({ status: `ready`, me: null });
        });
    });

    it('tell a guest their games are unrated and end the session as the menu does', async () => {
        const posts: string[] = [];
        serve({ kind: `guest`, name: `Guest k3f9`, liveGames: [] }, posts);
        render(<ProfileScreen />);
        expect(await screen.findByText(`Guest k3f9`)).toBeTruthy();
        expect(screen.getByText(`Guest games are unrated and end with the session.`)).toBeTruthy();
        expect(screen.queryByRole(`button`, { name: `Sign out` })).toBe(null);
        fireEvent.click(screen.getByRole(`button`, { name: `End guest session` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/auth/logout`]);
        });
    });

    it('offer a guest the discord sign-in on their card', async () => {
        serve({ kind: `guest`, name: `Guest k3f9`, liveGames: [] });
        window.history.replaceState(null, ``, `/profile`);
        render(<ProfileScreen />);
        const signIn = await screen.findByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login?next=%2Fprofile`);
        expect(signIn.closest(`.identity-plate`)).not.toBe(null);
        // The guest's line sits with the sign-in, as in the guest menu.
        expect(signIn.closest(`.discord-sign-in`)?.textContent).toContain(
            `Signing in ends this guest session and its games. Your email stays with Discord; see\u00a0Privacy.`,
        );
    });
});
