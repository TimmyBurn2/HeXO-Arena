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

// The name and the tagline wrap as units, so a narrow window breaks after
// the comma, and each still wraps inside itself when text is scaled up.
test('the footer tagline breaks after the comma and wraps at large text', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    const spans = page.locator(`.site-tagline span`);
    const lines = () =>
        spans.evaluateAll((elements) =>
            elements.map((element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
                const box = range.getBoundingClientRect();
                return { lines: new Set(tops).size, top: Math.round(box.top), right: box.right };
            }),
        );
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(`/nowhere`);
    await page.locator(`h1`).waitFor();
    const [name, tagline] = await lines();
    expect([name?.lines, tagline?.lines]).toEqual([1, 1]);
    expect(tagline?.top ?? 0).toBeGreaterThan(name?.top ?? 0);
    await page.setViewportSize({ width: 390, height: 700 });
    const wide = await lines();
    expect(wide[1]?.top).toBe(wide[0]?.top);
    const devtools = await page.context().newCDPSession(page);
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 32 } });
    for (const span of await lines()) expect(span.right).toBeLessThanOrEqual(390);
});
