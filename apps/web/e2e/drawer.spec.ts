import { expect, test } from '@playwright/test';
import { serve, world } from './mock-api';

// Below the pinnable width an open drawer takes its own column, so no
// stone and no chip hides under it, and the chips never pile on each other.
for (const game of [`running`, `finished`, `nine-finished`]) {
    test(`an open drawer at tablet width keeps every stone and chip of ${game} clear and apart`, async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        await serve(page, world());
        await page.goto(`/game/${game}`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.keyboard.press(`m`);
        const drawer = page.locator(`#drawer-body`);
        await expect(drawer).toBeVisible();
        const edge = (await drawer.boundingBox())?.x ?? 0;
        expect(edge).toBeGreaterThan(0);
        // The camera refits once the column has laid out, so the check polls.
        await expect
            .poll(() =>
                page.evaluate(() =>
                    Math.max(
                        ...[...document.querySelectorAll(`g.stone, .hud-chip`)].map(
                            (element) => element.getBoundingClientRect().right,
                        ),
                    ),
                ),
            )
            .toBeLessThanOrEqual(edge + 1);
        const chips = await page.evaluate(() =>
            [...document.querySelectorAll(`.hud-lift`)].map((element) => {
                const { left, right, top, bottom } = element.getBoundingClientRect();
                return { left, right, top, bottom };
            }),
        );
        for (const [index, a] of chips.entries()) {
            for (const b of chips.slice(index + 1)) {
                const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
                expect(apart, JSON.stringify([a, b])).toBe(true);
            }
        }
    });
}

// A feed longer than the viewport scrolls inside the drawer's panel, so the
// newest line and the turn chip stay on screen whether the drawer takes a
// column at tablet width or is pinned on a wide screen.
for (const layout of [
    { name: `a tablet column`, width: 768, height: 1024, storage: {} },
    { name: `a pinned drawer`, width: 1440, height: 900, storage: { 'hexarena.drawer-pinned.v1': `1` } },
]) {
    test(`a long game keeps its newest line and turn chip in view in ${layout.name}`, async ({ page }) => {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await page.addInitScript((entries: Record<string, string>) => {
            for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
        }, layout.storage);
        await serve(page, world({ me: null }));
        await page.goto(`/game/long`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        if (layout.width < 1440) await page.keyboard.press(`m`);
        await expect(page.locator(`#drawer-body`)).toBeVisible();
        for (const selector of [`.feed-line.latest`, `.hud-bottom-center`]) {
            await expect
                .poll(() => page.locator(selector).evaluate((element) => element.getBoundingClientRect().bottom))
                .toBeLessThanOrEqual(layout.height);
        }
        expect(await page.evaluate(() => document.querySelector(`.stage`)?.getBoundingClientRect().height)).toBe(layout.height);
    });
}

// On a phone the sheet stands in for the drawer: its half state reaches
// both tabs, and the Moves header's switches keep a finger's target.
for (const who of [{ name: `seated`, me: undefined }, { name: `watching`, me: null }] as const) {
    test(`the phone sheet reaches Moves with its aids and Game, ${who.name}`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await serve(page, who.me === undefined ? world() : world({ me: who.me }));
        await page.goto(`/game/running`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.getByRole(`button`, { name: `Open the game panel` }).click();
        await expect(page.getByRole(`tab`)).toHaveText([`Moves`, `Game`]);
        const numbers = page.getByRole(`switch`, { name: `Stone numbers` });
        await expect(numbers).toBeVisible();
        const row = await page.locator(`.moves-head .checkline`).first().boundingBox();
        expect(row === null ? 0 : row.height).toBeGreaterThanOrEqual(44);
        await page.locator(`.moves-head .checkline`).first().click();
        await expect(numbers).toBeChecked();
        await expect(page.locator(`.board-frame`)).toHaveAttribute(`data-numbers`, ``);
        await page.getByRole(`tab`, { name: `Game` }).click();
        await expect(page.getByRole(`tabpanel`)).toContainText(`Clock`);
        await page.getByRole(`tab`, { name: `Game` }).press(`ArrowLeft`);
        await expect(page.getByRole(`tab`, { name: `Moves` })).toHaveAttribute(`aria-selected`, `true`);
    });
}

// Any standing link is two presses from the board: open the drawer, pick
// the link, which opens beside the game rather than over it.
for (const layout of [
    { name: `a drawer`, width: 1280, height: 900, open: `#drawer-toggle` },
    { name: `a phone sheet at half`, width: 390, height: 844, open: `.sheet-handle` },
]) {
    test(`the standing links sit two presses from the board in ${layout.name}, under either tab`, async ({ page, context }) => {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await serve(page, world());
        await page.goto(`/game/long`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.locator(layout.open).click();
        const foot = page.locator(`#drawer-body .drawer-foot`);
        for (const tab of [`Moves`, `Game`]) {
            await page.getByRole(`tab`, { name: tab }).click();
            for (const name of [`Credits, opens in a new tab`, `Bot API, opens in a new tab`]) {
                await expect(foot.getByRole(`link`, { name })).toBeInViewport({ ratio: 1 });
            }
        }
        // The new tab has no mocked world; its reads stop at the browser.
        await context.route((url) => url.pathname.startsWith(`/api/`) || url.pathname === `/healthz`, (route) => route.abort());
        const opened = context.waitForEvent(`page`);
        await foot.getByRole(`link`, { name: `Credits, opens in a new tab` }).click();
        const credits = await opened;
        await credits.waitForLoadState();
        expect(new URL(credits.url()).pathname).toBe(`/credits`);
        expect(new URL(page.url()).pathname).toBe(`/game/long`);
    });
}
