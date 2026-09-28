import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `tom`, rating: 1503, provisional: false } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9` } },
];

const screens: readonly { name: string; path: string }[] = [
    { name: `the root`, path: `/` },
    { name: `the ladder`, path: `/ladder` },
    { name: `bots`, path: `/bots` },
    { name: `a bot page`, path: `/bots/sealbot` },
    { name: `build a bot`, path: `/connect` },
    { name: `profile`, path: `/profile` },
    { name: `credits`, path: `/credits` },
    { name: `a missing page`, path: `/nowhere` },
    { name: `a missing game`, path: `/game/nope` },
];

// The screen matrix jumps from phone to tablet; the band between is where
// the nav links return beside the gear and who is here, so it is swept
// closely, from the narrowest phone out to the desktop widths, on every
// framed screen, with the edges where the mark comes and goes.
const widths = [320, 336, 337, 360, 480, 481, 513, 520, 528, 529, 560, 600, 640, 641, 700, 767, 768, 1024, 1280];

type Box = { x: number; y: number; width: number; height: number };

// Everything the checks read, taken in one call into the page: a loaded
// machine stretches every round trip, and one per element ran the sweep
// past its test budget.
async function readBar(page: Page, signedIn: boolean) {
    return page.evaluate((signedIn) => {
        // As Playwright reads them: an element without a layout box has no
        // box, and a visible one has area and is not hidden.
        const boxOf = (element: Element | null | undefined): Box | null => {
            if (element === null || element === undefined || element.getClientRects().length === 0) return null;
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
        };
        const isVisible = (element: Element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== `hidden`;
        };
        const textRange = (node: Node) => {
            const range = document.createRange();
            range.selectNodeContents(node);
            return range;
        };
        const lineCount = (range: Range) => new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        const who = signedIn
            ? document.querySelector(`header button.identity`)
            : [...document.querySelectorAll(`header button`)].find((button) => button.textContent === `Sign in with Discord`);
        // The wordmark keeps one line and clears whatever stands to its right;
        // the lines are its text's, since the mark beside it stands taller.
        const brand = document.querySelector(`header .brand`);
        const name = brand === null ? undefined : [...brand.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        const words = name === undefined ? document.createRange() : textRange(name);
        const text = words.getBoundingClientRect();
        const mark = document.querySelector(`header .brand-mark`);
        const links = [...document.querySelectorAll(`.nav-links .nav-link`)];
        return {
            who: boxOf(who),
            brand: {
                lines: lineCount(words),
                right: brand === null ? Infinity : textRange(brand).getBoundingClientRect().right,
                left: text.left,
                middle: text.top + text.height / 2,
            },
            mark: mark !== null && isVisible(mark) ? boxOf(mark) : null,
            beside: [...document.querySelectorAll(`.nav-links .nav-link, .nav-right`)].filter(isVisible).map(boxOf),
            gear: boxOf(document.querySelector(`header button[aria-label="Settings"]`)),
            links: links.filter(isVisible).map((link) => ({ box: boxOf(link), lines: lineCount(textRange(link)) })),
            texts: links.map((link) => {
                const box = textRange(link).getBoundingClientRect();
                return { left: box.left, right: box.right };
            }),
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
    }, signedIn);
}

async function barFits(page: Page, width: number, signedIn: boolean): Promise<void> {
    const bar = await readBar(page, signedIn);
    expect(bar.who === null ? Infinity : bar.who.x + bar.who.width).toBeLessThanOrEqual(width);
    expect(bar.brand.lines).toBe(1);
    // The mark shows where the row has room for it: above 40rem, and on
    // phones from 21rem to 30rem, where the nav links move to the tab bar;
    // it stands before the name, centered on its line.
    const shown = width > 640 || (width > 336 && width <= 480);
    expect(bar.mark !== null).toBe(shown);
    if (shown) {
        const box = bar.mark;
        expect(box === null ? Infinity : box.x + box.width).toBeLessThanOrEqual(bar.brand.left);
        expect(Math.abs((box === null ? Infinity : box.y + box.height / 2) - bar.brand.middle)).toBeLessThanOrEqual(1);
    }
    for (const box of bar.beside) {
        expect(box === null ? -Infinity : box.x).toBeGreaterThanOrEqual(bar.brand.right);
    }
    // The gear holds its square however little room the row has.
    const gear = bar.gear;
    expect(gear === null ? 0 : Math.round(gear.width)).toBe(gear === null ? -1 : Math.round(gear.height));
    // Each nav label keeps one line and clears the gear.
    for (const link of bar.links) {
        expect(link.box === null ? Infinity : link.box.x + link.box.width).toBeLessThanOrEqual(gear === null ? 0 : gear.x);
        expect(link.lines).toBe(1);
    }
    // Past the band's narrow end the labels keep a gap of at least
    // --space-4 between them, so they never read as one phrase.
    if (width >= 520) {
        for (const [index, edge] of bar.texts.entries()) {
            const before = bar.texts[index - 1];
            if (before !== undefined) expect(edge.left - before.right).toBeGreaterThanOrEqual(16);
        }
    }
    // The wordmark stands further from the first label than the labels
    // stand from each other, wherever the bar has the room: everywhere
    // but the signed-out bar up to 33rem.
    if (width > 480 && (signedIn || width > 528)) {
        const between = bar.texts.slice(1).map((text, index) => text.left - (bar.texts[index]?.right ?? text.left));
        expect((bar.texts[0]?.left ?? 0) - bar.brand.right).toBeGreaterThan(Math.max(...between));
    }
    expect(bar.overflow).toBeLessThanOrEqual(0);
}

for (const visitor of visitors) {
    for (const screen of screens) {
        for (const width of widths) {
            test(`the ${visitor.name} top bar on ${screen.name} fits at ${String(width)} px, its menu shut and open`, async ({ page }) => {
                await page.setViewportSize({ width, height: 800 });
                const look = looks[0];
                if (look === undefined) throw new Error(`no look registered`);
                await wear(page, look);
                await serve(page, world({ me: visitor.me }));
                await page.goto(screen.path);
                await page.locator(`h1`).first().waitFor();
                const signedIn = visitor.me !== null;
                if (signedIn) await page.locator(`header button.identity`).waitFor();
                await barFits(page, width, signedIn);

                // Signed out, the sign-in opens its own panel.
                await (signedIn ? page.locator(`header button.identity`) : page.locator(`header`).getByRole(`button`, { name: `Sign in with Discord` })).click();
                const panel = page.locator(`dialog[open]`);
                await expect(panel).toHaveCount(1);
                const header = await page.locator(`header.topbar`).boundingBox();
                const barBottom = (header?.y ?? 0) + (header?.height ?? Infinity);
                // The panel slides in, so its resting box is polled for.
                await expect
                    .poll(async () => {
                        const box = await panel.boundingBox();
                        if (box === null) return `no panel`;
                        if (box.x < 0 || box.x + box.width > width) return `outside the window`;
                        if (width <= 480) return Math.round(box.width) === width ? `in place` : `a sheet short of the width`;
                        return box.y >= barBottom - 1 ? `in place` : `over the bar`;
                    })
                    .toBe(`in place`);
                await barFits(page, width, signedIn);
            });
        }
    }
}

test('on a phone the tabs are the nav entries and Profile opens from the monogram', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/ladder`);
    await page.locator(`h1`).waitFor();
    await expect(page.locator(`nav.tabbar a`)).toHaveText([`Ladder`, `Bots`, `Build a bot`]);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveText(`Ladder`);
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel`).getByRole(`link`, { name: `Profile` }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveCount(0);
    await expect(page.locator(`header button.identity`)).toHaveClass(/\bactive\b/);
});

// The mark takes the brass, and brightens with the home link under the
// pointer as the brass buttons do, in every theme.
for (const look of looks) {
    test(`the mark wears the brass in ${look.name} and brightens on hover`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await wear(page, look);
        await serve(page, world());
        await page.goto(`/ladder`);
        const mark = page.locator(`header .brand-mark`);
        await mark.waitFor();
        // A token's color as the page computes it, through a probe element.
        const token = (name: string) =>
            page.evaluate((property) => {
                const probe = document.createElement(`span`);
                probe.style.color = `var(${property})`;
                document.body.append(probe);
                const color = getComputedStyle(probe).color;
                probe.remove();
                return color;
            }, name);
        const fill = () => mark.evaluate((element) => getComputedStyle(element).fill);
        await expect.poll(fill).toBe(await token(`--c-accent-solid`));
        await page.locator(`header .brand`).hover();
        await expect.poll(fill).toBe(await token(`--c-accent-solid-hover`));
    });
}

test('under forced colors the mark takes the home link color, at rest and hovered', async ({ page }) => {
    await page.emulateMedia({ forcedColors: `active` });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/ladder`);
    const mark = page.locator(`header .brand-mark`);
    const colors = () =>
        mark.evaluate((element) => ({
            fill: getComputedStyle(element).fill,
            link: getComputedStyle(element.closest(`a`) ?? element).color,
        }));
    const rest = await colors();
    expect(rest.fill).toBe(rest.link);
    await page.locator(`header .brand`).hover();
    const hovered = await colors();
    expect(hovered.fill).toBe(hovered.link);
});

// The subset holds only the wordmark's glyphs, so a wordmark it does not
// cover would fall back to the system face without any visible error.
test('the wordmark renders every glyph in Chakra Petch', async ({ page }) => {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/ladder`);
    const brand = page.locator(`header .brand`);
    await expect(brand).toHaveText(`HeXO Arena`);
    await page.evaluate(() => document.fonts.ready);
    const devtools = await page.context().newCDPSession(page);
    await devtools.send(`DOM.enable`);
    await devtools.send(`CSS.enable`);
    const { root } = await devtools.send(`DOM.getDocument`);
    const { nodeId } = await devtools.send(`DOM.querySelector`, { nodeId: root.nodeId, selector: `header .brand` });
    const { fonts } = await devtools.send(`CSS.getPlatformFontsForNode`, { nodeId });
    expect(fonts.map((font) => [font.familyName, font.isCustomFont, font.glyphCount])).toEqual([[`Chakra Petch`, true, `HeXO Arena`.length]]);
});
