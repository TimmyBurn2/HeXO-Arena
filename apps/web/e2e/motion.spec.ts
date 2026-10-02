import { expect, test, type Page } from '@playwright/test';
import { shots, wear, type Shot } from './matrix';
import { serve } from './mock-api';

// Every computed duration on every element: zero, or inside the motion
// band; under reduced motion, zero everywhere.
const bandMs: readonly [number, number] = [120, 180];

async function durations(page: Page): Promise<number[]> {
    return page.evaluate(() => {
        const found: number[] = [];
        for (const element of Array.from(document.querySelectorAll(`*`))) {
            const style = getComputedStyle(element);
            for (const list of [style.transitionDuration, style.animationDuration]) {
                for (const part of list.split(`,`)) {
                    const value = part.trim();
                    const ms = value.endsWith(`ms`) ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
                    if (Number.isFinite(ms)) found.push(ms);
                }
            }
        }
        return found;
    });
}

// A shot with widths of its own, such as a phone's sheet, is opened at the
// first of them, where its controls exist.
async function size(page: Page, shot: Shot): Promise<void> {
    const viewport = shot.viewports?.[0];
    if (viewport !== undefined) await page.setViewportSize({ width: viewport.width, height: viewport.height });
}

for (const shot of shots) {
    test(`${shot.name} moves only inside the motion band`, async ({ page }) => {
        await size(page, shot);
        await wear(page, { name: shot.name, storage: shot.storage ?? {} });
        await serve(page, structuredClone(shot.world));
        await page.goto(shot.path);
        await page.locator(shot.ready).first().waitFor();
        if (shot.after !== undefined) await shot.after(page);
        const outside = (await durations(page)).filter((ms) => ms !== 0 && (ms < bandMs[0] || ms > bandMs[1]));
        expect(outside).toEqual([]);
    });

    test(`${shot.name} holds still under reduced motion`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: `reduce` });
        await size(page, shot);
        await serve(page, structuredClone(shot.world));
        await page.goto(shot.path);
        await page.locator(shot.ready).first().waitFor();
        if (shot.after !== undefined) await shot.after(page);
        expect((await durations(page)).filter((ms) => ms !== 0)).toEqual([]);
    });
}
