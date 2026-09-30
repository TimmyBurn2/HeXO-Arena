import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { LiveGameEntry } from '@hexo-arena/contract';
import { liveGames, playedCells, serve, world } from './mock-api';

// The replay beat and the stones one read adds: a whole turn.
const beatMs = 5_000;
const added = 2;

function growing(): { state: ReturnType<typeof world>; grow: () => void } {
    const [first] = liveGames;
    if (first === undefined) throw new Error(`no live fixture`);
    const before = first.cells.length;
    const entry: LiveGameEntry = { ...first, cells: playedCells(before, 1) };
    const state = world({ live: [entry] });
    return {
        state,
        grow: () => {
            state.live = [{ ...entry, cells: playedCells(before + added, 1), toMove: entry.toMove === `x` ? `o` : `x` }];
        },
    };
}

// Counts the live list's answers, so a step waits for its read to land.
function countReads(page: Page): () => number {
    let reads = 0;
    page.on(`response`, (response) => {
        if (new URL(response.url()).pathname === `/api/games` && response.request().method() === `GET`) reads += 1;
    });
    return () => reads;
}

// The page's clock stands still from here; only runFor moves it.
// The reads on load settle first, one or, under strict mode's double mount, two.
async function hold(page: Page, reads: () => number): Promise<number> {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 250);
    await page.waitForTimeout(300);
    return reads();
}

async function stones(page: Page): Promise<number> {
    return page.locator(`.live-card g.stone`).count();
}

test(`a live board lands a read's new stones one at a time across the beat`, async ({ page }) => {
    const { state, grow } = growing();
    const reads = countReads(page);
    await page.clock.install();
    await serve(page, state);
    await page.goto(`/games/live`);
    await page.locator(`.live-card g.stone`).first().waitFor();
    const loaded = await hold(page, reads);
    const before = await stones(page);
    grow();
    await page.clock.runFor(beatMs);
    await expect.poll(reads).toBe(loaded + 1);
    expect(await stones(page)).toBe(before);
    const card = page.locator(`.live-card`).first();
    const mover = await card.locator(`.live-card-turn`).textContent();
    await page.clock.runFor(beatMs / (added + 1) + 50);
    await expect.poll(() => stones(page)).toBe(before + 1);
    // Half a turn landed: its one stone ringed, and the card still on the turn the board shows.
    await expect(card.locator(`.last-ring`)).toHaveCount(1);
    await expect(card.locator(`.live-card-turn`)).toHaveText(mover ?? ``);
    await expect(card.locator(`[role="timer"]`)).toHaveCount(0);
    await page.clock.runFor(beatMs / (added + 1));
    await expect.poll(() => stones(page)).toBe(before + added);
    await expect(page.locator(`.live-card .last-ring`)).toHaveCount(2);
    await expect(card.locator(`.live-card-turn`)).not.toHaveText(mover ?? ``);
});

test(`a live board lands a read's new stones at once under reduced motion`, async ({ page }) => {
    const { state, grow } = growing();
    const reads = countReads(page);
    await page.emulateMedia({ reducedMotion: `reduce` });
    await page.clock.install();
    await serve(page, state);
    await page.goto(`/games/live`);
    await page.locator(`.live-card g.stone`).first().waitFor();
    const loaded = await hold(page, reads);
    const before = await stones(page);
    grow();
    await page.clock.runFor(beatMs);
    await expect.poll(reads).toBe(loaded + 1);
    await expect.poll(() => stones(page)).toBe(before + added);
});

