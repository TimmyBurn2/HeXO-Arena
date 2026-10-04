import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { duelGameRows, keptNames, recentGames, rivalry, serve, tournamentGameRows, world } from './mock-api';

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

for (const width of [1280, 390]) {
    test(`a game of a tournament or a duel names it under the result, a link of its own to its page, at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world({ finished: [...tournamentGameRows, ...duelGameRows, ...keptNames] }));
        await page.goto(`/games`);
        const caption = page.getByRole(`link`, { name: `Autumn round robin, round 2, game 1 of 2` });
        const item = page.locator(`.game-row-evented`).first();
        const row = item.locator(`.game-row`);
        const [itemBox, rowBox, captionBox, resultBox] = await Promise.all([item.boundingBox(), row.boundingBox(), caption.boundingBox(), row.locator(`.game-row-result`).boundingBox()]);
        if (itemBox === null || rowBox === null || captionBox === null || resultBox === null) throw new Error(`a row drew no box`);
        expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(itemBox.y + itemBox.height);
        if (width >= 832) {
            // Laid over the row on the room it keeps under the result, the caption still takes the pointer.
            const room = await row.locator(`.game-row-event-space`).boundingBox();
            if (room === null) throw new Error(`the row kept no room for its caption`);
            expect([Math.round(captionBox.x - room.x), Math.round(captionBox.y - room.y), Math.round(captionBox.height - room.height)]).toEqual([0, 0, 0]);
            expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height);
        } else {
            // A card's caption takes a line under the card, lined up with its result.
            expect(captionBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height - 1);
            expect(Math.abs(captionBox.x - resultBox.x)).toBeLessThanOrEqual(1);
        }
        await expect(page.getByRole(`link`, { name: `Duel, game 3 of 10` })).toHaveAttribute(`href`, /^\/duels\/d_/u);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await caption.click();
        await expect(page).toHaveURL(/\/tournaments\/t_autumnrobin1$/u);
    });
}

test('Played in narrows the list to a tournament\'s games, a duel\'s, or neither, and its chip clears it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ finished: [...tournamentGameRows, ...duelGameRows, ...keptNames] }));
    await page.goto(`/games`);
    await page.locator(`.game-row`).first().waitFor();
    await page.getByRole(`button`, { name: `Filters`, exact: true }).click();
    await page.getByLabel(`Played in`).selectOption(`tournament`);
    await expect(page.locator(`.game-row`)).toHaveCount(tournamentGameRows.length);
    expect(search(page)).toBe(`?event=tournament`);
    await page.getByLabel(`Played in`).selectOption(`none`);
    await expect(page.locator(`.game-row-evented`)).toHaveCount(0);
    await page.keyboard.press(`Escape`);
    await page.getByRole(`button`, { name: `Remove no duel or tournament` }).click();
    expect(search(page)).toBe(``);
    await expect(page.locator(`.game-row-evented`)).not.toHaveCount(0);
});
