import { expect, test } from '@playwright/test';
import { serve, world } from './mock-api';

// The keyboard alone plays a full turn: focus starts on the last stone,
// arrows walk to empty cells, the first Enter marks, the second commits.
test('a full turn plays from the keyboard alone', async ({ page }) => {
    await serve(page, world());
    await page.goto(`/game/running`);
    const board = page.getByRole(`application`);
    await board.focus();

    const sent = page.waitForRequest((request) => request.url().endsWith(`/api/games/running/move`));
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);

    const request = await sent;
    expect(request.postDataJSON()).toEqual({ cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }] });
});

test('escape clears the pending stone without sending', async ({ page }) => {
    await serve(page, world());
    await page.goto(`/game/running`);
    await page.getByRole(`application`).focus();
    await page.keyboard.press(`q`);
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(1);
    await page.keyboard.press(`Escape`);
    await expect(page.locator(`.ring-pending`)).toHaveCount(0);
});

test('a full turn still plays with the drawer open beside the board', async ({ page }) => {
    await serve(page, world());
    await page.goto(`/game/running`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    await page.keyboard.press(`m`);
    await page.locator(`#drawer-body:not([hidden])`).waitFor();
    await page.getByRole(`application`).focus();
    const sent = page.waitForRequest((request) => request.url().endsWith(`/api/games/running/move`));
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`Enter`);
    expect((await sent).postDataJSON()).toEqual({ cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }] });
});

test('hovering the edge opens the drawer without taking the keyboard off the board', async ({ page }) => {
    await serve(page, world());
    await page.goto(`/game/running`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    await page.getByRole(`application`).focus();
    const box = page.viewportSize();
    if (box === null) throw new Error(`no viewport`);
    await page.mouse.move(box.width - 2, box.height / 2);
    await page.locator(`#drawer-body:not([hidden])`).waitFor();
    await expect(page.getByRole(`application`)).toBeFocused();
});

