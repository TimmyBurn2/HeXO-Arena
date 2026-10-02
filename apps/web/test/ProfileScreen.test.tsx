// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '@hexo-arena/contract';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { meStore } from '../src/me';

const roster = [
    { name: `sealbot`, ownerName: `quinn`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 0, levels: null },
    { name: `quietlake`, ownerName: `quinn`, online: false, openForChallenges: false, rating: 1461, provisional: true, liveGames: 0, levels: null },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1690, provisional: false, liveGames: 0, levels: null },
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
            const body = url === `/api/me` ? session : url.startsWith(`/api/games/finished`) ? history(`quinn`) : roster;
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

// A history of twelve games, of which a page holds every one.
function history(player: string): unknown {
    const games = Array.from({ length: 12 }, (_, index) => ({
        gameId: `g-${String(index)}`,
        players: {
            x: { name: player, rating: 1700, provisional: false, kind: player === `quinn` ? `user` : `bot` },
            o: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
        },
        winner: index % 2 === 0 ? `x` : `o`,
        reason: `six-in-a-row`,
        timeControl: { mode: `unlimited` },
        openingPlies: 1,
        turns: 20,
        finishedAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
        rated: true,
        voided: false,
    }));
    return { games, page: 1, pages: 1, total: 12, record: { games: 12, won: 6, lost: 6, undecided: 0, voided: 0, asX: { games: 12, won: 6, lost: 6 }, asO: { games: 0, won: 0, lost: 0 } } };
}

