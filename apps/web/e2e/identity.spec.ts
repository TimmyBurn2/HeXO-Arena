import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

const quinn: Me = { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] };
const guest: Me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };

async function visit(page: Page, width: number, me: Me, height = 900): Promise<void> {
    await page.setViewportSize({ width, height });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me }));
    await page.goto(`/bots`);
    await page.locator(`table`).waitFor();
}

function who(page: Page) {
    return page.locator(`header button.identity`);
}

function menu(page: Page) {
    return page.locator(`dialog.identity-panel`);
}

function gear(page: Page) {
    return page.getByRole(`button`, { name: `Settings`, exact: true });
}

test('who is here opens a popover by click that Esc closes, focus going in and back', async ({ page }) => {
    await visit(page, 1280, quinn);
    await who(page).click();
    await expect(menu(page)).toBeVisible();
    expect(await menu(page).evaluate((dialog) => dialog.matches(`:modal`))).toBe(false);
    await expect(menu(page).getByRole(`link`, { name: `Profile` })).toBeFocused();
    await page.keyboard.press(`Escape`);
    await expect(menu(page)).toHaveCount(0);
    await expect(who(page)).toBeFocused();
});

test('a click outside the identity popover closes it and a click inside does not', async ({ page }) => {
    await visit(page, 1280, quinn);
    await who(page).click();
    await menu(page).locator(`.identity-head`).click();
    await expect(menu(page)).toBeVisible();
    await page.getByRole(`heading`, { level: 1, name: `Bots` }).click();
    await expect(menu(page)).toHaveCount(0);
    await expect(who(page)).toBeFocused();
});

test('tabbing past the identity popover closes it and leaves focus where it went', async ({ page }) => {
    await visit(page, 1280, quinn);
    await who(page).click();
    await menu(page).getByRole(`button`, { name: `Sign out` }).focus();
    await page.keyboard.press(`Tab`);
    await expect(menu(page)).toHaveCount(0);
    await expect(who(page)).not.toBeFocused();
});

// Shift+Tab walks back through the close button and the panel's own
// button, then out; out of both, the popover shuts and focus stays put.
for (const [name, opener] of [
    [`identity`, `header button.identity`],
    [`settings`, `header button.settings-gear`],
] as const) {
    test(`shift-tabbing out of the ${name} popover closes it`, async ({ page }) => {
        await visit(page, 1280, quinn);
        await page.locator(opener).click();
        const open = page.locator(`dialog[open]`);
        await expect(open).toHaveCount(1);
        for (let presses = 0; presses < 4 && (await open.count()) > 0; presses += 1) {
            await page.keyboard.press(`Shift+Tab`);
        }
        await expect(open).toHaveCount(0);
        await expect(page.locator(opener)).toHaveAttribute(`aria-expanded`, `false`);
        const focused = await page.evaluate(() => document.activeElement?.closest(`dialog`) === null && document.activeElement !== document.body);
        expect(focused).toBe(true);
    });
}

