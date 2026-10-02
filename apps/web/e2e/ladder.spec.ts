import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world, type World } from './mock-api';

async function open(page: Page, width: number, fontSize = 16, state: World = world()): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await page.addInitScript((size: number) => {
        document.documentElement.style.fontSize = `${String(size)}px`;
    }, fontSize);
    await serve(page, state);
    await page.goto(`/ladder`);
    await page.locator(state.stall ? `.podium-skeleton` : `.podium-plate`).first().waitFor();
}

// The loading ladder stands its rows where the loaded one does.
for (const width of [1280, 390] as const) {
    test(`the skeleton holds the loaded height above the rows at ${String(width)} px`, async ({ page }) => {
        await open(page, width, 16, { ...world(), stall: true });
        const loading = await page.getByRole(`heading`, { name: `Full ladder`, includeHidden: true }).boundingBox();
        await open(page, width);
        const loaded = await page.getByRole(`heading`, { name: `Full ladder` }).boundingBox();
        expect(Math.abs((loading?.y ?? 0) - (loaded?.y ?? 0))).toBeLessThan(8);
    });
}

test('Find a name tells a screen reader how many players match', async ({ page }) => {
    await open(page, 1280);
    const status = page.locator(`.sr-only[role=status]`);
    await page.getByLabel(`Find a name`).fill(`seal`);
    await expect(status).toHaveText(`1 player matches seal`);
    await page.getByLabel(`Find a name`).fill(`zz`);
    await expect(status).toHaveText(`No player on this ladder matches zz`);
});

// Each plate stands on its own tower: centered over it, its foot within a
// few pixels of the tower's top stone, and never over the filters above.
for (const [width, fontSize] of [
    [1280, 16],
    [768, 16],
    [390, 16],
    [360, 16],
    [1280, 32],
    [390, 32],
] as const) {
    test(`the plates stand on their towers at ${String(width)} px with ${String(fontSize)} px text`, async ({ page }) => {
        await open(page, width, fontSize);
        const board = page.locator(`.podium-board:visible`);
        const plates = page.locator(`.podium-plate`);
        const filters = await page.locator(`.ladder-filters`).boundingBox();
        const towers = await board.evaluate((svg) => {
            const tops = new Map<number, { x: number; top: number }>();
            for (const stone of svg.querySelectorAll(`g.stone`)) {
                const box = stone.getBoundingClientRect();
                const x = Math.round(box.x + box.width / 2);
                const held = tops.get(x);
                if (held === undefined || box.y < held.top) tops.set(x, { x, top: box.y });
            }
            return [...tops.values()].sort((a, b) => a.x - b.x);
        });
        expect(towers).toHaveLength(3);
        // The plates read first, second, third; the towers stand second, first, third.
        const order = [1, 0, 2];
        for (const [index, tower] of towers.entries()) {
            const plate = await plates.nth(order[index] ?? 0).boundingBox();
            if (plate === null) throw new Error(`a plate has no box`);
            expect(Math.abs(plate.x + plate.width / 2 - tower.x)).toBeLessThan(3);
            expect(Math.abs(plate.y + plate.height - tower.top)).toBeLessThan(width < 600 ? 12 : 16);
            expect(plate.y).toBeGreaterThan((filters?.y ?? 0) + (filters?.height ?? 0));
        }
    });
}

test('Show my row clears the search and brings the reader to their own row', async ({ page }) => {
    await open(page, 390);
    await expect(page.getByText(`You are 3rd with 1503`)).toBeVisible();
    await page.getByLabel(`Find a name`).fill(`seal`);
    await expect(page.locator(`tbody tr`)).toHaveCount(1);
    await page.getByRole(`button`, { name: `Show my row` }).click();
    const mine = page.locator(`tr.you`);
    await expect(mine).toBeFocused();
    await expect(mine).toBeInViewport();
    await expect(page.getByLabel(`Find a name`)).toHaveValue(``);
});
