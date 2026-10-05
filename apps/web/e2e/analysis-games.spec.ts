import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisList } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { longReadings, serve, world, type World } from './mock-api';

const review: AnalysisList = { analyses: [longReadings.kestrel, longReadings.driftwood, ...longReadings.own], optedOut: false, independentOnline: false };

// Opens a page on a world the test keeps, so it can read the requests the page sent.
async function open(page: Page, path: string, overrides: Partial<World> = {}, width = 1280, height = 800): Promise<World> {
    await page.setViewportSize({ width, height });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const state = world({ analyses: { 'long-finished': review }, ...overrides });
    await serve(page, state);
    await page.goto(path);
    await page.locator(`h1`).first().waitFor();
    return state;
}

const game = `/analysis?game=long-finished&turn=12`;
const lines = (page: Page) => page.locator(`.an-line:not(.an-line-held)`);
const row = (page: Page, turn: number) => page.locator(`.an-tree > .an-row`).filter({ has: page.locator(`.an-row-n`, { hasText: new RegExp(`^${String(turn)}$`, `u`) }) });
const pills = (page: Page) => page.getByRole(`group`, { name: `Readings` });
const graph = (page: Page) => page.locator(`.an-win-graph`);
const counts = (page: Page) => page.locator(`.an-win-counts`);

test('a game read whole shows its graph, each side\'s marks, and every turn\'s verdict and value as the drawer does, without asking', async ({ page }) => {
    const state = await open(page, game);
    await expect(pills(page).getByRole(`button`)).toHaveText([`driftwood`, `kestrel`, `Own view`]);
    await expect(pills(page).getByRole(`button`, { name: `kestrel` })).toHaveAttribute(`aria-pressed`, `true`);
    await expect(graph(page).getByRole(`img`)).toHaveAccessibleName(`Graph of kestrel's reading, from the opening to turn 25`);
    await expect(graph(page).locator(`.graph-mark`)).toHaveCount(11);
    await expect(counts(page).locator(`dt`)).toHaveText([`hextide`, `quietlake`]);
    await expect(counts(page).locator(`.dr-mark-count .sr-only`)).toHaveText([`1 inaccuracy`, `0 mistakes`, `3 blunders`, `0 inaccuracies`, `0 mistakes`, `7 blunders`]);
    await expect(counts(page).locator(`.dr-mark-none`)).toHaveCount(3);

    await expect(row(page, 17).locator(`.jd-blunder`)).toHaveText(`??`);
    // Turns 19 to 24 let wins go in turn: the list folds them after turn 19 under one note, and a press shows them.
    await expect(counts(page).locator(`.dr-marks-runs`)).toHaveText(`6 in runs`);
    const run = page.getByRole(`button`, { name: /^Turns 19 to 24: wins let go/u });
    await expect(run).toHaveAttribute(`aria-expanded`, `false`);
    await expect(row(page, 22)).toHaveCount(0);
    await run.click();
    await expect(run).toHaveAttribute(`aria-expanded`, `true`);
    await expect(row(page, 22).getByRole(`button`).first()).toHaveAccessibleName(/^22 x: \[-?\d+,-?\d+\] \[-?\d+,-?\d+\] Blunder: left a six; o wins in 1$/u);
    await expect(row(page, 6).locator(`.an-row-mark`)).toHaveAttribute(`title`, `Inaccuracy`);
    await expect(row(page, 22).locator(`.an-row-value`)).toHaveText(`o wins in 1`);
    // kestrel's values are x's expected result: a row shows the leader's win chance and says it in full.
    await expect(row(page, 21).locator(`.an-row-value`)).toHaveText(`o 56%`);
    await expect(row(page, 21).getByRole(`button`).first()).toHaveAccessibleName(/; o's win chance 56 percent$/u);
    await expect(row(page, 25).locator(`.an-row-value`)).toHaveText(`o wins`);
    await expect(row(page, 12).locator(`.jd`)).toHaveCount(0);

    // The position after turn 12 holds kestrel's reading before turn 13, with o to move.
    await expect(lines(page)).toHaveCount(1);
    await page.getByRole(`button`, { name: `Lines B, C` }).click();
    await expect(page.locator(`.an-line .an-value`)).toHaveText([`x 64%`, `x 68%`, `x 71%`]);
    await expect(lines(page).first()).toHaveAccessibleName(/^Play line A: x's win chance 64 percent, o: /u);
    await expect(page.locator(`.an-by`)).toHaveText(`kestrelBOT`);
    await expect(page.locator(`.an-state`)).toHaveText(`Read before; o to move`);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`x 64%`);

    // Stepping moves the cursor; a press on the graph goes to the turn under it; a judged turn wears its mark on the board.
    const cursor = graph(page).locator(`.graph-cursor`);
    const before = await cursor.getAttribute(`x1`);
    await page.keyboard.press(`ArrowRight`);
    await expect(cursor).not.toHaveAttribute(`x1`, before ?? ``);
    const plot = await graph(page).getByRole(`img`).boundingBox();
    if (plot === null) throw new Error(`the graph has no box`);
    await page.mouse.click(plot.x + plot.width - 1, plot.y + plot.height / 2);
    await expect(page.locator(`.an-chip-nav .scrub-words`)).toHaveText(`Turn 25 of 25`);
    await expect(page.locator(`.board-tag`)).toHaveCount(0);
    await page.keyboard.press(`End`);
    for (let turn = 25; turn > 22; turn -= 1) await page.keyboard.press(`ArrowLeft`);
    await expect(page.locator(`.an-chip-nav .scrub-words`)).toHaveText(`Turn 22 of 25`);
    await expect(page.locator(`.board-tag.jd-blunder`)).toHaveText(`??`);

    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include(`.an-panel`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
});

test('a position a stored game passes through shows its reading on any line that reaches it', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=10`);
    // Turns 11 to 13 again, o's stones swapped between its two turns: a transposition of the game after turn 13.
    const cell = (x: number, y: number) => page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`);
    for (const [x, y] of [
        [1, 2],
        [-3, 3],
        [-1, 3],
        [-2, 3],
        [0, 3],
        [-3, 2],
    ] as const) {
        await cell(x, y).click({ force: true });
    }
    await expect(page.locator(`.an-chip-nav .scrub-words`)).toHaveText(`Turn 13, a variation`);
    await expect(page.locator(`.an-state`)).toHaveText(`Read before; x to move`);
    await expect(page.locator(`.an-line .an-value`).first()).toHaveText(`x 67%`);
});

