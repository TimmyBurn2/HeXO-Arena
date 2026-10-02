import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisList } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { longReadings, serve, world, type World } from './mock-api';

// The analyzer window over the move list: each state it passes through, the
// explanation of the turn shown, and the strip it folds into on a phone.
const review: AnalysisList = { analyses: [longReadings.kestrel, ...longReadings.own], optedOut: false };

// Opens a page on a world the test keeps, so it can read the requests the page sent.
async function open(page: Page, path: string, overrides: Partial<World> = {}, width = 1280, height = 800): Promise<World> {
    await page.setViewportSize({ width, height });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const state = world(overrides);
    await serve(page, state);
    await page.goto(path);
    await page.locator(`h1`).first().waitFor();
    return state;
}

const win = (page: Page) => page.locator(`.an-window`);
const bubble = (page: Page) => page.locator(`.an-bubble-full`);
const navWords = (page: Page) => page.locator(`.an-chip-nav .scrub-words`);
const stones = (page: Page) => page.locator(`.board-camera .board-svg g.stone`);
const cell = (page: Page, x: number, y: number) => page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`);
// A value's side and number are held together by a no-break space.
const value = (words: string) => words.replace(/^([xo]) /u, `$1\u00a0`);

async function play(page: Page, ...cells: (readonly [number, number])[]): Promise<void> {
    for (const [x, y] of cells) await cell(page, x, y).click({ force: true });
}

test('with Analyze off and nothing read, the window is its head alone: how to have positions read, the switch, and the gear', async ({ page }) => {
    const state = await open(page, `/analysis`);
    await expect(win(page).locator(`.an-win-who`)).toHaveText(`Turn on Analyze to have each position you visit read.`);
    await expect(win(page).getByRole(`switch`, { name: `Analyze` })).not.toBeChecked();
    await expect(win(page).getByRole(`button`, { name: `Analysis settings` })).toBeVisible();
    await expect(win(page).locator(`.an-win-graph, .an-bubble, .an-line, .an-win-counts`)).toHaveCount(0);
    await expect(page.locator(`.an-evalbar`)).toHaveCount(0);
    // A turn on a board with no game says nothing until a reading does.
    await play(page, [1, 0], [0, 1]);
    await expect(page.locator(`.an-bubble`)).toHaveCount(0);
    expect(state.asked).toHaveLength(0);
});

test('a judged turn is explained as its analyzer\'s opinion, and the line it preferred shows on the board the turn was played from and plays as a variation', async ({ page }) => {
    const state = await open(page, `/analysis?game=long-finished&turn=22`, { analyses: { 'long-finished': review } });
    await expect(page.locator(`.an-bubble`)).toHaveClass(/an-bubble-blunder/u);
    await expect(bubble(page).locator(`.an-bubble-head .jd-blunder`)).toHaveText(`??`);
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Blunder: allowed a forced win`);
    await expect(bubble(page).locator(`.an-bubble-severity`)).toHaveText(`Blunder`);
    await expect(bubble(page).locator(`.an-bubble-meta`)).toHaveText(`Turn 22, hextide`);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(new RegExp(`^${value(`o 0.12`)} before, o wins in 2 after; kestrel preferred x: \\[-?\\d+,-?\\d+\\] \\[-?\\d+,-?\\d+\\]$`, `u`));
    await expect(page.locator(`.an-tree [aria-current="step"] .an-row-mark .jd-blunder`)).toHaveCount(1);
    await expect(page.locator(`.board-tag.jd-blunder`)).toHaveCount(1);

    const preferred = bubble(page).locator(`.an-pref`);
    await expect(preferred).toHaveAccessibleName(/^Play x: \[-?\d+,-?\d+\] \[-?\d+,-?\d+\] as a variation$/u);
    await expect(stones(page)).toHaveCount(45);
    await preferred.hover();
    // The board steps back to the position turn 22 was played from, the line in its place.
    await expect(stones(page)).toHaveCount(43);
    await expect(page.locator(`.ghost.preview`)).toHaveCount(2);
    await expect(page.locator(`.board-tag`)).toHaveCount(0);
    await page.locator(`.an-win-who`).hover();
    await expect(stones(page)).toHaveCount(45);
    await expect(page.locator(`.ghost.preview`)).toHaveCount(0);

    const words = (await preferred.textContent()) ?? ``;
    await preferred.click();
    await expect(navWords(page)).toHaveText(`Turn 22, a variation`);
    await expect(page.locator(`.an-band .an-tok[aria-current="step"] .an-move .sr-only`)).toHaveText(words);
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Turn 22, a variation`);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(/ after; variations are not judged$/u);
    expect(state.asked).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include(`.an-window`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
});

test('an unjudged turn of a game read whole names the values before and after it and the line preferred, and the opening and the six say what they are', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=12`, { analyses: { 'long-finished': review } });
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Turn 12, hextide`);
    await expect(bubble(page).locator(`.an-bubble-meta`)).toHaveCount(0);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(new RegExp(`^${value(`x 0.24`)} before, ${value(`x 0.28`)} after; kestrel preferred x: `, `u`));
    await page.keyboard.press(`Home`);
    await expect(bubble(page)).toHaveText(`The openingPlaced by the opening; not judged`);
    await page.keyboard.press(`End`);
    await expect(bubble(page)).toHaveText(`Turn 25, quietlakeo wins with six in a row`);
});

test('with Analyze on, a variation off a game read whole keeps the game\'s graph and marks, and the window names it while line A holds its place', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': review }, positions: { kind: `held` } });
    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await play(page, [3, 3], [3, 4]);
    await expect(navWords(page)).toHaveText(`Turn 15, a variation`);
    await expect(page.locator(`.an-state`)).toHaveText(`An analyzer is reading; x to move`);
    await expect(page.locator(`.an-state .an-pip-live`)).toHaveCount(1);
    await expect(bubble(page)).toHaveText(`Turn 15, a variationVariations are not judged`);
    await expect(page.locator(`.an-line-held`)).toHaveCount(1);
    await expect(page.locator(`.an-win-graph .graph-mark`)).toHaveCount(11);
    await expect(page.locator(`.an-win-counts`)).toBeVisible();
});

test('on a phone, line A\'s held place says who reads the position, which the strip leaves out', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': review }, positions: { kind: `held` } }, 390, 844);
    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await play(page, [3, 3], [3, 4]);
    await expect(page.locator(`.an-win-who`)).toBeHidden();
    await expect(page.locator(`.an-line-held .an-held-reading`)).toBeVisible();
    await expect(page.locator(`.an-line-held`)).toHaveText(`AAn analyzer is reading`);
    await expect(page.locator(`.an-bubble-flat`)).toHaveText(`Turn 15, a variation: Variations are not judged`);
});

test('a game nobody has read whole offers a request in the graph\'s place, says its turns are not judged yet, and waits for the analyzer the settings name', async ({ page }) => {
    const state = await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': { analyses: [], optedOut: false } } });
    const card = win(page).locator(`.an-win-card`);
    await expect(card.locator(`.an-request-text`)).toHaveText(`No reading of this game yet10 of 10 requests left today`);
    await expect(win(page).locator(`.an-win-graph, .an-win-counts`)).toHaveCount(0);
    await expect(bubble(page)).toHaveText(`Turn 14, hextideNot read yet; not judged until the game is read whole`);
    // Positions are still read live, and their values are not judged until the game is.
    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await expect(page.locator(`.an-line:not(.an-line-held)`)).toHaveCount(1);
    await page.keyboard.press(`ArrowLeft`);
    await expect(navWords(page)).toHaveText(`Turn 13 of 25`);
    await expect(page.locator(`.an-state`)).toHaveText(`Read in 1.8 s; x to move`);
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 14 of 25`);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(/; not judged until the game is read whole$/u);
    await expect(bubble(page).locator(`.an-pref`)).toHaveCount(1);
    expect(state.asked).toHaveLength(2);

    await card.getByRole(`button`, { name: `Request analysis` }).click();
    await expect(card).toHaveText(`Waiting for an analyzer; this game is next`);
    expect(state.requested).toHaveLength(1);
});

