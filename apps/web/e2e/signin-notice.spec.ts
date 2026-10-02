import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { playBots, serve, world } from './mock-api';

const guest: Me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };

// How many lines a note runs to and how many words its last one holds; a
// word runs across the note's text nodes, as "Privacy" and its period do.
function lastLine(element: Element): { lines: number; words: number } {
    const chars: { node: Node; offset: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        for (let offset = 0; offset < (node.textContent ?? ``).length; offset += 1) chars.push({ node, offset });
    }
    const text = chars.map(({ node, offset }) => (node.textContent ?? ``)[offset] ?? ``).join(``);
    const bottoms: number[] = [];
    for (const match of text.matchAll(/\S+/gu)) {
        const end = chars[match.index + match[0].length - 1];
        if (end === undefined) continue;
        const range = document.createRange();
        range.setStart(end.node, end.offset);
        range.setEnd(end.node, end.offset + 1);
        bottoms.push(Math.round(range.getBoundingClientRect().bottom));
    }
    const bottom = Math.max(...bottoms);
    return { lines: new Set(bottoms).size, words: bottoms.filter((entry) => entry === bottom).length };
}

// Every place a visitor decides whether to sign in carries the trust line
// right beside its Discord button: on the button's line, or just under it.
const places: readonly { name: string; path: string; me: Me; open?: (page: Page) => Promise<void> }[] = [
    { name: `build a bot, signed out`, path: `/connect`, me: null },
    { name: `profile, signed out`, path: `/profile`, me: null },
    { name: `profile, as a guest`, path: `/profile`, me: guest },
    {
        name: `the guest menu`,
        path: `/ladder`,
        me: guest,
        open: async (page) => {
            await page.locator(`header button.identity`).click();
        },
    },
];

for (const place of places) {
    for (const width of [1280, 390, 320]) {
        test(`the trust line stands beside the Discord button in ${place.name} at ${String(width)} px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            const look = looks[0];
            if (look === undefined) throw new Error(`no look registered`);
            await wear(page, look);
            await serve(page, world({ me: place.me }));
            await page.goto(place.path);
            await page.locator(`h1`).first().waitFor();
            await place.open?.(page);
            const pairs = page.locator(`.discord-sign-in:visible`);
            await expect(pairs.first()).toBeVisible();
            // A panel slides in, and a sheet on a phone rises, so the pair is
            // measured once every animation on the page has finished.
            await page.evaluate(async () => {
                await Promise.all(document.getAnimations().map(async (animation) => animation.finished));
            });
            for (const pair of await pairs.all()) {
                const button = await pair.locator(`a.discord-button`).boundingBox();
                const note = pair.locator(`.note`);
                await expect(note).toHaveText(
                    place.me?.kind === `guest`
                        ? `Signing in ends this guest session and its live games. Your email stays with Discord; see\u00a0Privacy.`
                        : `Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`,
                );
                await expect(note.getByRole(`link`, { name: `Privacy` })).toHaveAttribute(`href`, `/legal/privacy`);
                // The last line holds at least two words, links included.
                const last = await note.evaluate(lastLine);
                if (last.lines > 1) expect(last.words).toBeGreaterThan(1);
                const box = await note.boundingBox();
                if (button === null || box === null) throw new Error(`the pair is not laid out`);
                const beside = box.x >= button.x + button.width && box.y < button.y + button.height;
                const under = box.y >= button.y + button.height - 0.5 && box.y <= button.y + button.height + 16 && Math.abs(box.x - button.x) <= 1;
                expect(beside || under).toBe(true);
            }
        });
    }
}

// Resized from 320 to 1280 px, and to 200% text, the trust line never ends
// on a word alone, wherever it stands in the page; a panel keeps the form it
// opened in, so the sweep covers the page places.
for (const place of places.filter((entry) => entry.name !== `the guest menu`)) {
    test(`the trust line in ${place.name} never ends on a lone word from 320 to 1280 px`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 900 });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world({ me: place.me }));
        await page.goto(place.path);
        await page.locator(`h1`).first().waitFor();
        await place.open?.(page);
        const devtools = await page.context().newCDPSession(page);
        const lone: string[] = [];
        for (const size of [16, 32]) {
            await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
            for (let width = 320; width <= 1280; width += 10) {
                await page.setViewportSize({ width, height: 900 });
                const lasts = await Promise.all((await page.locator(`.discord-sign-in:visible .note`).all()).map(async (note) => note.evaluate(lastLine)));
                for (const last of lasts) if (last.lines > 1 && last.words < 2) lone.push(`${String(size)} px text at ${String(width)} px`);
            }
        }
        expect(lone).toEqual([]);
    });
}

// Signed out, the Play start area offers a guest game and a sign-in side
// by side, with one notice under both that covers either choice.
async function openPlay(page: Page, width: number): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null, bots: playBots }));
    await page.goto(`/play?bot=devbot-c`);
    await page.locator(`.start-notice`).waitFor();
}

for (const width of [1280, 390, 320]) {
    test(`one notice stands under both Play start buttons at ${String(width)} px`, async ({ page }) => {
        await openPlay(page, width);
        const note = page.locator(`.start-notice`);
        await expect(note).toHaveText(
            `By playing as a guest you accept the Terms, including the minimum age of 16. Your email stays with Discord, and a first sign-in asks for your public name; see\u00a0Privacy.`,
        );
        await expect(note.getByRole(`link`, { name: `Terms` })).toHaveAttribute(`href`, `/legal/terms`);
        await expect(note.getByRole(`link`, { name: `Privacy` })).toHaveAttribute(`href`, `/legal/privacy`);
        const last = await note.evaluate(lastLine);
        if (last.lines > 1) expect(last.words).toBeGreaterThan(1);
        const guest = await page.getByRole(`button`, { name: `Play as guest` }).boundingBox();
        const discord = await page.locator(`.start-area a.discord-button`).boundingBox();
        const box = await note.boundingBox();
        if (guest === null || discord === null || box === null) throw new Error(`the start area is not laid out`);
        const bottom = Math.max(guest.y + guest.height, discord.y + discord.height);
        expect(box.y).toBeGreaterThanOrEqual(bottom - 0.5);
        expect(box.y).toBeLessThanOrEqual(bottom + 16);
        expect(Math.abs(box.x - Math.min(guest.x, discord.x))).toBeLessThanOrEqual(1);
    });
}

test('the Play notice never ends on a lone word from 320 to 1280 px', async ({ page }) => {
    await openPlay(page, 1280);
    const devtools = await page.context().newCDPSession(page);
    const lone: string[] = [];
    for (const size of [16, 32]) {
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
        for (let width = 320; width <= 1280; width += 10) {
            await page.setViewportSize({ width, height: 900 });
            const last = await page.locator(`.start-notice`).evaluate(lastLine);
            if (last.lines > 1 && last.words < 2) lone.push(`${String(size)} px text at ${String(width)} px`);
        }
    }
    expect(lone).toEqual([]);
});
