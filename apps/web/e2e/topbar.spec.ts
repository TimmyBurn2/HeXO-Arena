import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [] } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false, discord: { username: `owner.of.sealbot.and.two.more.xy`, displayName: `The Owner Of Sealbot And Two Mor` }, liveGames: [] } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } },
];

const screens: readonly { name: string; path: string }[] = [
    { name: `the root`, path: `/` },
    { name: `play`, path: `/play` },
    { name: `live games`, path: `/games/live` },
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
const widths = [320, 352, 353, 360, 480, 481, 560, 600, 640, 656, 657, 700, 740, 768, 769, 800, 848, 849, 1024, 1280];

// The nav links sit in the tab bar up to 41rem,
// and share the bar, drawn tighter, up to 48rem;
// who is here folds to its monogram up to 53rem.
const band = { from: 656, to: 768, fold: 848 };

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
            : [...document.querySelectorAll(`header a.discord-button`)].find((link) => link.textContent === `Sign in with Discord`);
        // The wordmark keeps one line and clears whatever stands to its right;
        // the lines are its text's, since the mark beside it stands taller.
        const brand = document.querySelector(`header .brand`);
        const name = brand === null ? undefined : [...brand.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
        const words = name === undefined ? document.createRange() : textRange(name);
        const text = words.getBoundingClientRect();
        const mark = document.querySelector(`header .brand-mark`);
        const links = [...document.querySelectorAll(`.nav-links .nav-link`)];
        const monogram = who?.querySelector(`.monogram`);
        const label = who?.querySelector(`.identity-label`);
        return {
            who: boxOf(who),
            monogram: boxOf(monogram),
            // A folded label is a clipped pixel; a shown one may be cut short.
            labelShown: label !== null && label !== undefined && label.getBoundingClientRect().width > 1,
            labelCut: label !== null && label !== undefined && label.getBoundingClientRect().width > 1 && label.scrollWidth > label.clientWidth,
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

async function barFits(page: Page, width: number, signedIn: boolean, longName: boolean): Promise<void> {
    const bar = await readBar(page, signedIn);
    expect(bar.who === null ? Infinity : bar.who.x + bar.who.width).toBeLessThanOrEqual(width);
    // Who is here yields its name, never its monogram, and only a name
    // near the length limit is ever cut short.
    if (bar.monogram !== null && bar.who !== null) {
        expect(bar.monogram.x).toBeGreaterThanOrEqual(bar.who.x);
        expect(bar.monogram.x + bar.monogram.width).toBeLessThanOrEqual(bar.who.x + bar.who.width);
    }
    if (!longName) expect(bar.labelCut).toBe(false);
    // Who is here folds only while the row cannot hold a guest's name and tag.
    if (signedIn) expect(bar.labelShown).toBe(width > band.fold);
    expect(bar.brand.lines).toBe(1);
    // The mark shows where the row has room for it: past the band, and on
    // phones from 22rem, where the nav links move to the tab bar; it
    // stands before the name, centered on its line.
    const shown = width > band.to || (width > 352 && width <= band.from);
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
    // Each nav label keeps one line and clears the gear, and the labels
    // stand in the bar exactly past the band's narrow end.
    expect(bar.links.length).toBe(width > band.from ? 5 : 0);
    for (const link of bar.links) {
        expect(link.box === null ? Infinity : link.box.x + link.box.width).toBeLessThanOrEqual(gear === null ? 0 : gear.x);
        expect(link.lines).toBe(1);
    }
    // The labels keep a gap of at least --space-4 between them, so they
    // never read as one phrase.
    if (width > band.from) {
        for (const [index, edge] of bar.texts.entries()) {
            const before = bar.texts[index - 1];
            if (before !== undefined) expect(edge.left - before.right).toBeGreaterThanOrEqual(16);
        }
    }
    // The wordmark stands further from the first label than the labels
    // stand from each other.
    if (width > band.from) {
        const between = bar.texts.slice(1).map((text, index) => text.left - (bar.texts[index]?.right ?? text.left));
        expect((bar.texts[0]?.left ?? 0) - bar.brand.right).toBeGreaterThan(Math.max(...between));
    }
    expect(bar.overflow).toBeLessThanOrEqual(0);
}

for (const visitor of visitors) {
    for (const screen of screens) {
        for (const width of widths) {
            test(`the ${visitor.name} top bar on ${screen.name} fits at ${String(width)} px${visitor.me === null ? `` : `, its menu shut and open`}`, async ({ page }) => {
                await page.setViewportSize({ width, height: 800 });
                const look = looks[0];
                if (look === undefined) throw new Error(`no look registered`);
                await wear(page, look);
                await serve(page, world({ me: visitor.me }));
                await page.goto(screen.path);
                await page.locator(`h1`).first().waitFor();
                const signedIn = visitor.me !== null;
                if (signedIn) await page.locator(`header button.identity`).waitFor();
                await barFits(page, width, signedIn, visitor.name === `long-named`);
                // Signed out, the sign-in is a link straight to Discord and
                // opens nothing here.
                if (!signedIn) return;

                await page.locator(`header button.identity`).click();
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
                await barFits(page, width, signedIn, visitor.name === `long-named`);
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
    await expect(page.locator(`nav.tabbar a`)).toHaveText([`Home`, `Play`, `Games`, `Ladder`, `Bots`]);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveText(`Ladder`);
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel`).getByRole(`link`, { name: `Profile` }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.locator(`nav.tabbar a[aria-current="page"]`)).toHaveCount(0);
    await expect(page.locator(`header button.identity`)).toHaveClass(/\bactive\b/);
});

// The mark wears the default look's board in every theme, so it stays
// one brand; its brass frame brightens with the home link under the
// pointer as the brass buttons do.
for (const look of looks) {
    test(`the mark wears the default board in ${look.name} and brightens its frame on hover`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await wear(page, look);
        await serve(page, world());
        await page.goto(`/ladder`);
        const mark = page.locator(`header .brand-mark`);
        await mark.waitFor();
        // A token's color in the default look, through a probe inside a preview of it.
        const token = (name: string) =>
            page.evaluate((property) => {
                const preview = document.createElement(`div`);
                preview.dataset.themePreview = `ink`;
                const probe = document.createElement(`span`);
                probe.style.color = `var(${property})`;
                preview.append(probe);
                document.body.append(preview);
                const color = getComputedStyle(probe).color;
                preview.remove();
                return color;
            }, name);
        const paints = () =>
            mark.evaluate((element) => {
                const style = (part: string) => getComputedStyle(element.querySelector(`.brand-mark-${part}`) ?? element);
                return { cell: style(`cell`).fill, frame: style(`cell`).stroke, x: style(`x`).fill, o: style(`o`).fill };
            });
        const board = { cell: await token(`--board-cell`), x: await token(`--board-stone-x`), o: await token(`--board-stone-o`) };
        await expect.poll(paints).toEqual({ ...board, frame: await token(`--c-accent-solid`) });
        await page.locator(`header .brand`).hover();
        await expect.poll(paints).toEqual({ ...board, frame: await token(`--c-accent-solid-hover`) });
    });
}

test('under forced colors the mark drops its cell and takes the home link color, at rest and hovered', async ({ page }) => {
    await page.emulateMedia({ forcedColors: `active` });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world());
    await page.goto(`/ladder`);
    const mark = page.locator(`header .brand-mark`);
    const colors = () =>
        mark.evaluate((element) => {
            const style = (part: string) => getComputedStyle(element.querySelector(`.brand-mark-${part}`) ?? element);
            const link = getComputedStyle(element.closest(`a`) ?? element).color;
            return [style(`cell`).fill, style(`cell`).stroke, style(`x`).fill, style(`o`).fill].map((paint) => (paint === link ? `link` : paint));
        });
    expect(await colors()).toEqual([`none`, `link`, `link`, `link`]);
    await page.locator(`header .brand`).hover();
    expect(await colors()).toEqual([`none`, `link`, `link`, `link`]);
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
