import { expect, test } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// The six theme tiles share one row on a wide page and split three and
// three at 40rem and below, never five and one.
for (const [width, rows] of [
    [1280, [6]],
    [768, [6]],
    [656, [6]],
    [640, [3, 3]],
    [390, [3, 3]],
    [320, [3, 3]],
] as const) {
    test(`the theme tiles on credits sit in rows of ${rows.join(` and `)} at ${String(width)} px`, async ({ page }) => {
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await page.setViewportSize({ width, height: 900 });
        await wear(page, look);
        await serve(page, world());
        await page.goto(`/credits`);
        await page.locator(`.theme-tile`).first().waitFor();
        const tops = await page.locator(`.theme-tile`).evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)));
        const counts = [...new Set(tops)].map((top) => tops.filter((each) => each === top).length);
        expect(counts).toEqual([...rows]);
    });
}
