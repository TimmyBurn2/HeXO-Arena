import { expect, test, type Page } from '@playwright/test';
import { shots, wear, type Viewport } from './matrix';
import { serve } from './mock-api';

// The literal gate holds every duration in the sheets to the scale's tokens,
// and the tokens to the motion band; these pages, one per kind of motion,
// show the tokens at work in the browser: every computed duration is one of
// them, and under reduced motion every duration is zero.
const desktop: Viewport = { name: `desktop`, width: 1440, height: 900 };
const laptop: Viewport = { name: `laptop`, width: 1280, height: 900 };
const phone: Viewport = { name: `phone`, width: 390, height: 844 };
const pages: readonly (readonly [string, Viewport, string])[] = [
    [`home`, desktop, `links, rows, and buttons under the pointer`],
    [`menu-settings`, laptop, `a popover dropping from the bar`],
    [`menu-identity`, phone, `a sheet rising on a phone`],
    [`game-your-move`, desktop, `stones landing and the clocks`],
    [`game-pending`, desktop, `the pending stone`],
    [`game-drawer`, desktop, `the game drawer and its lines`],
    [`game-analysis`, phone, `the game sheet on a phone`],
    [`analysis-reading`, desktop, `the analysis board's lines`],
    [`play-opening`, desktop, `the opening preview`],
    [`home-duel-picker`, phone, `the bot picker`],
];

async function durations(page: Page): Promise<{ found: number[]; tokens: number[] }> {
    return page.evaluate(() => {
        const ms = (value: string) => (value.trim().endsWith(`ms`) ? Number.parseFloat(value) : Number.parseFloat(value) * 1000);
        const found: number[] = [];
        for (const element of Array.from(document.querySelectorAll(`*`))) {
            const style = getComputedStyle(element);
            for (const list of [style.transitionDuration, style.animationDuration]) {
                for (const part of list.split(`,`)) {
                    const value = ms(part);
                    if (Number.isFinite(value)) found.push(value);
                }
            }
        }
        const root = getComputedStyle(document.documentElement);
        const tokens = [`--dur-fast`, `--dur-base`, `--dur-slow`].map((name) => ms(root.getPropertyValue(name)));
        return { found, tokens };
    });
}

for (const [name, viewport, motion] of pages) {
    test(`motion on ${motion} runs at the scale's durations and stops under reduced motion`, async ({ page }) => {
        const shot = shots.find((entry) => entry.name === name);
        if (shot === undefined) throw new Error(`no shot named ${name}`);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await wear(page, { name: shot.name, storage: shot.storage ?? {} });
        await serve(page, structuredClone(shot.world));
        await page.goto(shot.path);
        await page.locator(shot.ready).first().waitFor();
        if (shot.after !== undefined) await shot.after(page);

        const moving = await durations(page);
        expect(moving.tokens.every((token) => token > 0)).toBe(true);
        expect(moving.found.some((ms) => ms > 0)).toBe(true);
        expect(moving.found.filter((ms) => ms !== 0 && !moving.tokens.includes(ms))).toEqual([]);

        await page.emulateMedia({ reducedMotion: `reduce` });
        const still = await durations(page);
        expect(still.tokens).toEqual([0, 0, 0]);
        expect(still.found.filter((ms) => ms !== 0)).toEqual([]);
    });
}
