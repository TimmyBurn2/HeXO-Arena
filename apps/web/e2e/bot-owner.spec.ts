import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { playBots, serve, world, type World } from './mock-api';

async function open(page: Page, path: string, overrides: Partial<World> = {}): Promise<World> {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const state = world(overrides);
    await serve(page, state);
    await page.goto(path);
    await page.locator(`.owner-panel`).waitFor();
    return state;
}

const ana: Me = { kind: `user`, name: `ana`, rating: 1402, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

test('the owner sets the page text and link, which show in place of the declared ones, and sees the client last seen', async ({ page }) => {
    await open(page, `/bots/sealbot`, { settings: { sealbot: { name: `sealbot`, duelsByOthers: true, declaredAbout: `A clean-room HeXO engine with a rotation opener.`, client: { kind: `hexo-bridge`, version: `0.3.0` } } } });
    const panel = page.locator(`.owner-panel`);
    const about = panel.getByRole(`textbox`, { name: `About` });
    await expect(about).toHaveValue(``);
    await expect(panel).toContainText(`Empty here, so the page shows the text your bot declares.`);
    await expect(panel).toContainText(`hexo-bridge 0.3.0, as your bot last connected.`);
    await expect(panel.getByRole(`button`, { name: `Save` })).toBeDisabled();
    await about.fill(`Plays the rotation opener, then searches eight turns deep.`);
    await panel.getByRole(`textbox`, { name: `Source link` }).fill(`https://example.org/sealbot`);
    const sent = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/bots/sealbot/settings` && request.method() === `PATCH`);
    await panel.getByRole(`button`, { name: `Save` }).click();
    expect((await sent).postDataJSON()).toEqual({ about: `Plays the rotation opener, then searches eight turns deep.`, repoUrl: `https://example.org/sealbot` });
    await expect(panel.getByRole(`status`)).toHaveText(`Saved`);
    await expect(panel).not.toContainText(`Empty here, so the page shows the text your bot declares.`);
    await expect(page.locator(`p.about`)).toHaveText(`Plays the rotation opener, then searches eight turns deep.`);
});

test('a link that is not http or https is refused with the reason, and the page keeps what it showed', async ({ page }) => {
    await open(page, `/bots/sealbot`);
    const panel = page.locator(`.owner-panel`);
    await panel.getByRole(`textbox`, { name: `Source link` }).fill(`ftp://example.org/sealbot`);
    await panel.getByRole(`button`, { name: `Save` }).click();
    await expect(panel.getByRole(`alert`)).toHaveText(`Not saved: a source link starts with http:// or https://`);
    await expect(page.locator(`p.about`)).toHaveText(`A clean-room HeXO engine with a rotation opener.`);
    await expect(panel).toContainText(`Your bot has not connected yet.`);
});

test('the owner of a bot closed to others may still play it from its page', async ({ page }) => {
    await open(page, `/bots/pebble`, { me: ana, bots: playBots });
    await expect(page.locator(`.play-strip`).getByRole(`link`, { name: `Play pebble` })).toBeVisible();
    await expect(page.locator(`.play-reason`)).toHaveCount(0);
});
