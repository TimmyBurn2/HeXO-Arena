import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { defaultTheme } from '../src/theme/themes';
import { looks, shots, viewports, wear } from './matrix';
import { serve } from './mock-api';

// Every screen in every state at every viewport in the default look, and
// every board-bearing screen in every look: a screenshot for review plus
// the probed gates, which fail the run on their own: contrast, named
// table headers, links told from their text by more than hue, and
// sideways scroll.
for (const look of looks) {
    for (const shot of shots.filter((entry) => entry.board !== undefined || look.name === defaultTheme)) {
        const widths = look.name === defaultTheme || shot.board === undefined || shot.board === true ? (shot.viewports ?? viewports) : shot.board;
        for (const viewport of widths) {
            test(`${shot.name} holds its axe gates and layout in ${look.name} at ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await wear(page, { name: look.name, storage: { ...look.storage, ...shot.storage } });
                await serve(page, structuredClone(shot.world));
                await page.goto(shot.path);
                await page.locator(shot.ready).first().waitFor();
                if (shot.after !== undefined) await shot.after(page);
                await settle(page);

                // Captured whole, a fixed bar would stand where the window's foot was, over the page,
                // so the phone's tab bar is put back in the flow after the footer.
                await page.screenshot({
                    path: `e2e/shots/${shot.name}--${look.name}--${viewport.name}.png`,
                    ...(shot.fullPage === true ? { fullPage: true, style: `.tabbar { position: static !important; } body { padding-bottom: 0 !important; }` } : {}),
                });

                const axe = await new AxeBuilder({ page }).withRules([`color-contrast`, `empty-table-header`, `heading-order`, `link-in-text-block`]).analyze();
                expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);

                if (shot.framed) {
                    const overflow = await page.evaluate(
                        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
                    );
                    expect(overflow).toBeLessThanOrEqual(0);
                }
            });
        }
    }
}

async function settle(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
    });
    // Motion tops out at 180 ms; waiting past it captures end states.
    await page.waitForTimeout(250);
}
