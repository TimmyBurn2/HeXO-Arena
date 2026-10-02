import { expect, test } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, signup, world } from './mock-api';

test.beforeEach(async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
});

test('a first sign-in from Build a bot creates the account and lands in the bot name, signed in', async ({ page }) => {
    await serve(page, world({ me: null, signup }));
    await page.goto(`/welcome`);
    const name = page.getByRole(`textbox`, { name: `Public name` });
    await expect(name).toHaveValue(`mira-hex`);
    await expect(page.getByText(`mira-hex is free`)).toBeVisible();
    await name.fill(`Mira`);
    await page.getByRole(`button`, { name: `Create account` }).click();
    await expect(page).toHaveURL(/\/connect$/u);
    await expect(page.getByRole(`textbox`, { name: `Bot name` })).toBeFocused();
    await expect(page.getByRole(`heading`, { name: `Signed in as Mira` })).toBeVisible();
    await expect(page.locator(`header button.identity`)).toContainText(`Mira`);
});

test('Cancel keeps nothing and returns to where the sign-in started, still signed out', async ({ page }) => {
    await serve(page, world({ me: null, signup: { ...signup, next: `/bots` } }));
    await page.goto(`/welcome`);
    await page.getByRole(`button`, { name: `Cancel` }).click();
    await expect(page).toHaveURL(/\/bots$/u);
    await page.goto(`/welcome`);
    await expect(page.getByRole(`heading`, { name: `That sign-in expired; sign in again` })).toBeVisible();
});

test('Enter in the name field creates the account', async ({ page }) => {
    await serve(page, world({ me: null, signup: { ...signup, next: `/ladder` } }));
    await page.goto(`/welcome`);
    await page.getByRole(`textbox`, { name: `Public name` }).press(`Enter`);
    await expect(page).toHaveURL(/\/ladder$/u);
});

test('a refused Create account pressed from the keyboard keeps focus on the button', async ({ page }) => {
    await serve(page, world({ me: null, signup, create: `failed` }));
    await page.goto(`/welcome`);
    const create = page.getByRole(`button`, { name: `Create account` });
    await create.focus();
    await page.keyboard.press(`Enter`);
    await expect(page.getByText(`The account was not created; try again`)).toBeVisible();
    await expect(create).toBeFocused();
});

test('a double click sends one Create account and one Cancel', async ({ page }) => {
    const sent: string[] = [];
    page.on(`request`, (request) => {
        if (new URL(request.url()).pathname === `/api/signup` && request.method() !== `GET`) sent.push(request.method());
    });
    await serve(page, world({ me: null, signup, create: `failed` }));
    await page.goto(`/welcome`);
    await page.getByRole(`button`, { name: `Create account` }).dblclick();
    await expect(page.getByText(`The account was not created; try again`)).toBeVisible();
    await page.getByRole(`button`, { name: `Cancel` }).dblclick();
    await expect(page).toHaveURL(/\/connect$/u);
    expect(sent).toEqual([`POST`, `DELETE`]);
});

test('Back after Cancel returns to the page before the sign-in, not to the spent sign-up', async ({ page }) => {
    await serve(page, world({ me: null, signup }));
    await page.goto(`/credits`);
    await page.locator(`h1`).waitFor();
    await page.goto(`/welcome`);
    await page.getByRole(`button`, { name: `Cancel` }).click();
    await expect(page).toHaveURL(/\/connect$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/credits$/u);
});

test('under forced colors a Create account that cannot act is grayed like a disabled button', async ({ page }) => {
    await page.emulateMedia({ forcedColors: `active` });
    await serve(page, world({ me: null, signup }));
    await page.goto(`/welcome`);
    await page.getByText(`mira-hex is free`).waitFor();
    await page.getByRole(`textbox`, { name: `Public name` }).fill(`admin`);
    const gray = await page.evaluate(() => {
        const probe = document.createElement(`span`);
        probe.style.color = `GrayText`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    // The button eases into its color, so its settled color is polled for,
    // at rest and under the pointer.
    const create = page.getByRole(`button`, { name: `Create account` });
    await expect.poll(async () => create.evaluate((button) => getComputedStyle(button).color)).toBe(gray);
    await create.hover();
    await expect.poll(async () => create.evaluate((button) => getComputedStyle(button).color)).toBe(gray);
});

test('Back after Create account returns to the page before the sign-in, wherever the account went on to', async ({ page }) => {
    await serve(page, world({ me: null, signup: { ...signup, next: `/ladder` } }));
    await page.goto(`/credits`);
    await page.locator(`h1`).waitFor();
    await page.goto(`/welcome`);
    await page.getByRole(`button`, { name: `Create account` }).click();
    await expect(page).toHaveURL(/\/ladder$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/credits$/u);
});

test('someone signed in with no sign-up waiting is taken to Profile, and Back skips the welcome page', async ({ page }) => {
    await serve(page, world({ signup: null }));
    await page.goto(`/credits`);
    await page.locator(`h1`).waitFor();
    await page.goto(`/welcome`);
    await expect(page).toHaveURL(/\/profile$/u);
    await page.goBack();
    await expect(page).toHaveURL(/\/credits$/u);
});
