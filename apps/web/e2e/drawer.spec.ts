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
