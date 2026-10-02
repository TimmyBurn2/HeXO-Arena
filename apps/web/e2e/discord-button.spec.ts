import { expect, test } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// Forced colors paint author backgrounds away, the Discord face and its
// focus ring among them, so the button keeps a system outline for focus and
// its symbol takes the link's text color.
test('under forced colors the Discord button shows its focus and its symbol', async ({ page }) => {
    await page.emulateMedia({ forcedColors: `active` });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.goto(`/connect`);
    const link = page.locator(`main a.discord-button`);
    await link.waitFor();
    // Tab reaches the link from the control before it, as a keyboard does.
    await page.locator(`main h1`).click();
    for (let step = 0; step < 20 && !(await link.evaluate((element) => element === document.activeElement)); step += 1) {
        await page.keyboard.press(`Tab`);
    }
    const seen = await link.evaluate((element) => {
        const style = getComputedStyle(element);
        const symbol = element.querySelector(`.discord-symbol`);
        return {
            visible: element.matches(`:focus-visible`),
            outline: style.outlineStyle,
            width: style.outlineWidth,
            symbol: symbol === null ? `` : getComputedStyle(symbol).fill,
            text: style.color,
        };
    });
    expect(seen.visible).toBe(true);
    expect(seen.outline).toBe(`solid`);
    expect(seen.width).toBe(`2px`);
    expect(seen.symbol).toBe(seen.text);
});
