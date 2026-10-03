import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisList } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { longReadings, serve, world, type World } from './mock-api';

// The analyzer window over the move list: each state it passes through, the
// explanation of the turn shown, and the strip it folds into on a phone.
const review: AnalysisList = { analyses: [longReadings.kestrel, ...longReadings.own], optedOut: false, independentOnline: false };

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
    // Turn 22 leaves o a six, so kestrel's line A, which leaves it and claims a win in 2, reads as the board's win in 1, as the row does.
    await expect(page.locator(`.an-tree [aria-current="step"] .an-row-value`)).toHaveText(`o wins in 1`);
    await expect(page.locator(`.an-line .an-value`).first()).toHaveText(`o wins in 1`);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`o wins in 1`);
    await expect(page.locator(`.an-bubble`)).toHaveClass(/an-bubble-blunder/u);
    await expect(bubble(page).locator(`.an-bubble-head .jd-blunder`)).toHaveText(`??`);
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Blunder: left a six`);
    await expect(bubble(page).locator(`.an-bubble-severity`)).toHaveText(`Blunder`);
    await expect(bubble(page).locator(`.an-bubble-meta`)).toHaveText(`Turn 22, hextide`);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(/^This turn leaves o a six to complete; kestrel preferred x: \[-?\d+,-?\d+\] \[-?\d+,-?\d+\]\.$/u);
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
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(/ after; variations are not judged\.$/u);
    expect(state.asked).toHaveLength(0);
    const axe = await new AxeBuilder({ page }).include(`.an-window`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
});

test('a reading by an analyzer that played in the game says so in the head and under the explanation, and on a phone under the explanation alone', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=22`, { analyses: { 'long-finished': { analyses: [longReadings.hextide, ...longReadings.own], optedOut: false, independentOnline: false } } });
    await expect(win(page).locator(`.an-by`)).toHaveText(`hextideBOT`);
    await expect(win(page).locator(`.an-involved`)).toHaveText(`hextide played in this game`);
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Blunder: left a six`);
    await expect(win(page).locator(`.an-bubble-involved`)).toHaveText(`hextide played in this game`);
    // No independent analyzer is online, so nothing offers a second reading.
    await expect(win(page).locator(`.an-win-card`)).toHaveCount(0);
    await page.screenshot({ path: `e2e/shots/analysis-window-involved--ink--1280.png` });
    const axe = await new AxeBuilder({ page }).include(`.an-window`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    // The opening and the six speak for themselves, whoever read the game.
    await page.keyboard.press(`End`);
    await expect(win(page).locator(`.an-bubble-involved`)).toHaveCount(0);
    await page.keyboard.press(`ArrowLeft`);
    await expect(win(page).locator(`.an-bubble-involved`)).toHaveText(`hextide played in this game`);
    await page.getByRole(`group`, { name: `Readings` }).getByRole(`button`, { name: `Own view` }).click();
    await expect(win(page).locator(`.an-involved, .an-bubble-involved`)).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole(`group`, { name: `Readings` }).getByRole(`button`, { name: `hextide` }).click();
    await expect(page.locator(`.an-win-who`)).toBeHidden();
    await expect(page.locator(`.an-bubble-involved`)).toBeVisible();
    await expect(page.locator(`.an-bubble-involved`)).toHaveText(`hextide played in this game`);
    await page.screenshot({ path: `e2e/shots/analysis-window-involved--ink--390.png` });
});

test('a game read only by an analyzer whose owner played offers a reading by an independent analyzer, asked for by no name', async ({ page }) => {
    const involved = { ...longReadings.kestrel, involved: true };
    const state = await open(page, `/analysis?game=long-finished&turn=12`, { analyses: { 'long-finished': { analyses: [involved, ...longReadings.own], optedOut: false, independentOnline: true } } });
    await expect(win(page).locator(`.an-involved`)).toHaveText(`Read by an analyzer of a player in this game`);
    const card = win(page).locator(`.an-win-card`);
    await expect(card.locator(`.dr-card-title`)).toHaveText(`An independent analyzer is online`);
    await expect(card).toContainText(`10 of 10 requests left today.`);
    await page.screenshot({ path: `e2e/shots/analysis-window-independent--ink--1280.png` });
    const axe = await new AxeBuilder({ page }).include(`.an-window`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    await card.getByRole(`button`, { name: `Ask an independent analyzer` }).click();
    await expect(card).toHaveText(`Waiting for an analyzer; this game is next`);
    expect(state.requested).toEqual([{ gameId: `long-finished`, request: {} }]);
});

test('an unjudged turn of a game read whole names the values before and after it and the line preferred, a lost side is not blamed, and the opening and the six say what they are', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=8`, { analyses: { 'long-finished': review } });
    await expect(bubble(page).locator(`.an-bubble-title`)).toHaveText(`Turn 8, hextide`);
    await expect(bubble(page).locator(`.an-bubble-meta`)).toHaveCount(0);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(new RegExp(`^${value(`x 55%`)} before, ${value(`x 56%`)} after; kestrel preferred x: \\[-?\\d+,-?\\d+\\] \\[-?\\d+,-?\\d+\\]\\.$`, `u`));
    // From turn 10 o holds sixes x cannot all block: x is lost, and never blamed for it.
    for (let turn = 8; turn < 12; turn += 1) await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 12 of 25`);
    await expect(bubble(page)).toHaveText(`Turn 12, hextidekestrel found a win for o before this turn.`);
    await page.keyboard.press(`Home`);
    await expect(bubble(page)).toHaveText(`The openingPlaced by the opening; not judged.`);
    await page.keyboard.press(`End`);
    await expect(bubble(page)).toHaveText(`Turn 25, quietlakeo wins with six in a row.`);
});

test('with Analyze on, a variation off a game read whole keeps the game\'s graph and marks, and the window names it while line A holds its place', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': review }, positions: { kind: `held` } });
    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await play(page, [3, 3], [3, 4]);
    await expect(navWords(page)).toHaveText(`Turn 15, a variation`);
    await expect(page.locator(`.an-state`)).toHaveText(`An analyzer is reading; x to move`);
    await expect(page.locator(`.an-state .an-pip-live`)).toHaveCount(1);
    await expect(bubble(page)).toHaveText(`Turn 15, a variationVariations are not judged.`);
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
    await expect(page.locator(`.an-bubble-flat`)).toHaveText(`Turn 15, a variation: variations are not judged.`);
});

test('a game nobody has read whole offers a request in the graph\'s place, says its turns are not judged yet, and waits for the analyzer the settings name', async ({ page }) => {
    const state = await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': { analyses: [], optedOut: false, independentOnline: false } } });
    const card = win(page).locator(`.an-win-card`);
    await expect(card.locator(`.an-request-text`)).toHaveText(`No reading of this game yet10 of 10 requests left today`);
    await expect(win(page).locator(`.an-win-graph, .an-win-counts`)).toHaveCount(0);
    await expect(bubble(page)).toHaveText(`Turn 14, hextideNot read yet; not judged until the game is read whole.`);
    // Positions are still read live, and their values are not judged until the game is.
    await page.getByRole(`switch`, { name: `Analyze` }).check();
    await expect(page.locator(`.an-line:not(.an-line-held)`)).toHaveCount(1);
    await page.keyboard.press(`ArrowLeft`);
    await expect(navWords(page)).toHaveText(`Turn 13 of 25`);
    await expect(page.locator(`.an-state`)).toHaveText(`Read in 1.8 s; x to move`);
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 14 of 25`);
    await expect(bubble(page).locator(`.an-bubble-text`)).toHaveText(/; not judged until the game is read whole\.$/u);
    await expect(bubble(page).locator(`.an-pref`)).toHaveCount(1);
    expect(state.asked).toHaveLength(2);

    await card.getByRole(`button`, { name: `Request analysis` }).click();
    await expect(card).toHaveText(`Waiting for an analyzer; this game is next`);
    expect(state.requested).toHaveLength(1);
});

