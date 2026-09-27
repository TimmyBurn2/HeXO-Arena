import type { Page } from '@playwright/test';
import { themes } from '../src/theme/themes';
import { liveGames, world, type World } from './mock-api';

/** A named look the whole site can wear. */
export interface Look {
    name: string;
    storage: Record<string, string>;
}

export const looks: readonly Look[] = themes.map((theme) => ({
    name: theme.id,
    storage: { 'hexarena.theme.v1': theme.id },
}));

export interface Viewport {
    name: string;
    width: number;
    height: number;
}

export const viewports: readonly Viewport[] = [
    { name: `desktop`, width: 1440, height: 900 },
    { name: `tablet`, width: 768, height: 1024 },
    { name: `phone`, width: 390, height: 844 },
    { name: `narrow`, width: 360, height: 740 },
];

// An open top-bar panel is a popover or a sheet, so one width of each
// shows it.
const panelViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];

/**
 * One screen in one state: where to go, the world it sees, and the
 * element whose presence means the state has rendered.
 */
export interface Shot {
    name: string;
    path: string;
    world: World;
    ready: string;
    // Framed screens must never scroll sideways; the game stage owns the
    // viewport and scrolls its board by design.
    framed: boolean;
    after?: (page: Page) => Promise<void>;
    // Extra preferences this state needs before the app boots.
    storage?: Record<string, string>;
    // A board or the theme swatches are on screen, so every look is
    // captured; elsewhere a look changes only surface and text tokens,
    // which the contrast gate holds pair by pair and step by step, so the
    // default look stands for all.
    board?: true;
    // Widths other than the matrix's own.
    viewports?: readonly Viewport[];
}

const signedOut = world({ me: null });
const guest = world({ me: { kind: `guest`, name: `Guest k3f9` } });

async function openSettings(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Settings`, exact: true }).click();
    await page.locator(`dialog.settings[open]`).waitFor();
}

async function openIdentity(page: Page): Promise<void> {
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel[open]`).waitFor();
}

