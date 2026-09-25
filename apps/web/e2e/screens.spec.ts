import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { looks, shots, viewports, wear } from './matrix';
import { serve } from './mock-api';

// Every screen, in every state, under every look, at every viewport: a
// screenshot for review plus the probed gates, contrast and sideways
// scroll, which fail the run on their own.
for (const look of looks) {
    for (const viewport of viewports) {
        for (const shot of shots) {
            test(`${shot.name} holds contrast and layout in ${look.name} at ${viewport.name}`, async ({ page }) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await wear(page, look);
                await serve(page, structuredClone(shot.world));
                await page.goto(shot.path);
                await page.locator(shot.ready).first().waitFor();
                if (shot.after !== undefined) await shot.after(page);
                await settle(page);

                await page.screenshot({
                    path: `e2e/shots/${shot.name}--${look.name}--${viewport.name}.png`,
                });

                const contrast = await new AxeBuilder({ page }).withRules([`color-contrast`]).analyze();
                expect(contrast.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);

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
