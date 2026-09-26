// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@hexarena/contract';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { boardSettingsStore, defaultBoardSettings } from '../src/board/board-settings';
import { meStore } from '../src/me';
import { defaultTheme, themeStore } from '../src/theme/themes';

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
    boardSettingsStore.update(defaultBoardSettings);
    themeStore.choose(defaultTheme);
});

describe('ProfileScreen', () => {
    it('offer the discord sign-in and the connect path when signed out', async () => {
        serve(null);
        render(<ProfileScreen />);
        expect((await screen.findByRole(`link`, { name: `Sign in with Discord` })).getAttribute(`href`)).toBe(
            `/api/auth/discord/login`,
        );
        expect(screen.getByRole(`link`, { name: `Connect` }).getAttribute(`href`)).toBe(`/connect`);
    });

    it('carry the identity and look sections in heading order', async () => {
        serve(null);
        render(<ProfileScreen />);
        await screen.findByRole(`link`, { name: `Sign in with Discord` });
        const headings = screen.getAllByRole(`heading`).map((heading) => heading.textContent);
        expect(headings).toEqual([`Profile`, `Identity`, `Look`]);
    });

    it('show a user their name, rating, and only their own bots with the free slots', async () => {
        serve({ kind: `user`, name: `tom`, rating: 1503, provisional: false });
        render(<ProfileScreen />);
        expect(await screen.findByText(`tom`, { selector: `.identity-name` })).toBeTruthy();
        expect(document.querySelector(`.identity-number`)?.textContent).toBe(`1503`);
        await waitFor(() => {
            expect(document.querySelectorAll(`.bot-card:not(.bot-card-new)`)).toHaveLength(2);
        });
        expect(screen.getByText(`2 of 3`)).toBeTruthy();
        expect(screen.getByRole(`link`, { name: /Create a bot/ }).getAttribute(`href`)).toBe(`/connect`);
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

    it('tell a guest their games are unrated and confirm before ending them', async () => {
        const posts: string[] = [];
        serve({ kind: `guest`, name: `Guest k3f9` }, posts);
        render(<ProfileScreen />);
        expect(await screen.findByText(`Guest k3f9`)).toBeTruthy();
        expect(screen.getByText(`Guest games are unrated and end with the session.`)).toBeTruthy();
        fireEvent.click(screen.getByRole(`button`, { name: `Sign out` }));
        expect(posts).toEqual([]);
        fireEvent.click(screen.getByRole(`button`, { name: `Sign out and end guest games` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/auth/logout`]);
        });
    });

    it('switch the theme from the look controls', async () => {
        serve(null);
        render(<ProfileScreen />);
        await screen.findByRole(`link`, { name: `Sign in with Discord` });
        fireEvent.click(screen.getByRole(`radio`, { name: `Walnut` }));
        expect(document.documentElement.dataset.theme).toBe(`walnut`);
    });
});
