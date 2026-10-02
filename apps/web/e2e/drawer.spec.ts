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
    { name: `a pinned drawer`, width: 1440, height: 900, storage: { 'hexo-arena.drawer-pinned.v1': `1` } },
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
        // The sheet rises by a transform, which leaves fractions in a box
        // read mid-way, so the row is measured once the sheet is up.
        await page.locator(`#drawer-body`).evaluate(async (body) => {
            await Promise.all(body.getAnimations({ subtree: true }).map(async (animation) => animation.finished));
        });
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

// Large text on a short phone fills the sheet with its head and foot, yet
// every standing and legal link can still be brought into view.
test('every link of the sheet foot comes into view on a 320 by 568 phone at 175 and 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await serve(page, world());
    await page.goto(`/game/long`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    const devtools = await page.context().newCDPSession(page);
    await page.locator(`.sheet-handle`).click();
    await expect(page.locator(`#drawer-body`)).toHaveCSS(`overflow-y`, `auto`);
    for (const size of [28, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (const link of await page.locator(`#drawer-body .drawer-foot a`).all()) {
            // As the keyboard reaches it: focus scrolls the sheet to it.
            await link.focus();
            await expect(link).toBeInViewport({ ratio: 1 });
            const ring = await link.evaluate((element) => {
                const style = getComputedStyle(element);
                const reach = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
                return element.getBoundingClientRect().bottom + reach;
            });
            expect(ring).toBeLessThanOrEqual(568);
        }
    }
});

// Any standing link is two presses from the board: open the drawer, pick
// the link, which opens beside the game rather than over it.
for (const layout of [
    { name: `a drawer`, width: 1280, height: 900, open: `#drawer-toggle` },
    { name: `a phone sheet at half`, width: 390, height: 844, open: `.sheet-handle` },
]) {
    test(`the standing and legal links sit two presses from the board in ${layout.name}, under either tab`, async ({ page, context }) => {
        await page.setViewportSize({ width: layout.width, height: layout.height });
        await serve(page, world());
        await page.goto(`/game/long`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.locator(layout.open).click();
        const foot = page.locator(`#drawer-body .drawer-foot`);
        for (const tab of [`Moves`, `Game`]) {
            await page.getByRole(`tab`, { name: tab }).click();
            for (const name of [
                `Tournaments, opens in a new tab`,
                `Credits, opens in a new tab`,
                `Bot API, opens in a new tab`,
                `Impressum / Legal notice, opens in a new tab`,
                `Privacy, opens in a new tab`,
                `Terms, opens in a new tab`,
                `Licenses, opens in a new tab`,
            ]) {
                await expect(foot.getByRole(`link`, { name })).toBeInViewport({ ratio: 1 });
            }
        }
        // The legal links are small print, two to a row.
        const legal = await foot.locator(`.legal-links a`).evaluateAll((links) =>
            links.map((link) => {
                const style = getComputedStyle(link);
                const probe = document.createElement(`span`);
                probe.style.color = `var(--c-text-dim)`;
                link.after(probe);
                const dim = getComputedStyle(probe).color;
                probe.remove();
                const box = link.getBoundingClientRect();
                return { dim: style.color === dim, weight: style.fontWeight, left: Math.round(box.left), top: Math.round(box.top) };
            }),
        );
        expect(legal.every((link) => link.dim && link.weight === `400`)).toBe(true);
        expect(legal.map((link) => link.left)).toEqual(legal.map((_link, index) => legal[index % 2]?.left));
        expect(legal.map((link) => link.top)).toEqual(legal.map((_link, index) => legal[index - (index % 2)]?.top));
        expect(legal[2]?.top).toBeGreaterThan(legal[0]?.top ?? Infinity);
        // The new tab has no mocked world; its reads stop at the browser.
        await context.route((url) => url.pathname.startsWith(`/api/`) || url.pathname === `/healthz`, (route) => route.abort());
        const opened = context.waitForEvent(`page`);
        await foot.getByRole(`link`, { name: `Credits, opens in a new tab` }).click();
        const credits = await opened;
        await credits.waitForLoadState();
        expect(new URL(credits.url()).pathname).toBe(`/credits`);
        const openedNotice = context.waitForEvent(`page`);
        await foot.getByRole(`link`, { name: `Impressum / Legal notice, opens in a new tab` }).click();
        const notice = await openedNotice;
        await notice.waitForLoadState();
        expect(new URL(notice.url()).pathname).toBe(`/legal/imprint`);
        expect(new URL(page.url()).pathname).toBe(`/game/long`);
    });
}

// Large text on a narrow phone leaves no room for two legal labels side by
// side, so they stand one to a row and none runs past the window.
test('the drawer foot keeps every link inside a 320 px phone at 175 and 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await serve(page, world());
    await page.goto(`/game/long`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    const devtools = await page.context().newCDPSession(page);
    for (const size of [28, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        if ((await page.locator(`#drawer-body:not([hidden])`).count()) === 0) await page.locator(`.sheet-handle`).click();
        const foot = page.locator(`#drawer-body .drawer-foot`);
        await foot.waitFor();
        const rights = await foot.locator(`a`).evaluateAll((links) => links.map((link) => link.getBoundingClientRect().right));
        expect(rights.length).toBe(8);
        for (const right of rights) expect(right).toBeLessThanOrEqual(320);
    }
});

// A refused resignation says so where the reader is looking, at every width.
for (const [width, height] of [[390, 844], [360, 740], [1280, 900]] as const) {
    test(`a refused resignation shows its line inside the drawer at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await serve(page, world({ limited: `writes` }));
        await page.goto(`/game/running`);
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.keyboard.press(`m`);
        await page.getByRole(`tab`, { name: `Game` }).click();
        await page.getByRole(`button`, { name: `Resign` }).click();
        await page.getByRole(`button`, { name: `Resign and lose` }).click();
        const alert = page.locator(`#drawer-body [role="alert"]`);
        await expect(alert.locator(`.sr-only`)).toHaveText(`Too many tries; try again in 42 s`);
        // The button keeps focus through the refusal and the wait, so the keyboard stays where it was;
        // it is read once the refusal is shown, and again later, so a late blur cannot pass unseen.
        const resign = page.getByRole(`button`, { name: `Resign` });
        await expect(resign).toBeFocused();
        await page.waitForTimeout(2_000);
        await expect(resign).toBeFocused();
        await expect
            .poll(async () => {
                const line = await alert.boundingBox();
                const panel = await page.locator(`.drawer-panel`).boundingBox();
                return line !== null && panel !== null && line.y >= panel.y && line.y + line.height <= panel.y + panel.height;
            })
            .toBe(true);
    });
}
