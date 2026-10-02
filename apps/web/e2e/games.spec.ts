import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { recentGames, rivalry, serve, world } from './mock-api';

async function open(page: Page, path: string, width: number): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ finished: rivalry(60) }));
    await page.goto(path);
    await page.locator(`.game-row`).first().waitFor();
}

const search = (page: Page) => new URL(page.url()).search;

test('a name applies when its field is left, and Back returns to the list before it', async ({ page }) => {
    await open(page, `/games`, 1280);
    await page.getByLabel(`Player`).fill(`quietlake`);
    expect(search(page)).toBe(``);
    await page.keyboard.press(`Tab`);
    await expect.poll(() => search(page)).toBe(`?player=quietlake`);
    await expect(page.getByRole(`button`, { name: `Remove quietlake` })).toBeVisible();
    await page.getByRole(`button`, { name: `Filters`, exact: true }).click();
    const panel = page.locator(`dialog.games-panel[open]`);
    await panel.getByLabel(`Against`).fill(`hextide`);
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.games-h2h`)).toContainText(`quietlake`);
    await page.keyboard.press(`Escape`);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Filters (1)` })).toBeFocused();
    await page.goBack();
    await expect.poll(() => search(page)).toBe(`?player=quietlake`);
    await expect(page.locator(`.games-h2h`)).toHaveCount(0);
});

test('on a wide window the filters hang under their button and leave the list live behind them', async ({ page }) => {
    await open(page, `/games?player=hextide`, 1280);
    const button = page.getByRole(`button`, { name: `Filters`, exact: true });
    await button.click();
    const panel = page.locator(`dialog.games-panel[open]`);
    await expect(panel).toHaveAttribute(`data-mode`, `popover`);
    await expect(panel.getByLabel(`Against`)).toBeFocused();
    const [under, box] = await Promise.all([button.boundingBox(), panel.boundingBox()]);
    expect((box?.y ?? 0) > (under?.y ?? 0) + (under?.height ?? 0) - 1).toBe(true);
    await panel.getByLabel(`Clock`).selectOption(`unlimited`);
    await expect.poll(() => search(page)).toBe(`?player=hextide&clock=unlimited`);
    await expect(page.locator(`.game-row`).first()).toContainText(`unlimited`);
    await page.locator(`.games-note`).click();
    await expect(panel).toHaveCount(0);
});

test('on a phone the filters open in a sheet that applies each change at once and closes on the list', async ({ page }) => {
    await open(page, `/games?player=hextide`, 390);
    await expect(page.getByLabel(`Player`)).toHaveValue(`hextide`);
    const button = page.getByRole(`button`, { name: `Filters`, exact: true });
    await button.click();
    const sheet = page.locator(`dialog.games-panel[open]`);
    await expect(sheet).toHaveAttribute(`data-mode`, `sheet`);
    await expect(sheet.getByLabel(`Against`)).toBeFocused();
    await sheet.getByLabel(`Clock`).selectOption(`unlimited`);
    await expect.poll(() => search(page)).toBe(`?player=hextide&clock=unlimited`);
    await sheet.getByRole(`button`, { name: `Show games` }).click();
    await expect(sheet).toHaveCount(0);
    const counted = page.getByRole(`button`, { name: `Filters (1)` });
    await expect(counted).toBeFocused();
    await expect(page.locator(`.game-row`).first()).toContainText(`unlimited`);
});

test('the rows line up in columns on a wide window and stack as cards on a phone', async ({ page }) => {
    await open(page, `/games`, 1280);
    const firstRow = page.locator(`.game-row`).first();
    const head = page.locator(`.game-rows-head`);
    await expect(head).toBeVisible();
    const [headBox, whenBox] = await Promise.all([head.locator(`span`).last().boundingBox(), firstRow.locator(`.game-row-when`).boundingBox()]);
    expect(Math.round((headBox?.x ?? 0) + (headBox?.width ?? 0))).toBe(Math.round((whenBox?.x ?? 1) + (whenBox?.width ?? 0)));
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(head).toBeHidden();
    const [seats, when] = await Promise.all([firstRow.locator(`.game-row-seats`).boundingBox(), firstRow.locator(`.game-row-when`).boundingBox()]);
    // The time sits at the card's top right, level with the seats.
    expect(Math.abs((seats?.y ?? 0) - (when?.y ?? 99))).toBeLessThan(8);
});

test('a page turned by its links takes the keyboard to its list, at the top of the window', async ({ page }) => {
    await open(page, `/games`, 1280);
    await expect(page.getByText(`Page 1 of 3; 60 games`)).toBeVisible();
    await page.getByRole(`link`, { name: `Next` }).focus();
    await page.keyboard.press(`Enter`);
    const second = page.getByRole(`list`, { name: `Games, page 2` });
    await expect(second).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await page.getByRole(`link`, { name: `Page 3` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`list`, { name: `Games, page 3` })).toBeFocused();
    expect(search(page)).toBe(`?page=3`);
    await page.getByRole(`link`, { name: `Page 1` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`list`, { name: `Games, page 1` })).toBeFocused();
    await page.keyboard.press(`Tab`);
    await expect(page.locator(`.game-row`).first()).toBeFocused();
});

test('past 200 games Pick a date opens the filters on a wide window, the keyboard in Before', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ finished: rivalry(230) }));
    await page.goto(`/games?player=hextide&page=10`);
    await page.getByRole(`button`, { name: `Pick a date` }).click();
    const panel = page.locator(`dialog.games-panel[open]`);
    await expect(panel).toHaveAttribute(`data-mode`, `popover`);
    await expect(panel.getByLabel(`Before`)).toBeFocused();
});

test('a page number answers the pointer as the other page links do', async ({ page }) => {
    await open(page, `/games`, 1280);
    const number = page.getByRole(`link`, { name: `Page 2` });
    const resting = await number.evaluate((element) => getComputedStyle(element).backgroundColor);
    await number.hover();
    await expect.poll(() => number.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(resting);
});


test('the list narrows to games analyzers have read, and each row counts its analyses', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const finished = recentGames.map((entry, index) => ({ ...entry, analyses: index === 1 ? 2 : index === 3 ? 1 : 0 }));
    await serve(page, world({ finished }));
    await page.goto(`/games`);
    await page.locator(`.game-row`).first().waitFor();
    await expect(page.locator(`.game-row-result .tag`, { hasText: /analys/u })).toHaveText([`2 analyses`, `1 analysis`]);
    await page.getByRole(`button`, { name: `Filters`, exact: true }).click();
    const panel = page.locator(`dialog.games-panel[open]`);
    await panel.getByLabel(`Analysis`).selectOption(`Analyzed`);
    await expect.poll(() => search(page)).toBe(`?analyzed=1`);
    await expect(page.locator(`.game-row`)).toHaveCount(2);
    await page.keyboard.press(`Escape`);
    await page.getByRole(`button`, { name: `Remove analyzed` }).click();
    await expect.poll(() => search(page)).toBe(``);
    await expect(page.locator(`.game-row`)).toHaveCount(finished.length);
});