test('a bot game nobody has read whole draws each bot\'s own view in the graph\'s place, the request under it', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=14`, { analyses: { 'long-finished': { analyses: [...longReadings.own], optedOut: false, independentOnline: false } } });
    await expect(win(page).locator(`.an-win-graph .graph-trace-x`)).toHaveCount(1);
    await expect(win(page).locator(`.an-win-graph .graph-trace-o`)).toHaveCount(1);
    await expect(win(page).getByRole(`button`, { name: `Request analysis` })).toBeVisible();
    await expect(bubble(page)).toHaveText(new RegExp(`^Turn 14hextide's own view: ${value(`x 0.\\d\\d`)} after this turn\\.$`, `u`));
});

test('signed out on a phone, the strip keeps the graph and the gear, and the row under it says why to sign in', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=20`, { analyses: { 'long-finished': review }, me: null }, 390, 844);
    await expect(win(page).getByRole(`switch`)).toHaveCount(0);
    await expect(page.locator(`.an-bubble-flat`)).toHaveText(/^\?\?Blunder: left a six; this turn leaves o a six to complete; kestrel preferred x: /u);
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

test('the graph pins forced wins to their edges apart from the trace, shades the turns that held one, brackets the run, and draws each analyzer\'s values as it declared them', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=12`, { analyses: { 'long-finished': { analyses: [longReadings.kestrel, longReadings.driftwood, ...longReadings.own], optedOut: false, independentOnline: false } } });
    const graph = win(page).locator(`.an-win-graph`);
    await expect(graph.locator(`.graph-forced-o`)).not.toHaveCount(0);
    await expect(graph.locator(`.graph-hold-o`)).toHaveCount(8);
    await expect(graph.locator(`.graph-run`)).toHaveCount(1);
    // kestrel declares its values x's expected result: drawn and worded as win chances, the eval bar split at x's chance.
    await expect(graph.locator(`.an-graph-meaning`)).toHaveText(`Win chances`);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`x 64%`);
    await expect(page.locator(`.an-line`).first()).toHaveAccessibleName(/^Play line A: x's win chance 64 percent, o: /u);
    await expect(page.locator(`.an-evalbar`)).toHaveAttribute(`style`, /--x-share: 64\.0%/u);
    // driftwood declares nothing: raw values, drawn within the inner band, so only a forced win reaches an edge.
    await page.getByRole(`group`, { name: `Readings` }).getByRole(`button`, { name: `driftwood` }).click();
    await expect(graph.locator(`.an-graph-meaning`)).toHaveText(`Raw values`);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`x 0.22`);
    await expect(page.locator(`.an-line`).first()).toHaveAccessibleName(/^Play line A: x 0\.22, o: /u);
    await expect(page.locator(`.an-evalbar`)).toHaveAttribute(`style`, /--x-share: 58\.3%/u);
});

