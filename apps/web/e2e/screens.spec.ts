import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { defaultTheme } from '../src/theme/themes';
import { capturing, looks, shots, sweep, viewports, wear, type Look, type Shot, type Viewport } from './matrix';
import { serve } from './mock-api';

// Every screen in every state at every viewport in the default look, and in
// every other look at its first width, holds the probed gates, which fail
// the run on their own: contrast, named table headers, links told from their
// text by more than hue, and sideways scroll.
// A look changes colors alone, so the other looks are switched in the page
// and held to the gates colors can break.
// With E2E_SHOTS=1 each test also captures what it checked for review: the
// default look at every width, and each other look where a board is on screen.

const others = looks.filter((look) => look.name !== defaultTheme);
const rules = [`color-contrast`, `empty-table-header`, `heading-order`, `link-in-text-block`];
const colorRules = [`color-contrast`, `link-in-text-block`];

// Under reduced motion every transition and animation stands at its end at
// once, so the gates read end states without waiting the motion out.
async function open(page: Page, shot: Shot, viewport: Viewport): Promise<void> {
    await page.emulateMedia({ reducedMotion: `reduce` });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await wear(page, { name: defaultTheme, storage: shot.storage ?? {} });
    await serve(page, structuredClone(shot.world));
    await page.goto(shot.path);
    await page.locator(shot.ready).first().waitFor();
    if (shot.after !== undefined) await shot.after(page);
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
}

// A reader switches the look in the settings, which only sets the root's
// attribute, so the attribute is set here; where the settings are open the
// look is picked there, so the picker shows it chosen.
async function restyle(page: Page, look: Look): Promise<void> {
    await page.evaluate((theme) => {
        const choice = document.querySelector(`dialog.settings[open] input[name="settings-theme"][value="${theme}"]`);
        if (choice instanceof HTMLInputElement) {
            choice.focus();
            choice.click();
        } else {
            document.documentElement.dataset.theme = theme;
        }
    }, look.name);
    await expect(page.locator(`html`)).toHaveAttribute(`data-theme`, look.name);
}

async function capture(page: Page, shot: Shot, look: string, viewport: Viewport): Promise<void> {
    if (!capturing) return;
    // Captured whole, a fixed bar would stand where the window's foot was, over the page,
    // so the phone's tab bar is put back in the flow after the footer.
    await page.screenshot({
        path: `e2e/shots/${shot.name}--${look}--${viewport.name}.png`,
        ...(shot.fullPage === true ? { fullPage: true, style: `.tabbar { position: static !important; } body { padding-bottom: 0 !important; }` } : {}),
    });
}

async function violations(page: Page, gates: string[]): Promise<string[][]> {
    const axe = await new AxeBuilder({ page }).withRules(gates).analyze();
    return axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target.map(String)));
}

// Framed screens must never scroll sideways; the game stage owns the
// viewport and scrolls its board by design.
async function overflow(page: Page, shot: Shot): Promise<number> {
    if (!shot.framed) return 0;
    return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

for (const shot of shots) {
    const widths = shot.viewports ?? viewports;
    for (const [index, viewport] of widths.entries()) {
        test(`${shot.name} holds its axe gates and layout in ${defaultTheme} at ${viewport.name}`, index === 0 || viewport.name === `phone` ? {} : sweep, async ({ page }) => {
            await open(page, shot, viewport);
            await capture(page, shot, defaultTheme, viewport);
            expect(await violations(page, rules)).toEqual([]);
            expect(await overflow(page, shot)).toBeLessThanOrEqual(0);
        });
    }

    const first = widths[0];
    if (first === undefined) continue;
    test(`${shot.name} holds its color gates and layout in every other look at ${first.name}`, sweep, async ({ page }) => {
        await open(page, shot, first);
        const faults: Record<string, { targets: string[][]; overflow: number }> = {};
        for (const look of others) {
            await restyle(page, look);
            if (shot.board === true) await capture(page, shot, look.name, first);
            const found = { targets: await violations(page, colorRules), overflow: await overflow(page, shot) };
            if (found.targets.length > 0 || found.overflow > 0) faults[look.name] = found;
        }
        expect(faults).toEqual({});
    });
}
