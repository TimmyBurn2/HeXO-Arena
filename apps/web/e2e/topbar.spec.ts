import { expect, test } from '@playwright/test';
import type { Me } from '@hexarena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `tom`, rating: 1503, provisional: false } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9` } },
];

// The screen matrix jumps from phone to tablet; the band between is where
// the nav links return beside the gear and who is here, so it is swept here
// for every kind of visitor.
for (const visitor of visitors) {
    for (const width of [360, 481, 520, 560, 600, 640, 641, 700, 767]) {
        test(`the ${visitor.name} top bar fits with its gear at ${String(width)} px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const look = looks[0];
            if (look === undefined) throw new Error(`no look registered`);
            await wear(page, look);
            await serve(page, world({ me: visitor.me }));
            await page.goto(`/bots`);
            const who =
                visitor.me === null
                    ? page.getByRole(`link`, { name: `Sign in with Discord` })
                    : page.locator(`header .identity`);
            await who.waitFor();
            const whoBox = await who.boundingBox();
            expect(whoBox === null ? Infinity : whoBox.x + whoBox.width).toBeLessThanOrEqual(width);
            // The gear holds its square however little room the row has.
            const gear = await page.getByRole(`button`, { name: `Settings`, exact: true }).boundingBox();
            expect(gear === null ? 0 : Math.round(gear.width)).toBe(gear === null ? -1 : Math.round(gear.height));
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(0);
        });
    }
}
