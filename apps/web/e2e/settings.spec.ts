import { expect, test, type Page } from '@playwright/test';
import { themes } from '../src/theme/themes';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

async function ladder(page: Page, width: number, theme = `ink`): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    // Seeded once, so a reload keeps whatever the test chose since.
    await page.addInitScript((id: string) => {
        if (window.localStorage.getItem(`hexo-arena.theme.v1`) === null) window.localStorage.setItem(`hexo-arena.theme.v1`, id);
    }, theme);
    await serve(page, world());
    await page.goto(`/ladder`);
    await page.locator(`.podium-plate`).first().waitFor();
}

function gear(page: Page) {
    return page.getByRole(`button`, { name: `Settings`, exact: true });
}

function panel(page: Page) {
    return page.getByRole(`dialog`, { name: `Settings` });
}

test('the gear opens a popover by click that Esc closes, focus going in and back', async ({ page }) => {
    await ladder(page, 1280, `omok`);
    await gear(page).click();
    await expect(panel(page)).toBeVisible();
    expect(await panel(page).evaluate((dialog) => dialog.matches(`:modal`))).toBe(false);
    await expect(page.getByRole(`radio`, { name: `Omok` })).toBeFocused();
    await page.keyboard.press(`Escape`);
    await expect(panel(page)).toHaveCount(0);
    await expect(gear(page)).toBeFocused();
});

test('the gear opens from the keyboard and the close button hands focus back', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).focus();
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`radio`, { name: `Ink` })).toBeFocused();
    await page.getByRole(`button`, { name: `Close settings` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(panel(page)).toHaveCount(0);
    await expect(gear(page)).toBeFocused();
    await page.keyboard.press(`Space`);
    await expect(panel(page)).toBeVisible();
});

test('a click outside the popover closes it and a click inside does not', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).click();
    await panel(page).getByRole(`heading`, { name: `Settings` }).click();
    await expect(panel(page)).toBeVisible();
    await page.getByRole(`heading`, { level: 1, name: `Ladder` }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(gear(page)).toBeFocused();
});

test('tabbing past the popover closes it and leaves focus where it went', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).click();
    await panel(page).getByRole(`link`, { name: `Credits` }).focus();
    await page.keyboard.press(`Tab`);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator(`header .identity`)).toBeFocused();
});

for (const width of [481, 768, 1280]) {
    test(`the popover hangs under the gear inside the window at ${String(width)} px`, async ({ page }) => {
        await ladder(page, width);
        await gear(page).click();
        const box = await panel(page).boundingBox();
        const gearBox = await gear(page).boundingBox();
        if (box === null || gearBox === null) throw new Error(`nothing to measure`);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.y).toBeGreaterThanOrEqual(gearBox.y + gearBox.height);
        expect(box.x).toBeLessThanOrEqual(gearBox.x);
    });
}

test('on a phone the panel is a modal bottom sheet that its backdrop and Esc close', async ({ page }) => {
    await ladder(page, 390);
    await gear(page).click();
    await expect(panel(page)).toBeVisible();
    expect(await panel(page).evaluate((dialog) => dialog.matches(`:modal`))).toBe(true);
    // The sheet rises into place, so its resting box is polled for.
    await expect.poll(async () => {
        const box = await panel(page).boundingBox();
        return box === null ? null : [Math.round(box.x), Math.round(box.y + box.height), Math.round(box.width)];
    }).toEqual([0, 900, 390]);
    // A finger gets the full target on every control of the sheet.
    for (const control of [page.getByRole(`button`, { name: `Close settings` }), page.locator(`.settings .checkline`)]) {
        for (const box of await Promise.all((await control.all()).map((element) => element.boundingBox()))) {
            expect(box === null ? 0 : Math.round(box.height)).toBeGreaterThanOrEqual(44);
        }
    }
    await page.mouse.click(195, 40);
    await expect(panel(page)).toHaveCount(0);
    await expect(gear(page)).toBeFocused();
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`radio`, { name: `Ink` })).toBeFocused();
    await page.keyboard.press(`Escape`);
    await expect(panel(page)).toHaveCount(0);
    await expect(gear(page)).toBeFocused();
});

test('a theme applies live and persists, by click and by arrow key', async ({ page }) => {
    const before = themes[themes.findIndex((theme) => theme.id === `omok`) - 1];
    if (before === undefined) throw new Error(`omok has no theme before it`);
    await ladder(page, 1280);
    await gear(page).click();
    await page.locator(`label.theme-card`, { hasText: `Omok` }).click();
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, `omok`);
    expect(await page.evaluate(() => window.localStorage.getItem(`hexo-arena.theme.v1`))).toBe(`omok`);
    await page.getByRole(`radio`, { name: `Omok` }).focus();
    await page.keyboard.press(`ArrowLeft`);
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, before.id);
    await expect(page.getByRole(`radio`, { name: before.label })).toBeChecked();
    await page.reload();
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, before.id);
});

