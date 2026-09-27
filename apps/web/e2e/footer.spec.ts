import { expect, test } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// A short screen's footer sits at the foot of the window, clear of the
// phone tab strip, rather than under the content wherever it ends.
for (const path of [`/nowhere`, `/game/nope`, `/profile`]) {
    for (const size of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
    ]) {
        test(`the footer of ${path} sits at the foot of the window at ${String(size.width)} px`, async ({ page }) => {
            await page.setViewportSize(size);
            const look = looks[0];
            if (look === undefined) throw new Error(`no look registered`);
            await wear(page, look);
            await serve(page, world({ me: null }));
            await page.goto(path);
            await page.locator(`h1`).waitFor();
            const footer = await page.locator(`footer.site-footer`).boundingBox();
            const tabs = await page.locator(`nav.tabbar`).boundingBox();
            const floor = size.width <= 480 ? (tabs?.y ?? 0) : size.height;
            expect(Math.round((footer?.y ?? 0) + (footer?.height ?? 0))).toBe(Math.round(floor));
            if (size.width <= 480) {
                for (const link of await page.locator(`footer.site-footer a`).all()) {
                    const box = await link.boundingBox();
                    expect(box === null ? 0 : Math.round(box.height)).toBeGreaterThanOrEqual(44);
                }
            }
        });
    }
}
