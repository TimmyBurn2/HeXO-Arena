import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world, type World } from './mock-api';

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

const game = `/analysis?game=long-finished&turn=12`;
const analyze = (page: Page) => page.getByRole(`switch`, { name: `Analyze` });
const lines = (page: Page) => page.locator(`.an-line:not(.an-line-held)`);
const stateLine = (page: Page) => page.locator(`.an-state`);
const trouble = (page: Page) => page.locator(`.an-trouble`);
const navWords = (page: Page) => page.locator(`.an-chip-nav .scrub-words`);

test('Analyze is off on every visit; on, it reads the position into lines A to C, on the board, and in the eval bar', async ({ page }) => {
    const state = await open(page, game);
    await expect(analyze(page)).not.toBeChecked();
    await expect(page.locator(`.an-reading`)).toContainText(`Turn on Analyze to have each position you visit read.`);
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(0);

    await analyze(page).check();
    await expect(lines(page)).toHaveCount(3);
    await expect(page.locator(`.an-line .an-value`)).toHaveText([`o 0.12`, `o 0.07`, `x 0.02`]);
    await expect(page.locator(`.an-line .an-cells`).first()).toHaveText(/^o: \[-?\d+,-?\d+\] \[-?\d+,-?\d+\]$/u);
    await expect(lines(page).first()).toHaveAccessibleName(/^Play line A: o 0\.12, o: /u);
    await expect(page.locator(`.an-by`)).toHaveText(`kestrelBOT0.9, by tom; 2 s a position`);
    await expect(stateLine(page)).toHaveText(`Read in 1.8 s; o to move`);
    await expect(page.locator(`.line-mark`)).toHaveCount(6);
    await expect(page.locator(`.line-mark.best`)).toHaveCount(2);
    await expect(page.locator(`.line-mark.best .line-letters`)).toHaveText([`A`, `A`]);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveText(`o 0.12`);
    expect(state.asked).toHaveLength(1);
    expect(state.asked[0]).toMatchObject({ toMove: `o`, analyzer: null, lines: 3, seconds: 2 });
    expect(state.asked[0]?.cells).toHaveLength(25);

    await page.reload();
    await expect(analyze(page)).not.toBeChecked();
    await expect(lines(page)).toHaveCount(0);
});

test('while Analyze is on each position the board rests on is read, and a asks for one while it is off', async ({ page }) => {
    const state = await open(page, game);
    await analyze(page).check();
    await expect(lines(page)).toHaveCount(3);
    const tree = await page.locator(`.an-tree-host`).boundingBox();
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 13 of 25`);
    // Through the rest before the ask the rows and the bar hold still.
    await expect(page.locator(`.an-line-held`)).toHaveCount(3);
    await expect(page.locator(`.an-evalbar`)).toHaveCount(1);
    expect((await page.locator(`.an-tree-host`).boundingBox())?.y).toBe(tree?.y);
    await expect(stateLine(page)).toHaveText(`Read in 1.8 s; x to move`);
    expect(state.asked).toHaveLength(2);

    // Positions passed through faster than the rest are never asked for.
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`ArrowRight`);
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 16 of 25`);
    await expect(stateLine(page)).toHaveText(`Read in 1.8 s; o to move`);
    expect(state.asked).toHaveLength(3);

    await analyze(page).uncheck();
    await page.keyboard.press(`ArrowLeft`);
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(3);
    await expect(lines(page)).toHaveCount(0);
    await page.keyboard.press(`a`);
    await expect(lines(page)).toHaveCount(3);
    expect(state.asked).toHaveLength(4);

    // A position read before shows at once, and turning Analyze on asks nothing more for it.
    await page.keyboard.press(`ArrowRight`);
    await expect(lines(page)).toHaveCount(3);
    await analyze(page).check();
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(4);
});

test('a line previews its stones on the board while pointed at or focused, and plays when pressed', async ({ page }) => {
    await open(page, game);
    await analyze(page).check();
    await expect(lines(page)).toHaveCount(3);
    await lines(page).nth(1).hover();
    await expect(page.locator(`.ghost.preview`)).toHaveCount(2);
    await page.locator(`.an-by`).hover();
    await expect(page.locator(`.ghost.preview`)).toHaveCount(0);
    await lines(page).first().focus();
    await expect(page.locator(`.ghost.preview`)).toHaveCount(2);
    const cells = await page.locator(`.an-line .an-cells`).first().textContent();
    await page.keyboard.press(`Enter`);
    await expect(navWords(page)).toHaveText(`Turn 13, a variation`);
    await expect(page.locator(`.an-var .an-move`)).toHaveText([cells?.replace(/^o: /u, `o: `) ?? ``]);
    await expect(page.locator(`.ghost.preview`)).toHaveCount(0);
});