test('the stone numbers switch writes the stored board setting by click and by key', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).click();
    await page.getByText(`Stone numbers`).click();
    await expect(page.getByRole(`switch`, { name: `Stone numbers` })).toBeChecked();
    const read = () => page.evaluate(() => JSON.parse(window.localStorage.getItem(`hexo-arena.board-rendering.v1`) ?? `null`) as unknown);
    expect(await read()).toEqual({ numbers: true, glare: true });
    await page.getByRole(`switch`, { name: `Stone numbers` }).focus();
    await page.keyboard.press(`Space`);
    await expect(page.getByRole(`switch`, { name: `Stone numbers` })).not.toBeChecked();
    expect(await read()).toEqual({ numbers: false, glare: true });
});

test('the credits link closes the panel and opens the credits page with its title', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).click();
    await expect(page.locator(`label.theme-card`, { hasText: `HDS` })).toContainText(`hexo.did.science, via MineKing`);
    await panel(page).getByRole(`link`, { name: `Credits` }).click();
    await expect(page).toHaveURL(/\/credits$/);
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole(`heading`, { level: 1 })).toHaveText(`Credits`);
    await expect(page).toHaveTitle(`Credits - HeXO Arena`);
    await expect(gear(page)).not.toBeFocused();
});

test('the glare switch, on by default, writes the setting and zeroes the glare on swatches and boards', async ({ page }) => {
    await ladder(page, 1280);
    await gear(page).click();
    const shine = (scope: string) =>
        page.locator(`${scope} .shine`).evaluateAll((layers) => layers.map((layer) => Number(getComputedStyle(layer).opacity)));
    await expect(page.getByRole(`switch`, { name: `Stone glare` })).toBeChecked();
    expect((await shine(`.theme-swatch`)).every((opacity) => opacity > 0)).toBe(true);
    await page.getByText(`Stone glare`).click();
    await expect(page.getByRole(`switch`, { name: `Stone glare` })).not.toBeChecked();
    const stored = await page.evaluate(() => window.localStorage.getItem(`hexo-arena.board-rendering.v1`));
    expect(JSON.parse(stored ?? `null`)).toEqual({ numbers: false, glare: false });
    const faded = await shine(`.theme-swatch`);
    expect(faded).toHaveLength(2 * themes.length);
    expect(faded.every((opacity) => opacity === 0)).toBe(true);
    await page.goto(`/game/running`);
    await page.locator(`.board-svg g.stone`).first().waitFor();
    const board = await shine(`.board-svg`);
    expect(board.length).toBeGreaterThan(0);
    expect(board.every((opacity) => opacity === 0)).toBe(true);
});

// A probe swatch without a preview scope paints in whatever the root
// wears; each card's swatch must paint exactly as the probe does when the
// root wears that card's theme, whichever theme the page wears meanwhile.
for (const worn of looks) {
    test(`every swatch paints its own theme while the page wears ${worn.name}`, async ({ page }) => {
        await wear(page, worn);
        await serve(page, world());
        await page.goto(`/`);
        await gear(page).click();
        const { expected, shown } = await page.evaluate(
            ({ ids, wornId }) => {
                const root = document.documentElement;
                const probe = document.createElementNS(`http://www.w3.org/2000/svg`, `svg`);
                probe.setAttribute(`class`, `theme-swatch`);
                probe.innerHTML = [`x`, `o`]
                    .map((side) => `<polygon class="body b-${side}"/><polygon class="shine"/><polygon class="stone-mark m-${side}"/>`)
                    .join(``);
                document.body.append(probe);
                function paint(scope: Element): string[] {
                    const style = (selector: string) => {
                        const element = scope.querySelector(selector);
                        if (element === null) throw new Error(`${selector} is missing`);
                        return getComputedStyle(element);
                    };
                    return [
                        getComputedStyle(scope).backgroundColor,
                        style(`.b-x`).fill,
                        style(`.b-o`).fill,
                        style(`.b-x`).stroke,
                        style(`.shine`).opacity,
                        style(`.m-x`).stroke,
                        style(`.m-o`).stroke,
                    ];
                }
                const expected: Record<string, string[]> = {};
                for (const id of ids) {
                    root.dataset.theme = id;
                    expected[id] = paint(probe);
                }
                root.dataset.theme = wornId;
                probe.remove();
                const shown: Record<string, string[]> = {};
                for (const id of ids) {
                    const swatch = document.querySelector(`.theme-swatch[data-theme-preview="${id}"]`);
                    if (swatch === null) throw new Error(`no swatch for ${id}`);
                    shown[id] = paint(swatch);
                }
                return { expected, shown };
            },
            { ids: themes.map((theme) => theme.id), wornId: worn.name },
        );
        expect(new Set(Object.values(expected).map((paints) => JSON.stringify(paints))).size).toBe(themes.length);
        expect(shown).toEqual(expected);
        await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, worn.name);
    });
}
