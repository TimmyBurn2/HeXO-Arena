import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, tournaments, world } from './mock-api';

async function open(page: Page, path: string, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ tournaments: tournaments() }));
    await page.goto(path);
}

test('a human name on the ladder opens their player page, with no owner panel', async ({ page }) => {
    await open(page, `/ladder`);
    await page.getByRole(`link`, { name: `ana`, exact: true }).first().click();
    await expect(page).toHaveURL(/\/players\/ana$/u);
    await expect(page.getByRole(`heading`, { level: 1, name: `ana` })).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `Record` })).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `Most played` })).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `Tournaments`, exact: true })).toHaveCount(0);
    await expect(page.locator(`.owner-panel`)).toHaveCount(0);
});

test('the crosshair snaps to a game and a click opens it', async ({ page }) => {
    await open(page, `/players/ana`);
    const box = await page.locator(`.rating-chart-box`).boundingBox();
    if (box === null) throw new Error(`the chart drew no box`);
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page.locator(`.rating-chart-tip strong`)).toHaveText(`1402`);
    await expect(page.locator(`.rating-chart-tip`)).toContainText(`band 1354 to 1450`);
    await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
    await expect(page).toHaveURL(/\/game\/g-rated-40$/u);
});

test('arrow keys walk the chart, the readout follows, and Enter opens the game', async ({ page }) => {
    await open(page, `/players/ana`);
    const chart = page.getByRole(`group`, { name: /^Rating chart, 40 rated games, now 1402/u });
    await chart.focus();
    await page.keyboard.press(`End`);
    await expect(page.getByRole(`status`).filter({ hasText: /^1402, band 1354 to 1450/u })).toBeAttached();
    await page.keyboard.press(`Home`);
    await expect(page.getByRole(`status`).filter({ hasText: /^1500, band 1150 to 1850, .*, provisional$/u })).toBeAttached();
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await expect(page).toHaveURL(/\/game\/g-rated-2$/u);
});

test.describe('on a touch screen', () => {
    test.use({ hasTouch: true });

    test('a tap holds a game with its tip, and a second tap opens it', async ({ page }) => {
        await open(page, `/players/ana`, 390);
        const box = await page.locator(`.rating-chart-box`).boundingBox();
        if (box === null) throw new Error(`the chart drew no box`);
        await page.touchscreen.tap(box.x + box.width - 2, box.y + box.height / 2);
        await expect(page.locator(`.rating-chart-tip`)).toContainText(`tap again to open the game`);
        await expect(page).toHaveURL(/\/players\/ana$/u);
        await page.touchscreen.tap(box.x + box.width - 2, box.y + box.height / 2);
        await expect(page).toHaveURL(/\/game\/g-rated-40$/u);
    });
});

test('the period buttons read the history again for their range', async ({ page }) => {
    await open(page, `/players/ana`);
    await expect(page.getByRole(`button`, { name: `1 year` })).toHaveAttribute(`aria-pressed`, `true`);
    const read = page.waitForRequest((request) => request.url().endsWith(`/api/players/ana/rating?range=30d`));
    await page.getByRole(`button`, { name: `30 days` }).click();
    await read;
    await expect(page.getByRole(`group`, { name: /^Rating chart, 12 rated games/u })).toBeVisible();
});

for (const width of [1280, 390]) {
    test(`a bot page lists the tournaments it entered, where it stands in each, dated as every list dates them, each leading to its page, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/bots/hextide`, width);
        const block = page.locator(`section`, { has: page.getByRole(`heading`, { name: `Tournaments`, exact: true }) });
        await expect(block.locator(`.place-row`)).toHaveText([
            /^Autumn round robinrated4th so far, 0 pointsRound 2 of 3$/u,
            /^Winter cupratedEntered; starts in \d+ h \d+ min$/u,
            /^Summer cuprated2nd of 4, 3 points\d+ days? ago$/u,
            /^Rain cupratedCalled off(\d+ h|\d+ days?) ago$/u,
        ]);
        await expect(page.getByRole(`heading`, { name: `Tournaments`, exact: true })).toHaveCount(1);
        await expect(block.getByRole(`link`, { name: `All tournaments` })).toHaveAttribute(`href`, `/games/tournaments?bot=hextide`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await block.getByRole(`link`, { name: /^Summer cup/u }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_summercup202$/u);
    });
}

test('a bot that entered no tournament shows no tournaments block', async ({ page }) => {
    await open(page, `/bots/quietlake`);
    await expect(page.getByRole(`heading`, { name: `Rating` })).toBeVisible();
    await expect(page.locator(`.bot-duels`)).toHaveCount(0);
});

test('a name no player holds reads as missing', async ({ page }) => {
    await open(page, `/players/nobody`);
    await expect(page.getByRole(`heading`, { name: `No player named nobody` })).toBeVisible();
    await expect(page).toHaveTitle(/not found/iu);
});