test('a position waiting its turn says how many wait ahead of it, then reads', async ({ page }) => {
    await open(page, game, { positions: { kind: `done`, queued: { ahead: 2, times: 1 } } });
    await analyze(page).check();
    await expect(stateLine(page)).toHaveText(`Waiting for an analyzer; 2 positions ahead of yours; o to move`);
    await expect(page.locator(`.an-reading`)).toContainText(`It goes to an analyzer when it is free, in about 6 s.`);
    await expect(lines(page)).toHaveCount(3);
});

test('a position waiting its turn names the analyzer it waits for once the site has chosen one', async ({ page }) => {
    await open(page, game, { positions: { kind: `done`, queued: { ahead: 1, times: 1, chosen: true } } });
    await analyze(page).check();
    await expect(stateLine(page)).toHaveText(`Waiting for kestrel; 1 position ahead of yours; o to move`);
    await expect(page.locator(`.an-reading`)).toContainText(`It goes to kestrel when it is free, in about 4 s.`);
    await expect(lines(page)).toHaveCount(3);
});

test('a position held for its reading says who reads it, its lines\' rows and the eval bar kept in place', async ({ page }) => {
    await open(page, game, { positions: { kind: `held` } });
    await analyze(page).check();
    await expect(stateLine(page)).toHaveText(`An analyzer is reading; o to move`);
    await expect(page.locator(`.an-by`)).toHaveText(`Any online analyzer2 s a position`);
    await expect(page.locator(`.an-line-held`)).toHaveText([`A`, `B`, `C`]);
    await expect(page.locator(`.an-lines`)).toHaveAttribute(`aria-hidden`, `true`);
    await expect(page.locator(`.an-evalbar-held`)).toHaveCount(1);
    await expect(page.locator(`.an-evalbar-chip`)).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).include(`.an-panel`).withRules([`color-contrast`, `aria-hidden-focus`, `list`]).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
});

const refusals: { name: string; answer: World[`positions`]; title: string; note: RegExp | string; again: boolean }[] = [
    {
        name: `a live game's position`,
        answer: { kind: `refused`, status: 409, code: `live_position` },
        title: `This position is in a live game`,
        note: `Analysis opens once that game ends; the board still works.`,
        again: false,
    },
    {
        name: `a seat in a live game`,
        answer: { kind: `refused`, status: 409, code: `seated` },
        title: `You are playing a live game`,
        note: `Analyzers read for you again once your game ends; the board still works.`,
        again: false,
    },
    {
        name: `the day's readings spent`,
        answer: { kind: `refused`, status: 429, code: `analysis_limit`, retryAfter: 18_120 },
        title: `Today's readings are spent`,
        note: `You may have 300 positions read a day; more in 5 hours 2 minutes. Positions read before still show.`,
        again: false,
    },
    {
        name: `full queues`,
        answer: { kind: `refused`, status: 429, code: `analysis_busy`, retryAfter: 10 },
        title: `The analyzers are busy`,
        note: `Every queue is full; ask again in 10 s.`,
        again: true,
    },
    {
        name: `too many asks at once`,
        answer: { kind: `refused`, status: 429, code: `rate_limited`, retryAfter: 2 },
        title: `Too many readings asked for at once`,
        note: `Ask again in 2 s.`,
        again: true,
    },
    {
        name: `no analyzer online`,
        answer: { kind: `refused`, status: 409, code: `no_analyzer` },
        title: `No analyzer is online`,
        note: `Bots that read positions show up in Analysis settings once one connects.`,
        again: true,
    },
    {
        name: `an analyzer that ran out of time`,
        answer: { kind: `failed`, failure: `timeout` },
        title: `kestrel did not finish this position`,
        note: `It ran out of time.`,
        again: true,
    },
    {
        name: `an analyzer whose evaluation contradicted the board`,
        answer: { kind: `failed`, failure: `inconsistent` },
        title: `kestrel did not finish this position`,
        note: `Its evaluation contradicted the board.`,
        again: true,
    },
    {
        name: `anything else`,
        answer: { kind: `refused`, status: 503, code: `paused` },
        title: `The reading did not go through`,
        note: `Ask again; the board still works.`,
        again: true,
    },
];

