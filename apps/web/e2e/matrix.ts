import type { Page } from '@playwright/test';
import { world, type World } from './mock-api';

/** A named look the whole site can wear; every screen is captured in each. */
export interface Look {
    name: string;
    storage: Record<string, string>;
}

export const looks: readonly Look[] = [
    { name: `slate`, storage: { 'hexarena.board-rendering.v1': JSON.stringify({ palette: `slate` }) } },
    { name: `walnut`, storage: { 'hexarena.board-rendering.v1': JSON.stringify({ palette: `walnut` }) } },
];

export const viewports = [
    { name: `desktop`, width: 1440, height: 900 },
    { name: `phone`, width: 390, height: 844 },
    { name: `narrow`, width: 360, height: 740 },
] as const;

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
}

const signedOut = world({ me: null });
const guest = world({ me: { kind: `guest`, name: `Guest k3f9` } });

export const shots: readonly Shot[] = [
    { name: `arena`, path: `/`, world: world(), ready: `table`, framed: true },
    { name: `arena-empty`, path: `/`, world: world({ leaderboard: [] }), ready: `.empty`, framed: true },
    { name: `arena-loading`, path: `/`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `arena-error`, path: `/`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `bots`, path: `/bots`, world: world(), ready: `table`, framed: true },
    { name: `bot-owner`, path: `/bots/sealbot`, world: world(), ready: `h1`, framed: true },
    {
        name: `bot-visitor`,
        path: `/bots/sealbot`,
        world: world({ me: { kind: `user`, name: `ana` } }),
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
    { name: `connect`, path: `/connect`, world: world(), ready: `h1`, framed: true },
    { name: `connect-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true },
    { name: `profile`, path: `/profile`, world: world(), ready: `h1`, framed: true },
    { name: `profile-guest`, path: `/profile`, world: guest, ready: `h1`, framed: true },
    { name: `profile-signed-out`, path: `/profile`, world: signedOut, ready: `h1`, framed: true },
    { name: `game-your-move`, path: `/game/running`, world: world(), ready: `svg polygon.cell`, framed: false },
    { name: `game-waiting`, path: `/game/waiting`, world: world(), ready: `svg polygon.cell`, framed: false },
    { name: `game-low-clock`, path: `/game/hurry`, world: world(), ready: `svg polygon.cell`, framed: false },
    { name: `game-finished`, path: `/game/finished`, world: world(), ready: `svg polygon.cell`, framed: false },
    { name: `game-missing`, path: `/game/nope`, world: world(), ready: `h1`, framed: true },
    { name: `not-found`, path: `/nowhere`, world: world(), ready: `h1`, framed: true },
];

/** Seed the look's storage before any app script runs. */
export async function wear(page: Page, look: Look): Promise<void> {
    await page.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    }, look.storage);
}
