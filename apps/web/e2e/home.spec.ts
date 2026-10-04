import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { liveGames, serve, world, type World } from './mock-api';

async function visit(page: Page, state: World, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, state);
    await page.goto(`/`);
}

function featured(page: Page) {
    return page.locator(`article.featured`);
}

// Two rated games; the one with the higher average rating is the one to feature.
const [, strong, weak] = liveGames;
if (strong === undefined || weak === undefined) throw new Error(`the live list is too short`);

test('the featured board holds its game until it ends, shows the result, then features the next', async ({ page }) => {
    test.slow();
    const state = world({ me: null, live: [weak] });
    await visit(page, state);
    await expect(featured(page).getByRole(`link`)).toHaveAccessibleName(`Watch ${weak.players.x.name} vs ${weak.players.o.name}`);
    // A stronger game starting does not take the slot.
    state.live = [strong, weak];
    await expect(page.getByRole(`heading`, { name: `Live now` })).toBeVisible({ timeout: 10_000 });
    await expect(featured(page).getByRole(`link`)).toHaveAccessibleName(`Watch ${weak.players.x.name} vs ${weak.players.o.name}`);
    // The featured game ends: its result shows, then the next game takes the slot.
    const end: GameSnapshot = {
        gameId: weak.gameId,
        players: weak.players,
        openingPlies: 1,
        board: { cells: weak.cells },
        timeControl: weak.timeControl,
        status: `finished`,
        winner: `x`,
        reason: `surrender`,
        voided: false,
    };
    state.games[weak.gameId] = end;
    state.live = [strong];
    await expect(featured(page).getByRole(`status`)).toHaveText(`Just finished${weak.players.x.name} won; ${weak.players.o.name} resigned`, { timeout: 10_000 });
    await expect(featured(page).getByRole(`link`)).toHaveAccessibleName(`Watch ${strong.players.x.name} vs ${strong.players.o.name}`, { timeout: 10_000 });
});

test('Home settles while a live game holds the slot, rendering when a stone lands', async ({ page }) => {
    const errors: string[] = [];
    // A missing resource, such as the dev routes this mock lacks, is not a render's fault,
    // nor is the dev server's reload socket, which Home does not open.
    page.on(`console`, (message) => {
        const text = message.text();
        if (message.type() === `error` && !text.startsWith(`Failed to load resource`) && !text.startsWith(`[vite]`) && !text.startsWith(`WebSocket connection to`)) errors.push(text);
    });
    await visit(page, world({ me: null, live: liveGames }));
    await featured(page).waitFor();
    await page.waitForTimeout(3_000);
    expect(errors).toEqual([]);
});

test('the play card shows its keyboard focus against its brass', async ({ page }) => {
    await visit(page, world({ me: null }));
    const card = page.getByRole(`link`, { name: /^Play a bot/u });
    await card.waitFor();
    await card.focus();
    await page.keyboard.press(`Shift+Tab`);
    await page.keyboard.press(`Tab`);
    await expect(card).toBeFocused();
    const colors = await card.evaluate((element) => {
        const style = getComputedStyle(element);
        return { ring: style.outlineColor, fill: style.backgroundColor, width: style.outlineWidth };
    });
    expect(colors.ring).not.toBe(colors.fill);
    expect(colors.width).not.toBe(`0px`);
});

test('with nothing live the slot freezes the latest result, its board one link into the game', async ({ page }) => {
    await visit(page, world({ me: null, live: [] }));
    const link = featured(page).getByRole(`link`, { name: `Replay quinn vs hextide` });
    await expect(link).toHaveAttribute(`href`, `/game/won`);
    await expect(featured(page).locator(`.featured-result`)).toHaveText(`Last gamequinn won with six in a row`);
    await expect(featured(page).locator(`polyline.win-line`)).toHaveCount(1);
});

test('on a phone Home leads the tabs and is the one marked on the root', async ({ page }) => {
    await visit(page, world(), 390);
    await page.locator(`h1`).waitFor();
    await expect(page.locator(`nav.tabbar a`)).toHaveText([`Home`, `Play`, `Games`, `Analysis`, `Ladder`, `Bots`]);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveText(`Home`);
});

test('the game leads home from its exit, and says so', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/game/finished`);
    const exit = page.locator(`.hud-exit`);
    await expect(exit).toHaveAccessibleName(`Home`);
    await expect(exit).toHaveAttribute(`href`, `/`);
    await exit.click();
    await expect(page.getByRole(`heading`, { level: 1, name: `Play HeXO` })).toBeVisible();
});