for (const refusal of refusals) {
    test(`the panel says in plain words when ${refusal.name} stops a reading`, async ({ page }) => {
        const state = await open(page, game, { positions: refusal.answer });
        await analyze(page).check();
        await expect(trouble(page).locator(`.an-trouble-title`)).toHaveText(refusal.title);
        await expect(trouble(page).locator(`.note`)).toHaveText(refusal.note);
        await expect(lines(page)).toHaveCount(0);
        await expect(page.locator(`.an-evalbar`)).toHaveCount(0);
        const again = trouble(page).getByRole(`button`, { name: `Ask again` });
        await expect(again).toHaveCount(refusal.again ? 1 : 0);
        if (!refusal.again) return;
        state.positions = { kind: `done` };
        await again.click();
        await expect(lines(page)).toHaveCount(3);
    });
}

test('a named analyzer that is not reading says so and points to the settings', async ({ page }) => {
    await page.addInitScript(() => {
        window.localStorage.setItem(`hexo-arena.analysis-settings.v1`, JSON.stringify({ analyzer: `slowpoke`, lines: 3, seconds: 2, boardLines: true }));
    });
    await open(page, game, { positions: { kind: `refused`, status: 409, code: `no_analyzer` } });
    await expect(page.locator(`.an-by`)).toHaveText(`slowpokeBOTnot reading now`);
    await analyze(page).check();
    await expect(trouble(page)).toContainText(`slowpoke is not reading now`);
    await expect(trouble(page)).toContainText(`Pick another analyzer in Analysis settings, or ask again later.`);
});

test('once the day is spent, positions read as spent without asking until a reading is asked for', async ({ page }) => {
    const state = await open(page, game, { me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 0, games: 10 } } });
    await analyze(page).check();
    await expect(trouble(page).locator(`.an-trouble-title`)).toHaveText(`Today's readings are spent`);
    await page.keyboard.press(`ArrowRight`);
    await expect(navWords(page)).toHaveText(`Turn 13 of 25`);
    await page.waitForTimeout(800);
    await expect(trouble(page).locator(`.an-trouble-title`)).toHaveText(`Today's readings are spent`);
    expect(state.asked).toHaveLength(1);
    await page.getByRole(`button`, { name: `Analysis settings` }).click();
    await expect(page.getByRole(`dialog`, { name: `Analysis settings` })).toContainText(
        `No positions left today; the count starts again at 00:00 UTC. Stored readings and positions read before cost nothing.`,
    );
});

test('signed out, the panel asks for a sign-in and nothing is asked', async ({ page }) => {
    const state = await open(page, game, { me: null });
    await expect(analyze(page)).toHaveCount(0);
    await expect(page.locator(`.an-reading`)).toContainText(`Sign in to ask analyzers; the board works without it.`);
    await expect(page.locator(`.an-reading .discord-button`)).toBeVisible();
    await page.keyboard.press(`a`);
    await page.waitForTimeout(800);
    expect(state.asked).toHaveLength(0);
    await page.getByRole(`button`, { name: `Analysis settings` }).click();
    const panel = page.getByRole(`dialog`, { name: `Analysis settings` });
    await expect(panel.getByRole(`radio`)).toHaveCount(0);
    await expect(panel.getByRole(`switch`)).toHaveCount(2);
    await expect(panel).toContainText(`Sign in to ask analyzers; the board works without it.`);
});