export const shots: readonly Shot[] = [
    { name: `ladder`, path: `/`, world: world(), ready: `.live-game`, framed: true },
    { name: `ladder-path`, path: `/ladder`, world: world(), ready: `.live-game`, framed: true },
    { name: `ladder-empty`, path: `/`, world: world({ leaderboard: [], live: [] }), ready: `.empty`, framed: true },
    { name: `ladder-empty-live`, path: `/`, world: world({ leaderboard: [] }), ready: `.live-game`, framed: true },
    { name: `ladder-live-none`, path: `/`, world: world({ live: [] }), ready: `.live-rail .note`, framed: true },
    {
        name: `ladder-live-full`,
        path: `/`,
        world: world({ live: liveGames }),
        ready: `.live-game`,
        framed: true,
        after: async (page) => {
            await page.locator(`.live-rail`).scrollIntoViewIfNeeded();
        },
    },
    { name: `settings`, path: `/`, world: world(), ready: `.live-game`, framed: true, after: openSettings, board: true },
    {
        name: `settings-aids`,
        path: `/bots/sealbot`,
        world: guest,
        ready: `h1`,
        framed: true,
        after: openSettings,
        storage: { 'hexarena.board-rendering.v1': `{"numbers":true}` },
        board: true,
    },
    { name: `settings-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true, after: openSettings, board: true },
    { name: `menu-settings`, path: `/bots`, world: world(), ready: `table`, framed: true, after: openSettings, viewports: panelViewports },
    { name: `menu-identity`, path: `/bots`, world: world(), ready: `table`, framed: true, after: openIdentity, viewports: panelViewports },
    {
        name: `menu-identity-provisional`,
        path: `/profile`,
        world: world({ me: { kind: `user`, name: `quietowner`, rating: 1420, provisional: true } }),
        ready: `h1`,
        framed: true,
        after: openIdentity,
        viewports: panelViewports,
    },
    { name: `menu-guest`, path: `/connect`, world: guest, ready: `h1`, framed: true, after: openIdentity, viewports: panelViewports },
    { name: `ladder-loading`, path: `/`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `ladder-error`, path: `/`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `bots`, path: `/bots`, world: world(), ready: `table`, framed: true },
    { name: `bot-owner`, path: `/bots/sealbot`, world: world(), ready: `.bot-live`, framed: true },
    { name: `bot-live-none`, path: `/bots/sealbot`, world: world({ live: [] }), ready: `h1`, framed: true },
    {
        name: `bot-visitor`,
        path: `/bots/sealbot`,
        world: world({ me: { kind: `user`, name: `ana`, rating: 1402, provisional: false } }),
        ready: `h1`,
        framed: true,
    },
    {
        name: `play-dialog`,
        path: `/bots/sealbot`,
        world: world(),
        ready: `h1`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: /^Play sealbot/ }).click();
            await page.locator(`dialog[open]`).waitFor();
        },
    },
    {
        name: `play-dialog-signed-out`,
        path: `/bots/sealbot`,
        world: signedOut,
        ready: `h1`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: /^Play sealbot/ }).click();
            await page.locator(`dialog[open]`).waitFor();
        },
    },
    { name: `build`, path: `/connect`, world: world(), ready: `h1`, framed: true },
    { name: `build-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true },
    { name: `profile`, path: `/profile`, world: world(), ready: `h1`, framed: true },
    { name: `profile-guest`, path: `/profile`, world: guest, ready: `h1`, framed: true },
    { name: `profile-signed-out`, path: `/profile`, world: signedOut, ready: `h1`, framed: true },
    { name: `game-your-move`, path: `/game/running`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-waiting`, path: `/game/waiting`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-low-clock`, path: `/game/hurry`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-finished`, path: `/game/finished`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    {
        name: `game-finished-numbers`,
        path: `/game/finished`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexarena.board-rendering.v1': `{"numbers":true}` },
        board: true,
    },
    {
        name: `game-drawer`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
        board: true,
    },
    ...(
        [
            [`game-drawer-origin`, `/game/origin`],
            [`game-drawer-nine`, `/game/nine`],
            [`game-drawer-finished`, `/game/finished`],
            [`game-drawer-five-finished`, `/game/five-finished`],
            [`game-drawer-nine-finished`, `/game/nine-finished`],
        ] as const
    ).map(([name, path]) => ({
        name,
        path,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        board: true as const,
        after: async (page: Page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
    })),
    {
        name: `game-facts`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.getByRole(`tab`, { name: `Game` }).click();
        },
        board: true,
    },
    {
        name: `game-pending`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.getByRole(`application`).focus();
            await page.keyboard.press(`ArrowRight`);
            await page.keyboard.press(`Enter`);
        },
        board: true,
    },
    { name: `game-loading`, path: `/game/running`, world: world({ stall: true }), ready: `.hud-skeleton`, framed: false },
    {
        name: `game-pinned`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexarena.drawer-pinned.v1': `1` },
        board: true,
    },
    {
        name: `game-drawer-aids`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexarena.board-rendering.v1': `{"numbers":true}` },
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
        board: true,
    },
    { name: `watch-running`, path: `/game/running`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    { name: `watch-guest`, path: `/game/guest`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    { name: `watch-finished`, path: `/game/finished`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    ...(
        [
            [`watch-drawer`, `/game/running`],
            [`watch-drawer-long`, `/game/long`],
            [`watch-drawer-finished`, `/game/finished`],
        ] as const
    ).map(([name, path]) => ({
        name,
        path,
        world: signedOut,
        ready: `svg polygon.cell`,
        framed: false,
        board: true as const,
        after: async (page: Page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
    })),
    {
        name: `watch-facts`,
        path: `/game/guest`,
        world: signedOut,
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.getByRole(`tab`, { name: `Game` }).click();
        },
        board: true,
    },
    { name: `game-missing`, path: `/game/nope`, world: world(), ready: `h1`, framed: true },
    { name: `not-found`, path: `/nowhere`, world: world(), ready: `h1`, framed: true },
    { name: `credits`, path: `/credits`, world: world(), ready: `h1`, framed: true, board: true },
];

/** Seed the look's storage before any app script runs. */
export async function wear(page: Page, look: Look): Promise<void> {
    await page.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    }, look.storage);
}