test('the bots\' own views sit under their own pill, each seat\'s trace in its color and no marks', async ({ page }) => {
    await open(page, game);
    await pills(page).getByRole(`button`, { name: `Own view` }).click();
    await expect(pills(page).getByRole(`button`, { name: `Own view` })).toHaveAttribute(`aria-pressed`, `true`);
    await expect(page.locator(`.an-by`)).toHaveText(`quietlakeBOT`);
    await expect(page.locator(`.an-state`)).toHaveText(`Said while it played; o to move`);
    await expect(lines(page)).toHaveCount(1);
    await expect(graph(page).getByRole(`img`)).toHaveAccessibleName(`Graph of each bot's own view, from the opening to turn 25`);
    await expect(graph(page).locator(`.graph-trace-x`)).toHaveCount(1);
    await expect(graph(page).locator(`.graph-trace-o`)).toHaveCount(1);
    await expect(page.locator(`.an-bubble-full`)).toHaveText(/^Turn 12hextide's own view: x\u00a00\.\d\d after this turn\.$/u);
    await expect(page.locator(`.dr-marks`)).toHaveCount(0);
    await expect(page.locator(`.an-tree .jd`)).toHaveCount(0);

    await page.keyboard.press(`a`);
    await expect(pills(page).getByRole(`button`, { name: `kestrel` })).toHaveAttribute(`aria-pressed`, `true`);
    await expect(page.locator(`.dr-marks`)).toHaveCount(1);
});

test('signed out, a stored game\'s readings and own views show, and only asking needs a sign-in', async ({ page }) => {
    const state = await open(page, game, { me: null });
    await expect(page.getByRole(`switch`, { name: `Analyze` })).toHaveCount(0);
    await expect(lines(page)).toHaveCount(1);
    await expect(page.locator(`.dr-marks`)).toHaveCount(1);
    await pills(page).getByRole(`button`, { name: `Own view` }).click();
    await expect(page.locator(`.an-by`)).toContainText(`quietlake`);
    await page.keyboard.press(`ArrowLeft`);
    await expect(page.locator(`.an-by`)).toContainText(`hextide`);
    // Off the game's line nothing is stored, and asking needs a sign-in.
    await pills(page).getByRole(`button`, { name: `kestrel` }).click();
    for (const [x, y] of [[3, 3], [3, 4]] as const) await page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`).click({ force: true });
    await expect(page.locator(`.an-win-who`)).toHaveText(`Sign in to ask analyzers; the board works without it.`);
    await expect(page.locator(`.an-window .discord-button`)).toBeVisible();
    await page.keyboard.press(`a`);
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(0);
});

test('a reading still running draws its graph so far and keeps its marks for its end', async ({ page }) => {
    await open(page, game, { analyses: { 'long-finished': { analyses: [longReadings.running, ...longReadings.own], optedOut: false, independentOnline: false } } });
    await expect(graph(page).getByRole(`img`)).toHaveAccessibleName(`Graph of kestrel's reading, from the opening to turn 25`);
    await expect(page.locator(`.an-win-card`)).toContainText(`kestrel is reading turn 13 of 25`);
    await expect(page.locator(`.dr-marks`)).toHaveCount(0);
    await expect(page.locator(`.an-tree .jd`)).toHaveCount(0);
    await expect(page.locator(`.an-bubble-full`)).toContainText(`not judged until the game is read whole`);
    await expect(row(page, 6).locator(`.an-row-value`)).not.toHaveText(``);
    await expect(row(page, 20).locator(`.an-row-value`)).toHaveCount(0);
});

test('a game whose player opted out says so, and its positions are still read on request', async ({ page }) => {
    const state = await open(page, game, { analyses: { 'long-finished': { analyses: [], optedOut: true, independentOnline: false } } });
    await expect(page.locator(`.an-win-card`)).toHaveText(`A player in this game asked that their games not be analyzed`);
    await expect(graph(page)).toHaveCount(0);
    await expect(page.locator(`.an-bubble`)).toHaveCount(0);
    await page.keyboard.press(`a`);
    await expect(lines(page)).toHaveCount(1);
    // Read live, a turn of a game no reading may judge whole waits for no such reading.
    await expect(page.locator(`.an-bubble-full`)).toHaveText(/^Turn 12, hextide[xo]\u00a0\d+% after\.$/u);
    expect(state.asked).toHaveLength(1);
});

test('on a phone the window folds into a strip of the graph, Analyze, and the gear, the marks left to the graph, without pushing the page sideways', async ({ page }) => {
    await open(page, game, {}, 390, 844);
    await expect(graph(page).getByRole(`img`)).toBeVisible();
    await expect(graph(page).locator(`.graph-mark`)).toHaveCount(11);
    const [plot, gear] = await Promise.all([graph(page).boundingBox(), page.getByRole(`button`, { name: `Analysis settings` }).boundingBox()]);
    if (plot === null || gear === null) throw new Error(`no strip`);
    expect(gear.y + gear.height / 2).toBeGreaterThan(plot.y);
    expect(gear.y + gear.height / 2).toBeLessThan(plot.y + plot.height);
    await expect(page.getByRole(`switch`, { name: `Analyze` })).toBeVisible();
    await expect(page.locator(`.an-win-who`)).toBeHidden();
    await expect(counts(page)).toBeHidden();
    await expect(page.locator(`.an-bubble-full`)).toBeHidden();
    await expect(page.locator(`.an-bubble-flat`)).toHaveText(`Turn 12, hextide: kestrel found a win for o before this turn.`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