test('the settings pick the analyzer, the lines, and the time the analyzer allows, and keep its lines off the board', async ({ page }) => {
    const state = await open(page, game);
    const gear = page.getByRole(`button`, { name: `Analysis settings` });
    await gear.click();
    const panel = page.getByRole(`dialog`, { name: `Analysis settings` });
    await expect(panel.getByRole(`radio`, { name: `Any online analyzer` })).toBeFocused();
    await expect(panel.getByRole(`radio`)).toHaveCount(3);
    await expect(panel.getByRole(`radio`, { name: `kestrel` })).toHaveAccessibleDescription(`by tom; up to 5 s a position; 3 lines`);
    await expect(panel.getByRole(`radio`, { name: `driftwood` })).toHaveAccessibleDescription(`by mika; up to 2 s a position; 2 lines`);
    await expect(panel).toContainText(`300 of 300 positions left today. Stored readings and positions read before cost nothing.`);
    await panel.locator(`.an-analyzer`, { hasText: `driftwood` }).click();
    const capped = panel.getByRole(`button`, { name: `5 s` });
    await expect(capped).toHaveAttribute(`aria-disabled`, `true`);
    await capped.hover();
    await expect(capped).toHaveCSS(`cursor`, `not-allowed`);
    // A press on a choice that cannot be taken, which Playwright would not make on its own.
    await capped.click({ force: true });
    await expect(capped).toHaveAttribute(`aria-pressed`, `false`);
    await expect(panel).toContainText(`driftwood reads up to 2 s a position.`);
    await panel.getByRole(`button`, { name: `1`, exact: true }).click();
    await expect(panel.getByRole(`button`, { name: `1`, exact: true })).toHaveAttribute(`aria-pressed`, `true`);
    const axe = await new AxeBuilder({ page }).include(`#analysis-settings-panel`).analyze();
    expect(axe.violations.map((violation) => violation.id)).toEqual([]);
    await page.keyboard.press(`Escape`);
    await expect(panel).toHaveCount(0);
    await expect(gear).toBeFocused();

    await analyze(page).check();
    await expect(lines(page)).toHaveCount(1);
    expect(state.asked[0]).toMatchObject({ analyzer: `driftwood`, lines: 1, seconds: 2 });
    await expect(page.locator(`.an-by`)).toHaveText(`driftwoodBOTby mika; 2 s a position`);
    await expect(page.locator(`.line-mark`)).toHaveCount(2);

    await gear.click();
    await expect(panel).toContainText(`299 of 300 positions left today.`);
    await panel.getByRole(`switch`, { name: `Lines on the board` }).uncheck();
    await expect(page.locator(`.line-mark`)).toHaveCount(0);
    await panel.getByRole(`switch`, { name: `Stone numbers` }).check();
    await expect(page.locator(`.board-camera .board-frame[data-numbers]`)).toHaveCount(1);

    await page.reload();
    await gear.click();
    await expect(panel.getByRole(`radio`, { name: `driftwood` })).toBeChecked();
    await expect(panel.getByRole(`switch`, { name: `Lines on the board` })).not.toBeChecked();
});

test('readings of one position by two analyzers sit under pills that switch between them', async ({ page }) => {
    const state = await open(page, game);
    await analyze(page).check();
    await expect(lines(page)).toHaveCount(3);
    await expect(page.locator(`.an-pills`)).toHaveCount(0);
    await page.getByRole(`button`, { name: `Analysis settings` }).click();
    await page.getByRole(`dialog`, { name: `Analysis settings` }).locator(`.an-analyzer`, { hasText: `driftwood` }).click();
    await page.keyboard.press(`Escape`);
    await expect(lines(page)).toHaveCount(2);
    expect(state.asked.map((asked) => asked.analyzer)).toEqual([null, `driftwood`]);
    const pills = page.getByRole(`group`, { name: `Readings` });
    await expect(pills.getByRole(`button`)).toHaveText([`driftwood`, `kestrel`]);
    await expect(pills.getByRole(`button`, { name: `driftwood` })).toHaveAttribute(`aria-pressed`, `true`);
    await pills.getByRole(`button`, { name: `kestrel` }).click();
    await expect(lines(page)).toHaveCount(3);
    await expect(page.locator(`.an-by`)).toContainText(`kestrel`);
    expect(state.asked).toHaveLength(2);
});

test('on a phone the eval bar runs under the board and the settings open in a sheet', async ({ page }) => {
    await open(page, game, {}, 390, 844);
    await analyze(page).check();
    await expect(lines(page)).toHaveCount(3);
    const [bar, stage] = await Promise.all([page.locator(`.an-evalbar`).boundingBox(), page.locator(`.an-stage`).boundingBox()]);
    expect(bar?.width).toBe(stage?.width);
    expect(Math.round((bar?.y ?? 0) + (bar?.height ?? 0))).toBe(Math.round((stage?.y ?? 0) + (stage?.height ?? 0)));
    await expect(page.locator(`.an-evalbar-chip`)).toBeHidden();
    await page.getByRole(`button`, { name: `Analysis settings` }).click();
    await expect(page.locator(`dialog.an-settings[open]`)).toHaveAttribute(`data-mode`, `sheet`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
