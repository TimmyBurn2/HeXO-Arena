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