for (const width of [481, 768, 1280]) {
    test(`the identity popover hangs under the bar inside the window at ${String(width)} px`, async ({ page }) => {
        await visit(page, width, quinn);
        await who(page).click();
        const box = await menu(page).boundingBox();
        const button = await who(page).boundingBox();
        if (box === null || button === null) throw new Error(`nothing to measure`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(button.y + button.height);
        expect(box.x).toBeLessThanOrEqual(button.x);
    });
}

test('on a phone the identity menu is a modal bottom sheet with full finger targets', async ({ page }) => {
    await visit(page, 390, quinn, 844);
    await who(page).click();
    expect(await menu(page).evaluate((dialog) => dialog.matches(`:modal`))).toBe(true);
    await expect.poll(async () => {
        const box = await menu(page).boundingBox();
        return box === null ? null : [Math.round(box.x), Math.round(box.y + box.height), Math.round(box.width)];
    }).toEqual([0, 844, 390]);
    for (const control of await menu(page).locator(`.identity-row, .topbar-panel-close`).all()) {
        const box = await control.boundingBox();
        expect(box === null ? 0 : Math.round(box.height)).toBeGreaterThanOrEqual(44);
    }
    await page.mouse.click(195, 40);
    await expect(menu(page)).toHaveCount(0);
    await expect(who(page)).toBeFocused();
});

test('opening settings shuts the identity menu, and the other way round', async ({ page }) => {
    await visit(page, 1280, quinn);
    await who(page).click();
    await gear(page).click();
    await expect(page.locator(`dialog.settings`)).toBeVisible();
    await expect(menu(page)).toHaveCount(0);
    await who(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(page.locator(`dialog.settings`)).toHaveCount(0);
    await expect(page.locator(`dialog[open]`)).toHaveCount(1);
});

test('signing out from the menu leaves the sign-in in its place with focus', async ({ page }) => {
    await visit(page, 1280, quinn);
    await who(page).click();
    await menu(page).getByRole(`button`, { name: `Sign out` }).click();
    const signIn = page.locator(`header`).getByRole(`link`, { name: `Sign in with Discord` });
    await expect(signIn).toBeFocused();
    await expect(page.locator(`dialog[open]`)).toHaveCount(0);
});

test('a guest ends the session from the menu', async ({ page }) => {
    await visit(page, 1280, guest);
    await page.getByRole(`button`, { name: `Guest k3f9, unrated` }).click();
    await expect(menu(page).getByRole(`link`, { name: `Sign in with Discord` })).toBeFocused();
    await menu(page).getByRole(`button`, { name: `End guest session` }).click();
    await expect(page.locator(`header`).getByRole(`link`, { name: `Sign in with Discord` })).toBeFocused();
});

test('signed out, the top bar links straight to Discord, returning to the page it is on', async ({ page }) => {
    await visit(page, 1280, null);
    const signIn = page.locator(`header`).getByRole(`link`, { name: `Sign in with Discord` });
    await expect(signIn).toHaveAttribute(`href`, /^\/api\/auth\/discord\/login\?next=%2F/u);
    const href = await signIn.getAttribute(`href`);
    const next = new URL(href ?? ``, `https://arena.example`).searchParams.get(`next`);
    expect(next).toBe(new URL(page.url()).pathname);
    await expect(page.locator(`dialog`)).toHaveCount(0);
});

// Every open panel, in both forms, holds to every axe rule.
for (const [name, me, open] of [
    [`identity`, quinn, `identity`],
    [`guest`, guest, `identity`],
    [`settings`, quinn, `settings`],
] as const) {
    for (const width of [390, 1280]) {
        test(`the open ${name} panel passes axe at ${String(width)} px`, async ({ page }) => {
            await visit(page, width, me);
            await (open === `settings` ? gear(page) : who(page)).click();
            await page.locator(`dialog[open]`).waitFor();
            await page.waitForTimeout(250);
            const axe = await new AxeBuilder({ page }).analyze();
            expect(axe.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(` `)).join(`, `)}`)).toEqual([]);
        });
    }
}

// The panel is where a person reads their whole name and the Discord
// account behind the session, however long both are.
for (const width of [1280, 390, 320]) {
    test(`a 30-character name and 32-character Discord names show whole in the menu at ${String(width)} px`, async ({ page }) => {
        await visit(page, width, {
            kind: `user`,
            name: `sealbot-owner-with-a-long-name`,
            rating: 1503,
            provisional: false,
            discord: { username: `owner.of.sealbot.and.two.more.xy`, displayName: `The Owner Of Sealbot And Two Mor` },
            liveGames: [],
        });
        await who(page).click();
        await menu(page).waitFor();
        const cut = await menu(page).evaluate((dialog) =>
            [...dialog.querySelectorAll(`.identity-head-name, .discord-line`)].map((element) => ({
                text: element.textContent,
                hidden: element.scrollWidth > element.clientWidth || element.getBoundingClientRect().right > dialog.getBoundingClientRect().right,
            })),
        );
        expect(cut).toEqual([
            { text: `sealbot-owner-with-a-long-name`, hidden: false },
            { text: `Discord: The Owner Of Sealbot And Two Mor (@owner.of.sealbot.and.two.more.xy)`, hidden: false },
        ]);
    });
}

// An ordinary name keeps one line in the menu's head,
// beside the pattern and with the rating under it.
for (const [name, width] of [[`quietowner12`, 1280], [`quietowner12`, 768], [`quietowner-longer-21`, 390]] as const) {
    test(`the ${String(name.length)}-character name ${name} takes one line in the menu at ${String(width)} px`, async ({ page }) => {
        await visit(page, width, { kind: `user`, name, rating: 1420, provisional: true, discord: null, liveGames: [] });
        await who(page).click();
        await menu(page).waitFor();
        const head = await menu(page).evaluate((dialog) => {
            const element = dialog.querySelector(`.identity-head-name`);
            const rating = dialog.querySelector(`.identity-head-rating`);
            const mark = dialog.querySelector(`.identity-head-mark`);
            if (element === null || rating === null || mark === null) return null;
            const range = document.createRange();
            range.selectNodeContents(element);
            const name = element.getBoundingClientRect();
            const under = rating.getBoundingClientRect();
            const plate = mark.getBoundingClientRect();
            return {
                lines: new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size,
                ratingUnder: under.top >= name.bottom - 1 && Math.abs(under.left - name.left) <= 1,
                // The pattern stands centered on the name and the rating together.
                offCenter: Math.abs(plate.top + plate.height / 2 - (name.top + under.bottom) / 2),
            };
        });
        expect(head?.lines).toBe(1);
        expect(head?.ratingUnder).toBe(true);
        expect(head?.offCenter).toBeLessThanOrEqual(1);
    });
}