describe('ProfileScreen', () => {
    it('list the latest games of a signed-in player, then lead to all of them', async () => {
        serve({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        render(<ProfileScreen />);
        const section = (await screen.findByRole(`heading`, { name: `Your games` })).closest(`section`) as HTMLElement;
        expect(within(section).getAllByRole(`listitem`)).toHaveLength(5);
        expect(within(section).getByRole(`link`, { name: `All 12 games` }).getAttribute(`href`)).toBe(`/games?player=quinn`);
    });

    it('list no games on a guest\'s card, which has no player page', async () => {
        serve({ kind: `guest`, name: `Guest k3f9`, liveGames: [] });
        render(<ProfileScreen />);
        await screen.findByText(`Guest games are unrated and public under your guest label; live ones end with the session.`);
        expect(screen.queryByRole(`heading`, { name: `Your games` })).toBe(null);
    });

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
        serve({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        render(<ProfileScreen />);
        expect(await screen.findByText(`quinn`, { selector: `.identity-name` })).toBeTruthy();
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
                        ? new Response(JSON.stringify({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] }))
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
        serve({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] });
        render(<ProfileScreen />);
        await screen.findByText(`quinn`, { selector: `.identity-name` });
        expect(screen.queryByText(/^Signed in with Discord/u)).toBe(null);
    });

    it('sign a user out and forget them', async () => {
        const posts: string[] = [];
        serve({ kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] }, posts);
        render(<ProfileScreen />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Sign out` }));
        await waitFor(() => {
            expect(posts).toEqual([`/api/auth/logout`]);
        });
        await waitFor(() => {
            expect(meStore.read()).toEqual({ status: `ready`, me: null });
        });
    });

    it('tell a guest their games are unrated and public, and end the session as the menu does', async () => {
        const posts: string[] = [];
        serve({ kind: `guest`, name: `Guest k3f9`, liveGames: [] }, posts);
        render(<ProfileScreen />);
        expect(await screen.findByText(`Guest k3f9`)).toBeTruthy();
        expect(screen.getByText(`Guest games are unrated and public under your guest label; live ones end with the session.`)).toBeTruthy();
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
            `Signing in ends this guest session and its live games. Your email stays with Discord; see\u00a0Privacy.`,
        );
    });
});

describe('the account panel', () => {
    const quinn: Me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] };

    // Me, the bot list, and the history read as signed in until the account is deleted;
    // the delete answers as the server would, and the export with its file.
    function serveAccount(deleteAnswer: { status: number; code?: string }, calls: { method: string; url: string; body?: string }[] = []): void {
        let session: Me = quinn;
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string, init?: RequestInit) => {
                const method = init?.method ?? `GET`;
                calls.push({ method, url, ...(typeof init?.body === `string` ? { body: init.body } : {}) });
                if (method === `DELETE` && url === `/api/me`) {
                    if (deleteAnswer.status === 204) session = null;
                    const body = deleteAnswer.code === undefined ? null : JSON.stringify({ error: `no`, code: deleteAnswer.code });
                    return Promise.resolve(new Response(body, { status: deleteAnswer.status }));
                }
                if (url === `/api/me/export`) {
                    return Promise.resolve(new Response(`{"account":{}}`, { headers: { 'content-disposition': `attachment; filename="hexo-arena-quinn-2026-10-02.json"` } }));
                }
                const body = url === `/api/me` ? session : url.startsWith(`/api/games/finished`) ? history(`quinn`) : roster;
                return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
            }),
        );
        meStore.reset();
        meStore.start();
    }

    it('offer the download first, then deleting the account behind its typed name, and say the deletion once done', async () => {
        const calls: { method: string; url: string; body?: string }[] = [];
        serveAccount({ status: 204 }, calls);
        render(<ProfileScreen />);
        const panel = (await screen.findByRole(`heading`, { name: `Your account` })).closest(`section`) as HTMLElement;
        expect(within(panel).getAllByRole(`heading`, { level: 3 }).map((heading) => heading.textContent)).toEqual([`Your data`, `Delete account`]);
        expect(panel.textContent).toContain(
            `Each bot of yours that won or lost a game against an account or a bot, or played in a tournament, stays there too under "deleted bot", with all its games, guest games included; your other bots are deleted with their games.`,
        );
        const remove = within(panel).getByRole<HTMLButtonElement>(`button`, { name: `Delete account` });
        expect(remove.disabled).toBe(true);
        const field = within(panel).getByLabelText(`Type quinn to confirm`);
        fireEvent.change(field, { target: { value: `Quinn` } });
        expect(remove.disabled).toBe(true);
        fireEvent.change(field, { target: { value: `quinn` } });
        expect(remove.disabled).toBe(false);
        fireEvent.click(remove);
        expect(await screen.findByRole(`heading`, { name: `Your account is deleted` })).toBeTruthy();
        expect(screen.getByText(/^Your name is free/u).textContent).toBe(`Your name is free; your games stay in the public record under "deleted player", and the bots of yours kept there read "deleted bot".`);
        expect(calls.find((call) => call.method === `DELETE`)).toEqual({ method: `DELETE`, url: `/api/me`, body: `{"name":"quinn"}` });
        await waitFor(() => {
            expect(meStore.read()).toEqual({ status: `ready`, me: null });
        });
        expect(screen.getByRole(`link`, { name: `Home` }).getAttribute(`href`)).toBe(`/`);
    });

    it('say in plain words that a live game holds the deletion back', async () => {
        serveAccount({ status: 409, code: `in_live_game` });
        render(<ProfileScreen />);
        fireEvent.change(await screen.findByLabelText(`Type quinn to confirm`), { target: { value: `quinn` } });
        fireEvent.click(screen.getByRole(`button`, { name: `Delete account` }));
        expect((await screen.findByRole(`alert`)).textContent).toBe(`You are in a live game; finish or resign it, then delete the account`);
        expect(meStore.read()).toMatchObject({ me: { name: `quinn` } });
    });

    it('save the data under the name the server gives the file', async () => {
        const calls: { method: string; url: string }[] = [];
        serveAccount({ status: 204 }, calls);
        const created = vi.fn(() => `blob:data`);
        const revoked = vi.fn();
        vi.stubGlobal(`URL`, Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked }));
        const clicked: string[] = [];
        const click = vi.spyOn(HTMLAnchorElement.prototype, `click`).mockImplementation(function (this: HTMLAnchorElement) {
            clicked.push(`${this.download} ${this.href}`);
        });
        render(<ProfileScreen />);
        fireEvent.click(await screen.findByRole(`button`, { name: `Download my data` }));
        await waitFor(() => {
            expect(clicked).toEqual([`hexo-arena-quinn-2026-10-02.json blob:data`]);
        });
        expect(calls.some((call) => call.url === `/api/me/export`)).toBe(true);
        click.mockRestore();
    });
});
