import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

async function open(page: Page, path: string, width: number, height: number): Promise<void> {
    await page.setViewportSize({ width, height });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(path);
    await page.locator(`.hud-rundown .rundown-expected`).first().waitFor();
}

// The highest of the elements a selector finds on the board.
async function topOf(page: Page, selector: string): Promise<number> {
    const tops = await page.locator(selector).evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
    return Math.min(...tops);
}

// Where the whole board fits, the frontier stays clear too; a phone's
// board is larger than the screen and scrolls under every overlay, so
// there the stones are what the camera keeps clear.
for (const [width, height, kept] of [
    [1280, 900, `g.stone, path.frontier`],
    [768, 1024, `g.stone, path.frontier`],
    [390, 844, `g.stone`],
    [360, 640, `g.stone`],
] as const) {
    test(`the rundown stands clear of the position before the first turn at ${String(width)} by ${String(height)}`, async ({ page }) => {
        await open(page, `/game/fresh-yours`, width, height);
        const card = await page.locator(`.hud-rundown`).boundingBox();
        expect(await topOf(page, kept)).toBeGreaterThanOrEqual((card?.y ?? 0) + (card?.height ?? 0));
        await expect(page.locator(`.hud-rundown`)).toContainText(`sealbot`);
    });
}

test('the first turn plays from the keyboard under the rundown, which then leaves the board for the Game tab', async ({ page }) => {
    await open(page, `/game/fresh-yours`, 1280, 900);
    const board = page.getByRole(`application`);
    await board.focus();
    const sent = page.waitForRequest((request) => request.url().endsWith(`/api/games/fresh-yours/move`));
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await sent;
    await expect(page.locator(`.hud-rundown`)).toHaveCount(0);
    await page.keyboard.press(`m`);
    await page.getByRole(`tab`, { name: `Game` }).click();
    await expect(page.locator(`#drawer-panel-game`).getByRole(`region`, { name: `Rundown` })).toBeVisible();
});

test('the rundown hides on request and the camera takes the room back', async ({ page }) => {
    await open(page, `/game/fresh`, 1280, 900);
    const before = await topOf(page, `g.stone`);
    await page.getByRole(`button`, { name: `Hide the rundown` }).click();
    await expect(page.locator(`.hud-rundown`)).toHaveCount(0);
    await expect.poll(() => topOf(page, `g.stone`)).toBeLessThan(before);
});

test('Hide hands the keyboard back to the board, so the first turn still plays from the keys', async ({ page }) => {
    await open(page, `/game/fresh-yours`, 1280, 900);
    await page.getByRole(`button`, { name: `Hide the rundown` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.hud-rundown`)).toHaveCount(0);
    await expect(page.getByRole(`application`)).toBeFocused();
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
});

// Large text grows the card past the room the board needs, so there it
// leaves the stage and stays on the Game tab.
for (const [size, width, height] of [
    [24, 390, 844],
    [32, 390, 844],
    [24, 1280, 900],
    [32, 1280, 900],
] as const) {
    test(`at ${String((size / 16) * 100)}% text on ${String(width)} px the rundown never covers a stone`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world());
        const devtools = await page.context().newCDPSession(page);
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        await page.goto(`/game/fresh-yours`);
        await page.locator(`g.stone`).first().waitFor();
        await page.waitForTimeout(500);
        const cards = page.locator(`.hud-rundown`);
        if ((await cards.count()) > 0) {
            const card = await cards.boundingBox();
            expect(await topOf(page, `g.stone`)).toBeGreaterThanOrEqual((card?.y ?? 0) + (card?.height ?? 0));
            return;
        }
        await page.keyboard.press(`m`);
        await page.getByRole(`tab`, { name: `Game` }).click();
        await expect(page.locator(`#drawer-panel-game`).getByRole(`region`, { name: `Rundown` })).toBeVisible();
    });
}

