import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// The finished game holds twelve stones from the origin: six turns, the
// last one a single stone that made the six.
async function open(page: Page, path: string, me: Me = null, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 800 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me }));
    await page.goto(path);
    await page.locator(`.board-svg`).waitFor();
}

function slider(page: Page) {
    return page.locator(`.hud-bottom-center`).getByRole(`slider`, { name: `Turn` });
}

const stones = (page: Page) => page.locator(`.board-camera .board-svg g.stone`);
const turnInUrl = (page: Page) => new URL(page.url()).searchParams.get(`turn`);

test('a finished game replays from its scrubber, a turn or a stone at a time, holding the final frame', async ({ page }) => {
    await open(page, `/game/finished`);
    await expect(slider(page)).toBeFocused();
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 6 of 6`);
    await expect(page.locator(`.hud-bottom-center .hud-result`)).toHaveText(`tom won with six in a row`);
    await expect(page.locator(`polyline.win-line`)).toHaveCount(1);
    const frame = await page.locator(`.board-camera .board-svg`).getAttribute(`viewBox`);

    await page.keyboard.press(`ArrowLeft`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 5 of 6`);
    await expect(stones(page)).toHaveCount(11);
    await expect(page.locator(`polyline.win-line`)).toHaveCount(0);
    expect(turnInUrl(page)).toBe(`5`);

    await page.keyboard.press(`Shift+ArrowLeft`);
    await expect(stones(page)).toHaveCount(10);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 5 of 6, first stone`);

    await page.keyboard.press(`Home`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Origin only`);
    await expect(stones(page)).toHaveCount(1);
    expect(turnInUrl(page)).toBe(`0`);
    // The camera keeps the final position's frame, so no stone moves.
    expect(await page.locator(`.board-camera .board-svg`).getAttribute(`viewBox`)).toBe(frame);

    // The board keeps its frontier's edge at every step.
    await expect(page.locator(`.board-camera path.frontier`)).toHaveCount(1);
    await page.keyboard.press(`ArrowRight`);
    await expect(stones(page)).toHaveCount(3);
    await page.keyboard.press(`End`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 6 of 6`);
    await expect(stones(page)).toHaveCount(12);
    expect(turnInUrl(page)).toBe(null);
});

test('a link opens the replay at its turn, and the steps answer a press', async ({ page }) => {
    await open(page, `/game/finished?turn=2`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 2 of 6`);
    await expect(stones(page)).toHaveCount(5);
    await page.getByRole(`button`, { name: `Go forward a turn` }).click();
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 3 of 6`);
    await page.getByRole(`button`, { name: `Go to the opening` }).click();
    await expect(page.getByRole(`button`, { name: `Go back a turn` })).toHaveAttribute(`aria-disabled`, `true`);
    await page.getByRole(`button`, { name: `Go to the end` }).click();
    await expect(page.getByRole(`button`, { name: `Go forward a turn` })).toHaveAttribute(`aria-disabled`, `true`);
});

test('the track seeks along a drag, not only where it is pressed', async ({ page }) => {
    await open(page, `/game/finished`);
    const track = page.locator(`.hud-bottom-center .scrub-track`);
    const box = await track.boundingBox();
    if (box === null) throw new Error(`the track has no box`);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Origin only`);
    await page.mouse.move(box.x + box.width / 2, y, { steps: 4 });
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 3 of 6`);
    // Held by the track, the drag keeps seeking past its ends.
    await page.mouse.move(box.x + box.width + 40, y + 60, { steps: 4 });
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 6 of 6`);
    await page.mouse.up();
    await page.mouse.move(box.x + 1, y);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 6 of 6`);
});

test('the board keeps its arrows for scrolling when focused, leaving the replay where it stands', async ({ page }) => {
    await open(page, `/game/finished?turn=4`);
    await page.locator(`.board-control`).focus();
    await page.keyboard.press(`ArrowLeft`);
    await page.keyboard.press(`ArrowUp`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 4 of 6`);
    expect(turnInUrl(page)).toBe(`4`);
});

