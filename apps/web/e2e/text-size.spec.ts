import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { liveGames, playBots, serve, signup, world, type World } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false, discord: { username: `owner.of.sealbot.and.two.more.xy`, displayName: `The Owner Of Sealbot And Two Mor` } } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9` } },
];

// Every framed screen;
// the first sign-in's page shows its form to someone signed out,
// and hands anyone else on to Profile.
// Play runs on its roster, once more on a bot whose clock note sits beside Custom clock.
const screens: readonly { name: string; path: string; world?: Partial<World> }[] = [
    { name: `the root`, path: `/` },
    { name: `play`, path: `/play`, world: { bots: playBots } },
    { name: `play with a limited bot`, path: `/play?bot=quietlake`, world: { bots: playBots } },
    { name: `live games`, path: `/games/live` },
    { name: `the ladder`, path: `/ladder` },
    { name: `bots`, path: `/bots` },
    { name: `a bot page`, path: `/bots/sealbot` },
    { name: `build a bot`, path: `/connect` },
    { name: `profile`, path: `/profile` },
    { name: `credits`, path: `/credits` },
    { name: `the first sign-in`, path: `/welcome` },
    { name: `the legal notice`, path: `/legal/imprint` },
    { name: `privacy`, path: `/legal/privacy` },
    { name: `terms`, path: `/legal/terms` },
    { name: `a missing page`, path: `/nowhere` },
    { name: `a missing game`, path: `/game/nope` },
];

// Text at 100, 150, and 200% of the default size, as a reader sets it in the browser;
// every rem, breakpoints included, scales with it.
const sizes = [16, 24, 32];
const widths = [320, 360, 390, 414, 480, 540, 600, 656, 700, 768, 820, 900, 1024, 1280];

// Whatever breaks the layout at the width the page stands at, as sentences.
async function faults(page: Page, width: number, longName: boolean): Promise<string[]> {
    return page.evaluate(
        ({ width, longName }) => {
            const found: string[] = [];
            const shown = (element: Element | null): element is Element => element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== `hidden`;
            const lines = (element: Element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
            };
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            if (overflow > 0) found.push(`the page scrolls ${String(overflow)} px sideways`);
            const header = document.querySelector(`header.topbar`);
            for (const element of [...(header?.querySelectorAll(`.brand, .nav-link, .settings-gear, .identity, a.discord-button`) ?? [])].filter(shown)) {
                const box = element.getBoundingClientRect();
                const name = element.classList[0] ?? `?`;
                if (box.left < 0 || box.right > width + 0.5) found.push(`the bar's ${name} runs past the window`);
            }
            const brand = header?.querySelector(`.brand`);
            const words = brand === undefined || brand === null ? undefined : [...brand.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
            if (words !== undefined) {
                const range = document.createRange();
                range.selectNodeContents(words);
                if (new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size !== 1) found.push(`the wordmark breaks`);
            }
            for (const link of [...document.querySelectorAll(`.nav-links .nav-link`)].filter(shown)) {
                if (lines(link) !== 1) found.push(`the ${link.textContent} label breaks`);
            }
            const label = header?.querySelector(`.identity-label`);
            if (!longName && label !== null && label !== undefined && label.getBoundingClientRect().width > 1 && label.scrollWidth > label.clientWidth) found.push(`the name is cut`);
            // Each tab's label stays inside its tab, on one line, and apart from the next label,
            // so the labels never read as one word.
            let before: number | null = null;
            for (const tab of [...document.querySelectorAll(`nav.tabbar .tab-link`)].filter(shown)) {
                const box = tab.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(tab);
                const text = range.getBoundingClientRect();
                if (box.right > width + 0.5 || text.left < box.left - 0.5 || text.right > box.right + 0.5) found.push(`the ${tab.textContent} tab runs past its place`);
                if (lines(tab) !== 1) found.push(`the ${tab.textContent} tab breaks`);
                if (before !== null && text.left - before < 8) found.push(`the ${tab.textContent} tab stands against the one before`);
                before = text.right;
            }
            // A clock preset's words stay inside its tile.
            for (const words of [...document.querySelectorAll(`.clock-tile .clock-value, .clock-tile .clock-kind`)].filter(shown)) {
                const tile = words.closest(`.clock-tile`);
                if (tile === null) continue;
                const range = document.createRange();
                range.selectNodeContents(words);
                const text = range.getBoundingClientRect();
                const box = tile.getBoundingClientRect();
                if (text.left < box.left - 0.5 || text.right > box.right + 0.5) found.push(`the ${words.textContent} preset runs past its tile`);
            }
            // A seat's swatch stands on the first line of its name.
            for (const seat of [...document.querySelectorAll(`.live-seat`)].filter(shown)) {
                const swatch = seat.querySelector(`.swatch`)?.getBoundingClientRect();
                const name = seat.querySelector(`.live-name`);
                if (swatch === undefined || name === null) continue;
                const range = document.createRange();
                range.selectNodeContents(name);
                const first = range.getClientRects()[0];
                const middle = swatch.top + swatch.height / 2;
                if (first !== undefined && (middle < first.top || middle > first.bottom)) found.push(`the swatch of ${name.textContent} stands apart from it`);
            }
            // A name breaks only between its words,
            // never inside a word short enough to fit a line;
            // a word near the name length limit may.
            for (const name of [...document.querySelectorAll(`.player-name, .live-name`)].filter(shown)) {
                const text = name.firstChild;
                if (text === null || text.nodeType !== Node.TEXT_NODE) continue;
                const words = text.textContent ?? ``;
                let top: number | null = null;
                for (let index = 0; index < words.length; index += 1) {
                    const range = document.createRange();
                    range.setStart(text, index);
                    range.setEnd(text, index + 1);
                    const at = Math.round(range.getBoundingClientRect().top);
                    const end = words.indexOf(` `, index);
                    const word = words.slice(words.lastIndexOf(` `, index - 1) + 1, end === -1 ? words.length : end);
                    if (top !== null && at !== top && words[index - 1] !== ` ` && words[index] !== ` ` && word.length <= 12) {
                        found.push(`the name ${words} breaks inside a word`);
                        break;
                    }
                    if (words[index] !== ` `) top = at;
                }
            }
            // A footer link keeps one line;
            // the legal notice, longer than a narrow row at large text,
            // breaks only after its slash.
            for (const link of [...document.querySelectorAll(`footer.site-footer a`)].filter(shown)) {
                const text = link.firstChild;
                if (lines(link) === 1 || text === null || text.nodeType !== Node.TEXT_NODE) continue;
                const words = text.textContent ?? ``;
                const slash = words.indexOf(`/ `);
                const part = (from: number, to: number) => {
                    const range = document.createRange();
                    range.setStart(text, from);
                    range.setEnd(text, to);
                    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
                };
                if (slash < 0 || part(0, slash + 1) !== 1 || part(slash + 2, words.length) !== 1) found.push(`the ${words} link breaks inside a phrase`);
            }
            return found.map((fault) => `${String(width)} px: ${fault}`);
        },
        { width, longName },
    );
}

for (const visitor of visitors) {
    for (const size of sizes) {
        for (const screen of screens) {
            test(`at ${String((size / 16) * 100)}% text the ${visitor.name} bar and ${screen.name} stay inside the window from 320 to 1280 px`, async ({ page }) => {
                const look = looks[0];
                if (look === undefined) throw new Error(`no look registered`);
                await wear(page, look);
                await serve(page, world({ me: visitor.me, signup, live: liveGames, ...screen.world }));
                await page.setViewportSize({ width: widths[0] ?? 320, height: 800 });
                const devtools = await page.context().newCDPSession(page);
                await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
                await page.goto(screen.path);
                await page.locator(`h1`).first().waitFor();
                if (visitor.me !== null) await page.locator(`header button.identity`).waitFor();
                await page.evaluate(async () => {
                    await document.fonts.ready;
                });
                const found: string[] = [];
                for (const width of widths) {
                    await page.setViewportSize({ width, height: 800 });
                    await page.evaluate(
                        () =>
                            new Promise<void>((resolve) => {
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        resolve();
                                    });
                                });
                            }),
                    );
                    found.push(...(await faults(page, width, visitor.name === `long-named`)));
                }
                expect(found).toEqual([]);
            });
        }
    }
}