test('a run of marked turns folds in the list after its first turn, opens to its turns, and stays open while the turn shown lies in it', async ({ page }) => {
    await open(page, `/analysis?game=long-finished&turn=18`, { analyses: { 'long-finished': review } });
    const run = page.getByRole(`button`, { name: /^Turns 19 to 24: wins let go/u });
    await expect(run).toHaveText(`Turns 19 to 24: wins let goEach turn here let a win go or handed one over; kestrel marks all 6.`);
    await expect(page.locator(`.an-tree > .an-row:not(.an-opening) .an-row-n`)).toHaveText([`3`, `4`, `5`, `6`, `7`, `8`, `9`, `10`, `11`, `12`, `13`, `14`, `15`, `16`, `17`, `18`, `19`, `25`]);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 20 of 25`);
    await expect(run).toHaveAttribute(`aria-expanded`, `true`);
    await expect(page.locator(`.an-tree [aria-current="step"] .an-row-mark .jd-blunder`)).toHaveCount(1);
    await expect(page.locator(`.board-tag.jd-blunder`)).toHaveCount(1);
    await page.keyboard.press(`End`);
    await expect(run).toHaveAttribute(`aria-expanded`, `false`);
    await run.click();
    await expect(page.locator(`.an-tree > .an-row:not(.an-opening) .an-row-n`)).toHaveCount(23);
});
