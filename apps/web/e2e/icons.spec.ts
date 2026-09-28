import { expect, test } from '@playwright/test';
import { serve, world } from './mock-api';

// A browser asks for /favicon.ico whatever the page links, so it answers
// with the icon itself; the page links the svg for browsers that take it,
// the ico at 32 px so they prefer the svg, and the touch icon.
test(`the site answers for its icons and its page links them`, async ({ page }) => {
    const ico = await page.request.get(`/favicon.ico`);
    expect(ico.status()).toBe(200);
    expect([...(await ico.body()).subarray(0, 4)]).toEqual([0, 0, 1, 0]);
    const svg = await page.request.get(`/favicon.svg`);
    expect(svg.headers()[`content-type`]).toContain(`image/svg+xml`);
    for (const path of [`/apple-touch-icon.png`, `/icon-512.png`]) {
        const png = await page.request.get(path);
        expect(png.status()).toBe(200);
        expect((await png.body()).subarray(1, 4).toString(`latin1`)).toBe(`PNG`);
    }

    await serve(page, world());
    await page.goto(`/ladder`);
    const links = await page.locator(`head link[rel="icon"], head link[rel="apple-touch-icon"]`).evaluateAll((elements) =>
        elements.map((element) => [element.getAttribute(`rel`), element.getAttribute(`href`), element.getAttribute(`sizes`), element.getAttribute(`type`)]),
    );
    expect(links).toEqual([
        [`icon`, `/favicon.ico`, `32x32`, null],
        [`icon`, `/favicon.svg`, null, `image/svg+xml`],
        [`apple-touch-icon`, `/apple-touch-icon.png`, null, null],
    ]);
});
