import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexarena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `tom`, rating: 1503, provisional: false } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9` } },
];

const screens: readonly { name: string; path: string }[] = [
    { name: `the root`, path: `/` },
    { name: `the ladder`, path: `/ladder` },
    { name: `bots`, path: `/bots` },
    { name: `a bot page`, path: `/bots/sealbot` },
    { name: `build a bot`, path: `/connect` },
    { name: `profile`, path: `/profile` },
    { name: `credits`, path: `/credits` },
    { name: `a missing page`, path: `/nowhere` },
    { name: `a missing game`, path: `/game/nope` },
];

// The screen matrix jumps from phone to tablet; the band between is where
// the nav links return beside the gear and who is here, so it is swept
// closely, then out to the desktop widths, on every framed screen.
const widths = [360, 481, 520, 560, 600, 640, 641, 700, 767, 768, 1024, 1280];

async function barFits(page: Page, width: number, signedIn: boolean): Promise<void> {
    const who = signedIn ? page.locator(`header button.identity`) : page.locator(`header`).getByRole(`link`, { name: `Sign in with Discord` });
    const whoBox = await who.boundingBox();
    expect(whoBox === null ? Infinity : whoBox.x + whoBox.width).toBeLessThanOrEqual(width);
    // The gear holds its square however little room the row has.
    const gear = await page.getByRole(`button`, { name: `Settings`, exact: true }).boundingBox();
    expect(gear === null ? 0 : Math.round(gear.width)).toBe(gear === null ? -1 : Math.round(gear.height));
    // Each nav label keeps one line and clears the gear.
    for (const link of await page.locator(`.nav-links .nav-link`).all()) {
        if (!(await link.isVisible())) continue;
        const box = await link.boundingBox();
        expect(box === null ? Infinity : box.x + box.width).toBeLessThanOrEqual(gear === null ? 0 : gear.x);
        const lines = await link.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        });
        expect(lines).toBe(1);
    }
    // Past the band's narrow end the labels keep a gap of at least
    // --space-4 between them, so they never read as one phrase.
    if (width >= 520) {
        const edges = await page.locator(`.nav-links .nav-link`).evaluateAll((links) =>
            links.map((link) => {
                const range = document.createRange();
                range.selectNodeContents(link);
                const box = range.getBoundingClientRect();
                return { left: box.left, right: box.right };
            }),
        );
        for (const [index, edge] of edges.entries()) {
            const before = edges[index - 1];
            if (before !== undefined) expect(edge.left - before.right).toBeGreaterThanOrEqual(16);
        }
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
}

for (const visitor of visitors) {
    for (const screen of screens) {
        for (const width of widths) {
            test(`the ${visitor.name} top bar on ${screen.name} fits at ${String(width)} px, its menu shut and open`, async ({ page }) => {
                await page.setViewportSize({ width, height: 800 });
                const look = looks[0];
                if (look === undefined) throw new Error(`no look registered`);
                await wear(page, look);
                await serve(page, world({ me: visitor.me }));
                await page.goto(screen.path);
                await page.locator(`h1`).first().waitFor();
                const signedIn = visitor.me !== null;
                if (signedIn) await page.locator(`header button.identity`).waitFor();
                await barFits(page, width, signedIn);

                // Signed out there is no identity menu, so the gear's panel
                // stands in.
                await (signedIn ? page.locator(`header button.identity`) : page.getByRole(`button`, { name: `Settings`, exact: true })).click();
                const panel = page.locator(`dialog[open]`);
                await expect(panel).toHaveCount(1);
                const header = await page.locator(`header.topbar`).boundingBox();
                const barBottom = (header?.y ?? 0) + (header?.height ?? Infinity);
                // The panel slides in, so its resting box is polled for.
                await expect
                    .poll(async () => {
                        const box = await panel.boundingBox();
                        if (box === null) return `no panel`;
                        if (box.x < 0 || box.x + box.width > width) return `outside the window`;
                        if (width <= 480) return Math.round(box.width) === width ? `in place` : `a sheet short of the width`;
                        return box.y >= barBottom - 1 ? `in place` : `over the bar`;
                    })
                    .toBe(`in place`);
                await barFits(page, width, signedIn);
            });
        }
    }
}

test('on a phone the tabs are the nav entries and Profile opens from the monogram', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/ladder`);
    await page.locator(`h1`).waitFor();
    await expect(page.locator(`nav.tabbar a`)).toHaveText([`Ladder`, `Bots`, `Build a bot`]);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveText(`Ladder`);
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel`).getByRole(`link`, { name: `Profile` }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveCount(0);
    await expect(page.locator(`header button.identity`)).toHaveClass(/\bactive\b/);
});
