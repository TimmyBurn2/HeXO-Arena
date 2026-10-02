import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { devPersonas, discordLoginPath, type DevAccount, type Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world, type World } from './mock-api';

test.skip(process.env.E2E_BUILD === `1`, `the dev pill ships only in the dev server's bundle`);

const standing: Record<string, Omit<DevAccount, `name` | `purpose`>> = {
    ana: { rating: 1220, provisional: true, banned: false, games: 4, bots: [`hextide`, `pebble`, `lantern`].map((name) => ({ name, rating: 1500, provisional: true, vsBots: 0 })) },
    bruno: { rating: 855, provisional: true, banned: false, games: 10, bots: [] },
    cleo: { rating: 1000, provisional: true, banned: false, games: 0, bots: [] },
    dmitri: { rating: 891, provisional: true, banned: false, games: 2, bots: [{ name: `quietlake`, rating: 1420, provisional: true, vsBots: 20 }] },
    eve: { rating: 908, provisional: true, banned: true, games: 2, bots: [] },
};

const personas: DevAccount[] = devPersonas.map((persona) => {
    const figures = standing[persona.name];
    if (figures === undefined) throw new Error(`no figures for ${persona.name}`);
    return { ...persona, ...figures };
});

async function visit(page: Page, path: string, overrides: Partial<World>, width = 1280, beforeLoad?: () => Promise<void>): Promise<World> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const state = world({ me: null, devAccounts: personas, ...overrides });
    await serve(page, state);
    await beforeLoad?.();
    await page.goto(path);
    return state;
}

// Holds the dev accounts probe until the test lets it answer; a route added
// after the mock's runs before it.
async function holdProbe(page: Page): Promise<() => void> {
    let answer = () => {};
    const answered = new Promise<void>((resolve) => {
        answer = resolve;
    });
    await page.route(`**/api/dev/accounts`, async (route) => {
        await answered;
        await route.fallback();
    });
    return answer;
}

function pill(page: Page) {
    return page.locator(`.dev-pill`);
}

function panel(page: Page) {
    return page.getByRole(`dialog`, { name: `Dev accounts` });
}

test('a server without the dev routes gets no pill', async ({ page }) => {
    const answered = page.waitForResponse((response) => response.url().endsWith(`/api/dev/accounts`));
    await visit(page, `/bots`, { devAccounts: null });
    expect((await answered).status()).toBe(404);
    await page.locator(`table`).waitFor();
    await expect(page.locator(`.dev-tools`)).toHaveCount(0);
    await expect(pill(page)).toHaveCount(0);
});

test('the pill names who is signed in, and a persona is one click away', async ({ page }) => {
    await visit(page, `/bots`, {});
    await expect(pill(page)).toHaveText(`dev: signed out`);
    await pill(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole(`button`, { name: /^ana/u })).toBeFocused();
    await panel(page).getByRole(`button`, { name: /^ana/u }).click();
    await expect(pill(page)).toHaveText(`dev: ana`);
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page)).toBeFocused();
    await expect(page.locator(`header button.identity`)).toContainText(`ana`);
});

test('any name signs in from the field', async ({ page }) => {
    await visit(page, `/bots`, {});
    await pill(page).click();
    await panel(page).getByLabel(`Sign in as`).fill(`zora`);
    await panel(page).getByRole(`button`, { name: `Sign in`, exact: true }).click();
    await expect(pill(page)).toHaveText(`dev: zora`);
});

test('a banned persona says so and stays signed out', async ({ page }) => {
    await visit(page, `/bots`, {});
    await pill(page).click();
    await panel(page).getByRole(`button`, { name: /^eve/u }).click();
    await expect(panel(page).getByRole(`alert`)).toHaveText(`eve is banned`);
    await expect(pill(page)).toHaveText(`dev: signed out`);
});

