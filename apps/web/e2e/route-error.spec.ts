import { expect, test } from '@playwright/test';
import { serve, world } from './mock-api';

// A screen's code that fails to download, as a missing chunk does after a
// deploy or on a dropped connection, must not leave a blank page.
test(`a framed screen that does not load says so inside the frame, and reload brings it back`, async ({ page }) => {
    const state = world({ unloadable: `/src/screens/BotsScreen.tsx` });
    await serve(page, state);
    await page.goto(`/bots`);
    await expect(page.getByRole(`main`).getByRole(`heading`, { name: `This page did not load` })).toBeVisible();
    await expect(page.locator(`header.topbar`)).toBeVisible();
    state.unloadable = null;
    await page.getByRole(`button`, { name: `Reload` }).click();
    await expect(page.locator(`table`)).toBeVisible();
});

test(`a game that does not load says so on the stage, and reload brings it back`, async ({ page }) => {
    const state = world({ unloadable: `/src/screens/GameScreen.tsx` });
    await serve(page, state);
    await page.goto(`/game/running`);
    await expect(page.getByRole(`heading`, { name: `This page did not load` })).toBeVisible();
    await expect(page.locator(`header.topbar`)).toHaveCount(0);
    state.unloadable = null;
    await page.getByRole(`button`, { name: `Reload` }).click();
    await expect(page.locator(`svg polygon.cell`).first()).toBeVisible();
});