test('a watcher of a live game steps back from it and returns to live', async ({ page }) => {
    await open(page, `/game/running`);
    const live = page.getByRole(`button`, { name: `Live` });
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 5, live`);
    await expect(live).toHaveAttribute(`aria-pressed`, `true`);
    await slider(page).press(`ArrowLeft`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 4 of 5, live`);
    await expect(live).toHaveAttribute(`aria-pressed`, `false`);
    await live.click();
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 5, live`);
    await expect(live).toHaveAttribute(`aria-pressed`, `true`);
    // Switched off while following, the board holds the turn it shows.
    await live.click();
    await expect(live).toHaveAttribute(`aria-pressed`, `false`);
    await expect(slider(page)).toHaveAttribute(`aria-valuetext`, `Turn 5 of 5, live`);
});

test('the Moves list marks the turn on the board and dims the turns after it', async ({ page }) => {
    await open(page, `/game/finished?turn=3`);
    await page.getByRole(`button`, { name: `Game panel` }).click();
    await page.getByRole(`tab`, { name: `Moves` }).click();
    const current = page.locator(`.feed-line[aria-current="step"]`);
    await expect(current.locator(`.feed-n`)).toHaveText(`3`);
    await expect(page.locator(`.feed-line.ahead .feed-n`)).toHaveText([`4`, `5`, `6`]);
    await slider(page).press(`End`);
    await expect(current.locator(`.feed-n`)).toHaveText(`6`);
    await expect(page.locator(`.feed-line.ahead`)).toHaveCount(0);
});

const longNames = {
    x: { name: `abcdefghijklmnopqrstuvwxyz1234`, rating: 1500, provisional: false, kind: `bot` as const },
    o: { name: `W`.repeat(30), rating: 1388, provisional: false, kind: `bot` as const },
};

for (const [width, names] of [
    [320, `long`],
    [360, `short`],
    [390, `short`],
    [390, `long`],
] as const) {
    test(`a watcher stepped back keeps the peek's steps in the window at ${String(width)} px with ${names} names`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        const base = world({ me: null });
        const running = base.games.running;
        if (running === undefined) throw new Error(`no running game in the world`);
        await serve(page, { ...base, games: { running: names === `long` ? { ...running, players: longNames } : running } });
        await page.goto(`/game/running`);
        await page.locator(`.board-svg`).waitFor();
        const peek = page.locator(`.sheet-peek`);
        const back = peek.getByRole(`button`, { name: `Go back a turn` });
        await back.click();
        await back.click();
        await expect(peek.getByRole(`slider`)).toHaveAttribute(`aria-valuetext`, `Turn 3 of 5`);
        for (const name of [`Go back a turn`, `Go forward a turn`]) {
            const box = await peek.getByRole(`button`, { name }).boundingBox();
            expect(box === null ? Infinity : box.x + box.width).toBeLessThanOrEqual(width);
        }
    });
}

test('a seated player gets no scrubber', async ({ page }) => {
    await open(page, `/game/running`, { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] });
    await expect(page.locator(`.hud-bottom-center`)).toBeVisible();
    await expect(page.getByRole(`slider`)).toHaveCount(0);
});

test('on a phone the sheet peek steps through the game without opening the sheet', async ({ page }) => {
    await open(page, `/game/finished`, null, 390);
    const peek = page.locator(`.sheet-peek`);
    await expect(peek.getByRole(`slider`, { name: `Turn` })).toBeFocused();
    await peek.getByRole(`button`, { name: `Go back a turn` }).click();
    await expect(peek.getByRole(`slider`)).toHaveAttribute(`aria-valuetext`, `Turn 5 of 6`);
    await expect(page.locator(`#drawer-body`)).toBeHidden();
    await expect(page.locator(`.hud-bottom-center .scrubber`)).toBeHidden();
    await expect(page.locator(`.hud-bottom-center .hud-result`)).toBeVisible();
});