test('the Discord button opens the panel instead of leaving the page', async ({ page }) => {
    await visit(page, `/ladder`, {});
    // The panel can catch the click only once the dev routes have answered.
    await pill(page).waitFor();
    await page.locator(`header a.discord-button`).click();
    await expect(panel(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/ladder`);
    await page.keyboard.press(`Escape`);
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page)).toBeFocused();
});

test('a Discord click before the dev routes answer waits for them, then opens the panel', async ({ page }) => {
    let answer = () => {};
    await visit(page, `/ladder`, {}, 1280, async () => {
        answer = await holdProbe(page);
    });
    await page.locator(`header a.discord-button`).click();
    await expect(pill(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe(`/ladder`);
    answer();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole(`button`, { name: /^ana/u })).toBeFocused();
    expect(new URL(page.url()).pathname).toBe(`/ladder`);
});

test('a Discord click held for a server without dev routes follows the link once it answers', async ({ page }) => {
    let answer = () => {};
    await visit(page, `/ladder`, { devAccounts: null }, 1280, async () => {
        answer = await holdProbe(page);
    });
    await page.locator(`header a.discord-button`).click();
    await expect(page.locator(`h1`)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/ladder`);
    answer();
    await expect(page).toHaveURL(new RegExp(discordLoginPath, `u`));
});

test('the panel closes with its X, back to the pill', async ({ page }) => {
    await visit(page, `/bots`, {});
    await pill(page).click();
    await panel(page).getByRole(`button`, { name: `Close dev accounts` }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(pill(page)).toBeFocused();
});

for (const width of [1280, 390]) {
    test(`the pill follows the page's last line rather than covering it while the page scrolls at ${String(width)} px`, async ({ page }) => {
        await visit(page, `/credits`, {}, width);
        await page.setViewportSize({ width, height: 480 });
        await pill(page).waitFor();
        const place = () =>
            page.evaluate(() => {
                const pill = document.querySelector(`.dev-pill`)?.getBoundingClientRect();
                const app = document.getElementById(`root`)?.getBoundingClientRect();
                return { pillTop: (pill?.top ?? -Infinity) + window.scrollY, appBottom: (app?.bottom ?? Infinity) + window.scrollY, scrolls: document.documentElement.scrollHeight > window.innerHeight };
            });
        await expect.poll(async () => (await place()).scrolls).toBe(true);
        const atTop = await place();
        expect(atTop.pillTop).toBeGreaterThanOrEqual(atTop.appBottom);
        await page.mouse.wheel(0, 400);
        const scrolled = await place();
        expect(scrolled.pillTop).toBeGreaterThanOrEqual(scrolled.appBottom);
    });
}

test('on a short page the pill stands at the foot of the window', async ({ page }) => {
    await visit(page, `/bots`, {}, 1280);
    await pill(page).waitFor();
    const box = await pill(page).boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(box === null ? Infinity : box.y + box.height).toBeLessThanOrEqual(height);
    expect(box === null ? 0 : box.y + box.height).toBeGreaterThan(height - 80);
});

test('on a phone, the Discord button in a guest\'s sheet hands over to the panel', async ({ page }) => {
    await visit(page, `/bots`, { me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } }, 390);
    await pill(page).waitFor();
    await page.locator(`header button.identity`).click();
    const sheet = page.locator(`dialog.identity-panel`);
    await expect(sheet).toBeVisible();
    await sheet.locator(`a.discord-button`).click();
    await expect(sheet).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole(`button`, { name: /^ana/u })).toBeFocused();
    await panel(page).getByRole(`button`, { name: /^bruno/u }).click();
    await expect(pill(page)).toHaveText(`dev: bruno`);
});

test('the panel leaves with the frame when the game takes the screen', async ({ page }) => {
    await visit(page, `/bots`, { me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] } });
    await pill(page).click();
    await expect(panel(page)).toBeVisible();
    await page.evaluate(() => {
        window.history.pushState(null, ``, `/game/running`);
        window.dispatchEvent(new PopStateEvent(`popstate`));
    });
    await expect(pill(page)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
});

test('the first sign-in goes on to the name page', async ({ page }) => {
    await visit(page, `/ladder`, {});
    await pill(page).click();
    await panel(page).getByRole(`button`, { name: `Start a first sign-in` }).click();
    await expect(page).toHaveURL(/\/welcome$/u);
    await expect(page.getByRole(`heading`, { level: 1 })).toBeVisible();
});

test('a guest session replaces the account, and sign out ends it', async ({ page }) => {
    const me: Me = { kind: `user`, name: `ana`, rating: 1220, provisional: true, discord: null, liveGames: [] };
    await visit(page, `/bots`, { me });
    await expect(pill(page)).toHaveText(`dev: ana`);
    await pill(page).click();
    await panel(page).getByRole(`button`, { name: `Guest session` }).click();
    await expect(pill(page)).toHaveText(`dev: Guest k3f9`);
    await pill(page).click();
    await panel(page).getByRole(`button`, { name: `Sign out` }).click();
    await expect(pill(page)).toHaveText(`dev: signed out`);
});

test('an empty list says to run the seed', async ({ page }) => {
    await visit(page, `/bots`, { devAccounts: [] });
    await pill(page).click();
    await expect(panel(page)).toContainText(`Run pnpm dev:seed`);
});

test('the game keeps its board to itself', async ({ page }) => {
    const me: Me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] };
    const answered = page.waitForResponse((response) => response.url().endsWith(`/api/dev/accounts`));
    await visit(page, `/game/running`, { me });
    await answered;
    await page.locator(`.dev-tools`).waitFor({ state: `attached` });
    await expect(pill(page)).toHaveCount(0);
});

for (const width of [1280, 390]) {
    test(`the pill and its panel stay clear of the tab strip and pass axe at ${String(width)} px`, async ({ page }) => {
        await visit(page, `/bots`, {}, width);
        await pill(page).click();
        await expect(panel(page)).toBeVisible();
        const tabs = await page.locator(`nav.tabbar`).boundingBox();
        const pillBox = await pill(page).boundingBox();
        if (tabs !== null && pillBox !== null) expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(tabs.y);
        const axe = await new AxeBuilder({ page }).include(`.dev-tools`).analyze();
        expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(` `)).join(`, `)}`)).toEqual([]);
    });
}
