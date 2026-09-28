// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/AppShell';
import { meStore } from '../src/me';
import { navigate } from '../src/router/use-route';
import { stubEventSource } from './event-source';

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
    it('offer sign-in on the right when nobody is signed in', async () => {
        stubHealthOk();
        meStore.reset();
        meStore.start();
        render(<AppShell />);
        await waitFor(() => {
            expect(topbar().querySelector(`.nav-right a.discord-button`)?.textContent).toBe(`Sign in with Discord`);
        });
    });

    it('name the signed-in user on the right, opening the way to their profile', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    new Response(url === `/api/me` ? JSON.stringify({ kind: `user`, name: `tom`, rating: 1503, provisional: false }) : null, {
                        status: 200,
                    }),
                ),
            ),
        );
        meStore.reset();
        meStore.start();
        render(<AppShell />);
        const who = await waitFor(() => {
            const button = topbar().querySelector(`.nav-right button.identity`);
            if (!(button instanceof HTMLElement)) throw new Error(`no identity button yet`);
            return button;
        });
        expect(who.textContent).toBe(`ttom`);
        fireEvent.click(who);
        expect(document.querySelector(`#identity-panel .identity-row`)?.getAttribute(`href`)).toBe(`/profile`);
    });

    it('put the settings gear on the right, before who is here, on every framed screen', async () => {
        stubHealthOk();
        meStore.reset();
        meStore.start();
        render(<AppShell />);
        for (const path of [`/`, `/ladder`, `/bots`, `/bots/sealbot`, `/connect`, `/profile`, `/nowhere`]) {
            navigate(path);
            await waitFor(() => {
                expect(topbar().querySelector(`.nav-right a.discord-button`)).toBeTruthy();
            });
            const right = [...topbar().querySelectorAll(`.nav-right > *`)];
            expect(right.map((element) => element.getAttribute(`aria-label`) ?? element.className)).toEqual([
                `Settings`,
                `discord-button`,
            ]);
        }
    });

    it('render the ladder with its nav item active on the landing route and on /ladder', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        expect(topbar().querySelector(`.nav-links .nav-link`)?.textContent).toBe(`Ladder`);
        expect(topbar().querySelectorAll(`.nav-links .nav-link`).length).toBe(3);
        expect(topLink(`Ladder`).getAttribute(`href`)).toBe(`/ladder`);
        expect(topLink(`HeXO Arena`).getAttribute(`href`)).toBe(`/`);

        expect(await screen.findByRole(`heading`, { level: 1, name: `Ladder` })).toBeTruthy();
        expect(topLink(`Ladder`).getAttribute(`aria-current`)).toBe(`page`);
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(null);
        navigate(`/bots`);
        await waitFor(() => {
            expect(topLink(`Ladder`).getAttribute(`aria-current`)).toBe(null);
        });
        navigate(`/ladder`);
        expect(await screen.findByRole(`heading`, { level: 1, name: `Ladder` })).toBeTruthy();
        expect(topLink(`Ladder`).getAttribute(`aria-current`)).toBe(`page`);
    });

    it('mark exactly one top bar item active per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(`page`);
        navigate(`/connect`);
        await waitFor(() => {
            expect(topLink(`Build a bot`).getAttribute(`aria-current`)).toBe(`page`);
        });
        expect(topLink(`Bots`).getAttribute(`aria-current`)).toBe(null);
    });

    it('give the phone tabs the entries of the nav, with profile left to who is here', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/bots/sealbot`);
        render(<AppShell />);
        const tabbar = document.querySelector(`nav.tabbar`) as HTMLElement;
        const labels = (root: Element) => [...root.querySelectorAll(`a`)].map((a) => a.textContent);
        expect(labels(tabbar)).toEqual([`Ladder`, `Bots`, `Build a bot`]);
        expect(labels(topbar().querySelector(`nav.nav-links`) as HTMLElement)).toEqual([`Ladder`, `Bots`, `Build a bot`]);
        expect(document.querySelector(`a[href="/profile"]`)).toBe(null);
        await waitFor(() => {
            expect(tabbar.querySelector(`a[aria-current="page"]`)?.textContent).toBe(`Bots`);
        });
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
        expect(await screen.findByRole(`heading`, { name: `Not found` })).toBeTruthy();
        const back = document.querySelector(`main .btn-ghost`) as HTMLElement;
        expect(back.textContent).toBe(`Ladder`);
        expect(back.getAttribute(`href`)).toBe(`/ladder`);
    });

    it('banner the paused state from the health probe', async () => {
        vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))));
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        const line = await screen.findByText(`Starting games is paused; live games continue`);
        expect(line.closest(`[role="status"]`)).toBeTruthy();
    });

    it('title the document per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        await waitFor(() => {
            expect(document.title).toBe(`Bots - HeXO Arena`);
        });
        navigate(`/connect`);
        await waitFor(() => {
            expect(document.title).toBe(`Build a bot - HeXO Arena`);
        });
        navigate(`/ladder`);
        await waitFor(() => {
            expect(document.title).toBe(`Ladder - HeXO Arena`);
        });
        navigate(`/`);
        await waitFor(() => {
            expect(document.title).toBe(`HeXO Arena - one ladder for bots and humans`);
        });
    });

    it('show the mark beside the wordmark without adding to the home link\'s name', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/ladder`);
        render(<AppShell />);
        const home = screen.getByRole(`link`, { name: `HeXO Arena` });
        expect(home.querySelector(`svg.brand-mark`)?.getAttribute(`aria-hidden`)).toBe(`true`);
        expect(home.textContent).toBe(`HeXO Arena`);
    });

    it('offer a skip link to the main landmark', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        const skip = screen.getByRole(`link`, { name: `Skip to content` });
        expect(skip.getAttribute(`href`)).toBe(`#main`);
        expect(document.getElementById(`main`)).toBeTruthy();
    });

    it('write the embed tags per route', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/`);
        render(<AppShell />);
        await waitFor(() => {
            expect(document.title).toBe(`HeXO Arena - one ladder for bots and humans`);
        });
        expect(document.querySelector(`meta[property="og:title"]`)?.getAttribute(`content`)).toBe(
            `HeXO Arena - one ladder for bots and humans`,
        );
        expect(document.querySelector(`meta[property="og:description"]`)?.getAttribute(`content`)).toBe(
            `Connect a HeXO bot, or play one in the browser`,
        );
    });

    it('close every framed screen with the tagline and the standing links, and the game with none', async () => {
        stubHealthOk();
        stubEventSource(null);
        render(<AppShell />);
        for (const path of [`/`, `/ladder`, `/bots`, `/bots/sealbot`, `/connect`, `/profile`, `/credits`, `/nowhere`]) {
            navigate(path);
            await waitFor(() => {
                expect(document.querySelector(`footer.site-footer`)).toBeTruthy();
            });
            const footer = document.querySelector(`footer.site-footer`) as HTMLElement;
            expect(footer.querySelector(`.site-tagline`)?.textContent).toBe(`HeXO Arena, one ladder for bots and humans`);
            expect([...footer.querySelectorAll(`a`)].map((a) => [a.textContent, a.getAttribute(`href`), a.getAttribute(`target`)])).toEqual([
                [`Credits`, `/credits`, null],
                [`Bot API`, `https://github.com/TimmyBurn2/Hexo-Bot-Api`, null],
            ]);
        }
        navigate(`/credits`);
        await waitFor(() => {
            expect(document.querySelector(`footer.site-footer a[aria-current="page"]`)?.textContent).toBe(`Credits`);
        });
        navigate(`/game/g-1`);
        await waitFor(() => {
            expect(document.querySelector(`footer.site-footer`)).toBe(null);
        });
    });

    it('frame a game that does not exist as any missing page', async () => {
        vi.stubGlobal(
            `fetch`,
            vi.fn((url: string) =>
                Promise.resolve(
                    url.startsWith(`/api/games/`)
                        ? new Response(JSON.stringify({ error: `no such game`, code: `not_found` }), { status: 404 })
                        : new Response(null, { status: 200 }),
                ),
            ),
        );
        stubEventSource(null);
        window.history.replaceState(null, ``, `/game/g-gone`);
        // Every DOM state the page passes through is checked, so the heading
        // can never stand without the frame, not even for one render.
        const bare: boolean[] = [];
        const watch = new MutationObserver(() => {
            if (document.querySelector(`main h1`)?.textContent === `No such game`) {
                bare.push(document.querySelector(`header.topbar`) === null);
            }
        });
        watch.observe(document.body, { childList: true, subtree: true });
        render(<AppShell />);
        expect(await screen.findByRole(`heading`, { level: 1, name: `No such game` })).toBeTruthy();
        watch.disconnect();
        expect(bare.length).toBeGreaterThan(0);
        expect(bare.includes(true)).toBe(false);
        expect(document.querySelector(`header.topbar`)).toBeTruthy();
        expect(document.querySelector(`nav.tabbar`)).toBeTruthy();
        expect(document.querySelector(`main#main.shell`)).toBeTruthy();
        expect(document.querySelector(`footer.site-footer`)).toBeTruthy();
        // An error page marks no nav item as the place you are.
        expect(document.querySelector(`header [aria-current], nav.tabbar [aria-current]`)).toBe(null);
        await waitFor(() => {
            expect(document.title).toBe(`Not found - HeXO Arena`);
        });
        navigate(`/bots`);
        await waitFor(() => {
            expect(screen.getByRole(`heading`, { level: 1, name: `Bots` })).toBeTruthy();
        });
        expect(document.querySelector(`header.topbar`)).toBeTruthy();
    });

    it('say why a sign-in failed once, then drop the reason from the address', async () => {
        stubHealthOk();
        meStore.reset();
        meStore.start();
        window.history.replaceState(null, ``, `/?signin=expired&keep=1#top`);
        render(<AppShell />);
        const banner = await screen.findByText(`That sign-in expired; sign in again`);
        expect(banner.closest(`[role="status"]`)).toBeTruthy();
        expect(window.location.search).toBe(`?keep=1`);
        expect(window.location.hash).toBe(`#top`);
        navigate(`/bots`);
        await waitFor(() => {
            expect(screen.queryByText(`That sign-in expired; sign in again`)).toBe(null);
        });
    });

    it('add a sign-in failure line into a live region already on the page, so it is announced', async () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/?signin=expired`);
        const added: Node[] = [];
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                if (record.target instanceof Element && record.target.getAttribute(`role`) === `status`) added.push(...record.addedNodes);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        render(<AppShell />);
        const line = await screen.findByText(`That sign-in expired; sign in again`);
        const pending = observer.takeRecords();
        observer.disconnect();
        for (const record of pending) {
            if (record.target instanceof Element && record.target.getAttribute(`role`) === `status`) added.push(...record.addedNodes);
        }
        expect(added.some((node) => node.contains(line))).toBe(true);
    });

    it('ignore a sign-in reason it does not know, and still drop it', () => {
        stubHealthOk();
        window.history.replaceState(null, ``, `/?signin=eaten`);
        render(<AppShell />);
        expect(document.querySelector(`.site-banner`)).toBe(null);
        expect(window.location.search).toBe(``);
    });

    it('drop the site chrome and the gear on the immersive game route', async () => {
        stubHealthOk();
        stubEventSource(null);
        window.history.replaceState(null, ``, `/game/g-1`);
        render(<AppShell />);
        expect(document.querySelector(`header.topbar`)).toBe(null);
        expect(document.querySelector(`nav.tabbar`)).toBe(null);
        expect(screen.queryByRole(`button`, { name: `Settings` })).toBe(null);
        navigate(`/`);
        await waitFor(() => {
            expect(document.querySelector(`header.topbar`)).toBeTruthy();
        });
    });
});
