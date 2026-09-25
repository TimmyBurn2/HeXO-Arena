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
