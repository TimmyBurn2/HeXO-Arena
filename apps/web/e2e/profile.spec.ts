import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { bots, heldBots, serve, world, type World } from './mock-api';

async function open(page: Page, overrides: Partial<World> = {}, width = 1280): Promise<World> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const state = world(overrides);
    await serve(page, state);
    await page.goto(`/profile`);
    await page.locator(`h1`).first().waitFor();
    return state;
}

test('one switch keeps a person\'s games out of public analysis, and says what it does', async ({ page }) => {
    const state = await open(page);
    const optOut = page.getByRole(`switch`, { name: `Leave my games out of public analysis` });
    await expect(optOut).not.toBeChecked();
    await expect(optOut).toHaveAccessibleDescription(
        `Anyone signed in can have your finished games read by an analyzer, and the readings are public. With this on, no one can; readings already made are deleted and the bots' own views of your games are hidden. The analysis board still reads positions for you.`,
    );
    // The switch turns once the server has it, so the click is not a check that turns at once.
    await optOut.click();
    await expect(optOut).toBeChecked();
    expect(state.me).toMatchObject({ analysisOptOut: true });
    await page.reload();
    await expect(optOut).toBeChecked();
    await optOut.click();
    await expect(optOut).not.toBeChecked();
    expect(state.me).toMatchObject({ analysisOptOut: false });
});

test('a switch the server does not take stays as it was and says so', async ({ page }) => {
    await open(page);
    await page.route(
        (url) => url.pathname === `/api/me`,
        (route) => (route.request().method() === `PATCH` ? route.fulfill({ status: 500, contentType: `application/json`, body: `{"error":"boom","code":"internal"}` }) : route.fallback()),
    );
    const optOut = page.getByRole(`switch`, { name: `Leave my games out of public analysis` });
    await optOut.click();
    await expect(page.getByRole(`alert`)).toHaveText(`The setting did not change; try again`);
    await expect(optOut).not.toBeChecked();
});

for (const width of [1280, 390]) {
    test(`at ${String(width)} px five bots line up in columns, and the account says it holds no more where Build a bot stood`, async ({ page }) => {
        await open(page, { bots: [...bots.filter((bot) => bot.ownerName !== `quinn`), ...heldBots] }, width);
        const section = page.locator(`.your-bots`);
        const rows = section.locator(`.bot-row`);
        await expect(rows).toHaveCount(5);
        await expect(section.getByText(`5 of 5 bots`)).toBeVisible();
        await expect(section.getByText(`Your account holds 5 bots, its limit; delete one on its page to build another.`)).toBeVisible();
        await expect(section.getByRole(`link`, { name: `Build a bot` })).toHaveCount(0);
        const edges = await rows.evaluateAll((elements) =>
            elements.map((row) => {
                const box = (selector: string) => row.querySelector(selector)?.getBoundingClientRect();
                return { presence: box(`.bot-row-presence`)?.left, open: box(`.bot-row-open .tag`)?.left, rating: box(`.bot-row-rating`)?.right, right: row.getBoundingClientRect().right };
            }),
        );
        for (const edge of [`presence`, `open`, `rating`, `right`] as const) {
            expect(new Set(edges.map((row) => Math.round(row[edge] ?? Number.NaN))).size, edge).toBe(1);
        }
    });
}

test('below the cap the list counts the bots and ends with the way to build another', async ({ page }) => {
    await open(page);
    const section = page.locator(`.your-bots`);
    await expect(section.locator(`.bot-row`)).toHaveCount(2);
    await expect(section.getByText(`2 of 5 bots`)).toBeVisible();
    await section.getByRole(`link`, { name: `Build a bot` }).click();
    await expect(page).toHaveURL(/\/connect$/u);
});
