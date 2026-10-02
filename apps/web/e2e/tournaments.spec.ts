import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, tournaments, world } from './mock-api';

async function open(page: Page, path: string, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ tournaments }));
    await page.goto(path);
}

test('an owner enters a bot in a waiting tournament and withdraws it', async ({ page }) => {
    await open(page, `/tournaments/t_wintercup202`);
    await expect(page.getByRole(`heading`, { name: `Entered (2 of 12)` })).toBeVisible();
    await page.getByLabel(`Your bot`).selectOption(`quietlake`);
    await page.getByRole(`button`, { name: `Enter`, exact: true }).click();
    await expect(page.getByText(`quietlake is entered.`)).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `Entered (3 of 12)` })).toBeVisible();
    await page.getByRole(`button`, { name: `Withdraw` }).click();
    await expect(page.getByRole(`heading`, { name: `Entered (2 of 12)` })).toBeVisible();
});

test('the ladder and the tournaments lead to each other from the head', async ({ page }) => {
    await open(page, `/ladder`);
    await page.getByRole(`navigation`, { name: `Ladder and tournaments` }).getByRole(`link`, { name: `Tournaments` }).click();
    await expect(page).toHaveURL(/\/tournaments$/u);
    await expect(page.getByRole(`link`, { name: `Tournaments` })).toHaveAttribute(`aria-current`, `page`);
    await page.getByRole(`link`, { name: `Autumn round robin` }).click();
    await expect(page.getByText(`Round 2 of 3 is live.`)).toBeVisible();
    await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Ladder` })).toHaveAttribute(`aria-current`, `page`);
});

test('the crosstable scrolls inside its frame on a phone, the names held in place', async ({ page }) => {
    await open(page, `/tournaments/t_autumnrobin1`, 360);
    const frame = page.locator(`.xt-frame`);
    await frame.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
    });
    const name = await page.locator(`.xt tbody .xt-name`).first().boundingBox();
    const box = await frame.boundingBox();
    expect(Math.abs((name?.x ?? 0) - (box?.x ?? 0))).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a standings row opens its pairings from a 44 px target on a phone', async ({ page }) => {
    await open(page, `/tournaments/t_autumnrobin1`, 390);
    const box = await page.getByRole(`button`, { name: /^Pairings of /u }).first().boundingBox();
    expect(Math.round(box?.width ?? 0)).toBeGreaterThanOrEqual(44);
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(44);
});
