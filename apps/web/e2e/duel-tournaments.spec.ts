import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, pickBots, wear } from './matrix';
import { anaMe, brunoMe, duelBots, roundRobins, serve, tournaments, world, type World } from './mock-api';

const ownerMe: Me = { kind: `user`, name: `devowner-b`, rating: 1500, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

// ana's bots and everyone else's, the weekly waiting, and the duels and round robins people set up.
const events = (overrides: Partial<World> = {}) =>
    world({ me: anaMe, bots: duelBots, tournaments: [...structuredClone(tournaments().filter((entry) => entry.status !== `running`)), ...structuredClone(roundRobins())], live: [], ...overrides });

async function open(page: Page, path: string, width: number, state: World = events()): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, state);
    await page.goto(path);
}

async function noSidewaysScroll(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [1280, 390]) {
    test(`two bots picked on Play's Tournament place set a duel up, its games one after another, and open its page, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width);
        await expect(page.getByRole(`heading`, { name: `New duel` })).toBeVisible();
        await pickBots(page, [`devbot-b`, `devbot-c`]);
        await expect(page.getByText(`2 bots; a third makes a round robin`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Add bots`, exact: true })).toBeVisible();
        await page.getByRole(`radiogroup`, { name: `Games` }).getByRole(`radio`, { name: `10` }).check({ force: true });
        await expect(page.getByText(`5 openings, each played twice with sides swapped.`)).toBeVisible();
        await expect(page.getByText(/^10 games, one at a time\. You can stop the duel/u)).toBeVisible();
        await noSidewaysScroll(page);
        await page.getByRole(`button`, { name: `Start duel` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
        await expect(page.getByRole(`heading`, { name: `devbot-b vs devbot-c`, level: 1 })).toBeAttached();
        await expect(page.getByText(`Game 1 of 10 is live.`)).toBeVisible();
        await expect(page.locator(`.duel-kicker`)).toContainText(`Duel`);
        await expect(page.getByRole(`heading`, { name: `Opening 5` })).toHaveCount(0);
        await noSidewaysScroll(page);
        await page.goBack();
        await expect(page).toHaveURL(/\/play\/tournament\?bots=devbot-b%2Cdevbot-c&games=10&clock=t10&opening=5$/u);
    });

    test(`a duel's page faces its bots across the score and groups its games by opening, and its creator stops it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunoduel001`, width, events({ me: brunoMe }));
        await expect(page.getByText(`Game 7 of 10 is live; devbot-b leads 4-2.`)).toBeVisible();
        await expect(page.getByRole(`img`, { name: `4 to 2, game 7 of 10` })).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Opening 1` })).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Game 7, live` })).toBeVisible();
        await expect(page.getByText(`Drawn when game 7 started; game 8 replays it with sides swapped.`)).toBeVisible();
        await noSidewaysScroll(page);
        await page.getByRole(`button`, { name: `Stop duel` }).focus();
        await page.keyboard.press(`Enter`);
        await expect(page.getByText(`Stop the duel? No further game starts; the live game plays on, and the score stands as it is.`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Keep playing` })).toBeFocused();
        await page.getByRole(`button`, { name: `Stop; no further game starts` }).click();
        await expect(page.getByText(/^You stopped the duel after game 6; devbot-b leads 4-2\.$/u)).toBeVisible();
        await expect(page.locator(`.duel-actions`).getByRole(`link`, { name: `These games in Games` })).toBeFocused();
    });

    test(`a bot's owner withdraws it from a duel, which ends it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunoduel001`, width, events({ me: ownerMe }));
        await expect(page.getByRole(`button`, { name: `Stop duel` })).toHaveCount(0);
        await page.getByRole(`button`, { name: `Withdraw devbot-b` }).click();
        await expect(page.getByText(`Withdraw devbot-b? The duel ends: its live game plays on and counts, and no further game starts.`)).toBeVisible();
        await page.getByRole(`button`, { name: `Withdraw; the duel ends` }).click();
        await expect(page.getByText(`Cut short at 4-2: devbot-b's owner withdrew it.`)).toBeVisible();
        await expect(page.getByRole(`img`, { name: `4 to 2, cut short` })).toBeVisible();
    });

    test(`a duel cut short marks its no-shows and the games never played, and lists as a duel's row under Games, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_dmitricut001`, width);
        await expect(page.getByText(`Cut short at 3-1: cinder missed two openings.`)).toBeVisible();
        await expect(page.getByText(`No-show: cinder did not come; quietlake scores`)).toHaveCount(2);
        await expect(page.getByText(`Not played`)).toHaveCount(2);
        await page.goto(`/games/tournaments`);
        const row = page.locator(`a.duel-row`, { hasText: `quietlake` });
        await expect(row).toContainText(`Cut short at 3-1: cinder missed two openings`);
        await expect(row.getByRole(`img`, { name: `quietlake and cinder, 3-1` })).toBeVisible();
        await noSidewaysScroll(page);
    });
}