test('a bot game nobody has read whole draws each bot\'s own view in the graph\'s place, the request under it', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': { analyses: [...longReadings.own], optedOut: false } } });
    await expect(win(page).locator(`.an-win-graph .graph-trace-x`)).toHaveCount(1);
    await expect(win(page).locator(`.an-win-graph .graph-trace-o`)).toHaveCount(1);
    await expect(win(page).getByRole(`button`, { name: `Request analysis` })).toBeVisible();
    await expect(bubble(page)).toHaveText(new RegExp(`^Turn 14hextide's own view: ${value(`x 0.\\d\\d`)} after this turn$`, `u`));
});

test('signed out on a phone, the strip keeps the graph and the gear, and the row under it says why to sign in', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': review }, me: null }, 390, 844);
    await expect(win(page).getByRole(`switch`)).toHaveCount(0);
    await expect(page.locator(`.an-bubble-flat`)).toHaveText(new RegExp(`^Turn 14, hextide: ${value(`x 0.33`)} before, ${value(`x 0.12`)} after; kestrel preferred x: `, `u`));
    await play(page, [3, 3], [3, 4]);
    await expect(win(page).locator(`.an-win-sign-in`)).toContainText(`Sign in to ask analyzers; the board works without it.`);
    await expect(win(page).locator(`.an-win-sign-in .discord-button`)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});

test('the keys walk a variation band turn by turn, into an alternative and back to the main line, keeping the turn shown in view', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=5`, { analyses: { 'long-finished': review } });
    // From turn 5 a three-turn line, with a one-turn alternative at its second turn.
    await play(page, [3, 3], [3, 4], [4, 3], [4, 4], [5, 3], [5, 4]);
    await page.keyboard.press(`ArrowLeft`);
    await page.keyboard.press(`ArrowLeft`);
    await play(page, [-3, 5], [-3, 6]);
    const band = page.locator(`.an-band .an-band-line`);
    const token = (index: number) => band.locator(`.an-tok`).nth(index);
    await expect(band).toHaveCount(1);
    await expect(band.locator(`.an-tok .an-tok-n`)).toHaveText([`6`, `7`, `7`, `8`]);
    await expect(band.locator(`.an-paren`)).toHaveText([`(`, `)`]);
    await expect(token(2)).toHaveAttribute(`aria-current`, `step`);
    await expect(navWords(page)).toHaveText(`Turn 7, a variation`);
    await page.keyboard.press(`ArrowUp`);
    await expect(token(1)).toHaveAttribute(`aria-current`, `step`);
    await page.keyboard.press(`ArrowRight`);
    await expect(token(3)).toHaveAttribute(`aria-current`, `step`);
    await page.keyboard.press(`ArrowLeft`);
    await page.keyboard.press(`ArrowLeft`);
    await expect(token(0)).toHaveAttribute(`aria-current`, `step`);
    await page.keyboard.press(`ArrowUp`);
    await expect(page.locator(`.an-tree > .an-row.current .an-row-n`)).toHaveText(`6`);
    await page.keyboard.press(`ArrowDown`);
    await expect(token(0)).toHaveAttribute(`aria-current`, `step`);
    await page.keyboard.press(`ArrowUp`);
    await page.keyboard.press(`End`);
    await expect(navWords(page)).toHaveText(`Turn 25 of 25`);
    await expect(page.locator(`.an-tree [aria-current="step"]`)).toBeInViewport();
});