test('the live list is read again only while the page is in view, and opens no event stream', async ({ page }) => {
    const reads = countReads(page);
    let streams = 0;
    page.on(`request`, (request) => {
        if (new URL(request.url()).pathname.endsWith(`/events`)) streams += 1;
    });
    await page.clock.install();
    await serve(page, world({ live: liveGames }));
    await page.goto(`/games/live`);
    await page.locator(`.live-card`).first().waitFor();
    const loaded = await hold(page, reads);
    await page.clock.runFor(beatMs);
    await expect.poll(reads).toBe(loaded + 1);
    await page.evaluate(() => {
        Object.defineProperty(document, `visibilityState`, { value: `hidden`, configurable: true });
        document.dispatchEvent(new Event(`visibilitychange`));
    });
    await page.clock.runFor(3 * beatMs);
    await page.waitForTimeout(200);
    expect(reads()).toBe(loaded + 1);
    await page.evaluate(() => {
        Object.defineProperty(document, `visibilityState`, { value: `visible`, configurable: true });
        document.dispatchEvent(new Event(`visibilitychange`));
    });
    await expect.poll(reads).toBe(loaded + 2);
    expect(streams).toBe(0);
});

test(`the loading state holds each card's shape`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await serve(page, world({ stall: true }));
    await page.goto(`/games/live`);
    await page.locator(`.live-skeletons .skeleton`).first().waitFor();
    const boxes = await page.locator(`.live-skeletons .skeleton`).evaluateAll((skeletons) =>
        skeletons.map((skeleton) => {
            const box = skeleton.getBoundingClientRect();
            return { width: box.width, height: box.height };
        }),
    );
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
        expect(box.width).toBeGreaterThan(300);
        expect(box.height).toBeGreaterThan(box.width * 0.9);
    }
});

test('the boards take no focus: Tab walks the cards, one stop each, to their games', async ({ page }) => {
    await serve(page, world({ live: liveGames.slice(0, 3) }));
    await page.goto(`/games/live`);
    await page.locator(`.live-card`).first().waitFor();
    await page.locator(`h1`).click();
    const stops: string[] = [];
    for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press(`Tab`);
        stops.push(await page.evaluate(() => `${document.activeElement?.tagName ?? ``} ${document.activeElement?.getAttribute(`href`) ?? ``}`));
    }
    expect(stops).toEqual([`A /game/guest`, `A /game/live-1`, `A /game/live-2`]);
    await page.keyboard.press(`Shift+Tab`);
    await page.keyboard.press(`Enter`);
    await expect(page).toHaveURL(/\/game\/live-1$/u);
});

test(`a board stands over its card's title, and a click on it opens the game`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await serve(page, world({ live: liveGames.slice(0, 3) }));
    await page.goto(`/games/live`);
    const card = page.locator(`.live-card`).nth(1);
    await card.locator(`.board-svg`).waitFor();
    const board = await card.locator(`.mini-board`).boundingBox();
    const title = await card.locator(`.live-card-title`).boundingBox();
    expect((board?.y ?? Infinity) + (board?.height ?? 0)).toBeLessThanOrEqual(title?.y ?? 0);
    // The title's link stretches over the board, so the pointer lands on the link there.
    await page.mouse.click((board?.x ?? 0) + (board?.width ?? 0) / 2, (board?.y ?? 0) + (board?.height ?? 0) / 2);
    await expect(page).toHaveURL(/\/game\/live-1$/u);
});

test('the text around the boards stays clear of their edge cells for a contrast check', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await serve(page, world({ live: liveGames }));
    for (const path of [`/games/live`, `/bots/sealbot`]) {
        await page.goto(path);
        await page.locator(`.live-card .board-svg`).first().waitFor();
        const axe = await new AxeBuilder({ page }).withRules([`color-contrast`]).analyze();
        expect(axe.incomplete.flatMap((rule) => rule.nodes.map((node) => node.target))).toEqual([]);
    }
});

// At large text the edge cells reach up into the page's own head, which stacks above them too.
test('the page heads stay clear of the edge cells at 200% text', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const devtools = await page.context().newCDPSession(page);
    await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 32 } });
    await serve(page, world({ live: liveGames }));
    for (const [path, head] of [
        [`/games/live`, `.live-head`],
        [`/bots/sealbot`, `.bot-live > h2`],
    ] as const) {
        await page.goto(path);
        await page.locator(`.live-card .board-svg`).first().waitFor();
        const axe = await new AxeBuilder({ page }).include(head).withRules([`color-contrast`]).analyze();
        expect(axe.incomplete.flatMap((rule) => rule.nodes.map((node) => node.target))).toEqual([]);
    }
});
