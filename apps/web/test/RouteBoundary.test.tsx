// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '../src/AppShell';
import { meStore } from '../src/me';
import { navigate } from '../src/router/use-route';

// A screen whose code fails to download rejects its dynamic import, as a
// missing chunk does after a deploy or on a dropped connection.
vi.mock(`../src/screens/BotsScreen`, () => {
    throw new Error(`the chunk did not download`);
});
vi.mock(`../src/screens/GameScreen`, () => {
    throw new Error(`the chunk did not download`);
});
// A screen whose code arrives but fails while drawing.
vi.mock(`../src/screens/ConnectScreen`, () => ({
    ConnectScreen: () => {
        throw new Error(`the screen broke`);
    },
}));

beforeEach(() => {
    vi.stubGlobal(`fetch`, vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
    // React reports every error a boundary catches; the failure is the point here.
    vi.spyOn(console, `error`).mockImplementation(() => undefined);
    meStore.reset();
    meStore.start();
});

afterEach(() => {
    cleanup();
    window.history.replaceState(null, ``, `/`);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('a screen that fails to load', () => {
    it('says so inside the frame and offers a reload', async () => {
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        const heading = await screen.findByRole(`heading`, { name: `This page did not load` });
        expect(heading.closest(`main`)).toBeTruthy();
        expect(document.querySelector(`header.topbar`)).toBeTruthy();
        expect(screen.getByText(`Part of it did not download; reload to try again.`)).toBeTruthy();
        expect(screen.getByRole(`button`, { name: `Reload` })).toBeTruthy();
    });

    it('tells a screen that broke while drawing from one that did not download', async () => {
        window.history.replaceState(null, ``, `/connect`);
        render(<AppShell />);
        await screen.findByRole(`heading`, { name: `This page did not load` });
        expect(screen.getByText(`An error stopped it; reload to try again.`)).toBeTruthy();
        expect(screen.queryByText(/did not download/)).toBeNull();
    });

    it('says so on the stage for the game, without the frame, with a way to the ladder', async () => {
        window.history.replaceState(null, ``, `/game/g1`);
        render(<AppShell />);
        const heading = await screen.findByRole(`heading`, { name: `This page did not load` });
        expect(heading.closest(`.stage-message`)).toBeTruthy();
        expect(document.querySelector(`header.topbar`)).toBeNull();
        expect(screen.getByRole(`button`, { name: `Reload` })).toBeTruthy();
        expect(screen.getByRole(`link`, { name: `Ladder` }).getAttribute(`href`)).toBe(`/ladder`);
    });

    it('gives way to the next screen once the route changes', async () => {
        window.history.replaceState(null, ``, `/bots`);
        render(<AppShell />);
        await screen.findByRole(`heading`, { name: `This page did not load` });
        navigate(`/credits`);
        expect(await screen.findByRole(`heading`, { name: `Credits`, level: 1 })).toBeTruthy();
        expect(screen.queryByRole(`heading`, { name: `This page did not load` })).toBeNull();
    });
});
