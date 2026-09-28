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

// The name and the tagline wrap as units: the footer keeps one line while
// it fits, breaks after the comma first once text is scaled up, and each
// span still wraps inside itself at the largest sizes.
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
    expect(tagline?.top).toBe(name?.top);
    const devtools = await page.context().newCDPSession(page);
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 20 } });
    const [largerName, largerTagline] = await lines();
    expect(largerName?.lines).toBe(1);
    expect(largerTagline?.top ?? 0).toBeGreaterThan(largerName?.top ?? 0);
    await page.setViewportSize({ width: 390, height: 700 });
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 32 } });
    for (const span of await lines()) expect(span.right).toBeLessThanOrEqual(390);
});

// Scaled-up text on a narrow window must not leave one word of the tagline
// on a line of its own.
test('the footer tagline never ends on a lone word from 320 to 1280 px at 100, 150, and 200% text', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.setViewportSize({ width: 1280, height: 700 });
    await page.goto(`/nowhere`);
    await page.locator(`h1`).waitFor();
    const devtools = await page.context().newCDPSession(page);
    const lone: string[] = [];
    for (const size of [16, 24, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (let width = 320; width <= 1280; width += 10) {
            await page.setViewportSize({ width, height: 700 });
            const last = await page.locator(`.site-tagline span`).nth(1).evaluate((span) => {
                const words: { word: string; top: number }[] = [];
                const node = span.firstChild;
                if (node === null) return { lines: 0, words: `` };
                let at = 0;
                for (const word of (node.textContent ?? ``).split(` `)) {
                    const range = document.createRange();
                    range.setStart(node, at);
                    range.setEnd(node, at + word.length);
                    words.push({ word, top: Math.round(range.getBoundingClientRect().top) });
                    at += word.length + 1;
                }
                const tops = [...new Set(words.map((entry) => entry.top))];
                const bottom = Math.max(...tops);
                return { lines: tops.length, words: words.filter((entry) => entry.top === bottom).map((entry) => entry.word).join(` `) };
            });
            if (last.lines > 1 && !last.words.includes(` `)) lone.push(`${String(size)} px text at ${String(width)} px: ${last.words}`);
        }
    }
    expect(lone).toEqual([]);
});
