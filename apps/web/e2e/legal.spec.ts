import { expect, test } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

test('a link to a section of another legal page lands on that section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.goto(`/legal/imprint`);
    await page.getByRole(`link`, { name: `Reporting` }).click();
    await expect(page).toHaveURL(/\/legal\/terms#reporting$/);
    const heading = page.getByRole(`heading`, { level: 2, name: `Reporting` });
    await expect(heading).toBeInViewport();
    const top = await heading.evaluate((element) => element.getBoundingClientRect().top);
    expect(top).toBeLessThan(844 / 2);
});

// Each page loads once; the list reflows in place as the window and the
// text size change, which keeps the sweep far inside the test budget.
for (const path of [`/legal/privacy`, `/legal/terms`]) {
    test(`no entry of the contents of ${path} ends on a word of its own on a phone, at 100, 150, and 200% text`, async ({ page }) => {
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world({ me: null }));
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto(path);
        const contents = page.getByRole(`navigation`, { name: `On this page` });
        await contents.locator(`a`).first().waitFor();
        const devtools = await page.context().newCDPSession(page);
        const lone: string[] = [];
        for (const size of [16, 24, 32]) {
            await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
            for (const width of [320, 360, 390]) {
                await page.setViewportSize({ width, height: 800 });
                const entries = await contents.locator(`a`).evaluateAll((links) =>
                    links.map((link) => {
                        const node = link.firstChild;
                        const bottoms: number[] = [];
                        let at = 0;
                        for (const word of (node?.textContent ?? ``).split(` `)) {
                            const range = document.createRange();
                            if (node !== null) {
                                range.setStart(node, at);
                                range.setEnd(node, at + word.length);
                            }
                            bottoms.push(Math.round(range.getBoundingClientRect().bottom));
                            at += word.length + 1;
                        }
                        const last = Math.max(...bottoms);
                        return { label: link.textContent, lines: new Set(bottoms).size, words: bottoms.filter((bottom) => bottom === last).length };
                    }),
                );
                for (const entry of entries) {
                    if (entry.lines > 1 && entry.words < 2) lone.push(`${String(width)} px, ${String(size)} px text: ${entry.label}`);
                }
            }
        }
        expect(lone).toEqual([]);
    });
}

test('the contents of a long page stay beside the text as it scrolls on a wide window', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.goto(`/legal/privacy`);
    const contents = page.getByRole(`navigation`, { name: `On this page` });
    await page.getByRole(`link`, { name: `Do you have to provide data?` }).click();
    await expect(page.getByRole(`heading`, { level: 2, name: `Do you have to provide data?` })).toBeInViewport();
    await expect(contents).toBeInViewport();
    const text = await page.locator(`.legal-text`).boundingBox();
    const box = await contents.boundingBox();
    expect(box === null || text === null ? -1 : box.x).toBeGreaterThanOrEqual(text === null ? Infinity : text.x + text.width);
});

test('the licenses link opens the third-party licenses as plain text, the font included', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.goto(`/legal/terms`);
    await page.locator(`footer.site-footer`).getByRole(`link`, { name: `Licenses` }).click();
    await expect(page).toHaveURL(/\/third-party-licenses\.txt$/);
    const text = await page.locator(`body`).innerText();
    expect(text.startsWith(`# Licenses`)).toBe(true);
    expect(text).toContain(`## react - `);
    expect(text).toContain(`## Chakra Petch (OFL-1.1)`);
});

test('a legal document the deployment lacks leaves no link in the footer or the sign-in line, and its page is not found', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null, legalMissing: [`imprint`, `privacy`] }));
    await page.goto(`/connect`);
    const legal = page.locator(`footer.site-footer .legal-links`);
    await expect(legal).toHaveText(`TermsLicenses`);
    await expect(page.locator(`.discord-sign-in .note`).first()).toHaveText(`Your email stays with Discord, and a first sign-in asks for your public name.`);
    await page.goto(`/legal/imprint`);
    await expect(page.getByRole(`heading`, { level: 1, name: `Not found` })).toBeVisible();
    await expect(page).toHaveTitle(`Not found - HeXO Arena`);
});
