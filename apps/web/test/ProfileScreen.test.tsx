// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@hexo-arena/contract';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { meStore } from '../src/me';

const roster = [
    { name: `sealbot`, ownerName: `tom`, online: true, openForChallenges: true, rating: 1712, provisional: false },
    { name: `quietlake`, ownerName: `tom`, online: false, openForChallenges: false, rating: 1461, provisional: true },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1690, provisional: false },
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
});

describe('ProfileScreen', () => {
    it('offer the discord sign-in and the way to build a bot when signed out', async () => {
        serve(null);
        render(<ProfileScreen />);
        const signIn = await screen.findByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login`);
        expect(signIn.classList.contains(`discord-button`)).toBe(true);
        expect(screen.getByText((_content, element) => element?.matches(`.discord-sign-in .note`) === true && element.textContent === `By signing in you accept the Terms. HeXO Arena keeps only your Discord user ID and a public name made from your username, never your email; see\u00a0Privacy.`)).toBeTruthy();
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
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
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

    it('sign a user out and forget them', async () => {
        const posts: string[] = [];
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false }, posts);
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
        serve({ kind: `guest`, name: `Guest k3f9` }, posts);
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
        serve({ kind: `guest`, name: `Guest k3f9` });
        render(<ProfileScreen />);
        const signIn = await screen.findByRole(`link`, { name: `Sign in with Discord` });
        expect(signIn.getAttribute(`href`)).toBe(`/api/auth/discord/login`);
        expect(signIn.closest(`.identity-plate`)).not.toBe(null);
        // The trust line sits with the sign-in, as on every other screen.
        expect(signIn.closest(`.discord-sign-in`)?.textContent).toContain(`By signing in you accept the Terms. HeXO Arena keeps only your Discord user ID and a public name made from your username, never your email; see\u00a0Privacy.`);
    });
});
