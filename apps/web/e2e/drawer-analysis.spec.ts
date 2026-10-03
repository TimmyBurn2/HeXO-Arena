import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { AnalysisList } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { longReadings, serve, world, type World } from './mock-api';

// A finished game's Moves head and feed with its readings, in every state a
// request passes through, on a laptop and a phone.
const game = `/game/long-finished`;
const laptop = { name: `1280`, width: 1280, height: 800 } as const;
const phone = { name: `390`, width: 390, height: 844 } as const;
interface Width {
    readonly name: string;
    readonly width: number;
    readonly height: number;
}

const lists = {
    review: { analyses: [longReadings.kestrel, longReadings.driftwood, ...longReadings.own], optedOut: false },
    none: { analyses: [...longReadings.own], optedOut: false },
    queued: { analyses: [longReadings.queued, ...longReadings.own], optedOut: false },
    running: { analyses: [longReadings.running, ...longReadings.own], optedOut: false },
    failed: { analyses: [longReadings.failed, ...longReadings.own], optedOut: false },
    'opted-out': { analyses: [], optedOut: true },
} satisfies Record<string, AnalysisList>;
type Named = keyof typeof lists;

// Opens the finished game in Ink at turn 22, x's blunder, on a world the test keeps.
async function open(page: Page, width: Width, list: AnalysisList, overrides: Partial<World> = {}): Promise<World> {
    await page.setViewportSize({ width: width.width, height: width.height });
    const ink = looks[0];
    if (ink === undefined) throw new Error(`no look registered`);
    await wear(page, ink);
    const state = world({ analyses: { 'long-finished': list }, ...overrides });
    await serve(page, state);
    await page.goto(`${game}?turn=22`);
    await page.locator(`svg polygon.cell`).first().waitFor();
    return state;
}

async function openPanel(page: Page, width: Width): Promise<void> {
    if (width.width > 640) await page.keyboard.press(`m`);
    else await page.getByRole(`button`, { name: `Open the game panel` }).click();
    await expect(page.locator(`#drawer-body`)).toBeVisible();
}

// Captures the state for review and holds the axe gates on it; an open
// phone sheet, which scrolls to the line shown, is captured at its head too.
async function capture(page: Page, name: string): Promise<void> {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `e2e/shots/drawer-analysis-${name}.png` });
    const axe = await new AxeBuilder({ page }).withRules([`color-contrast`, `heading-order`, `link-in-text-block`, `aria-allowed-attr`, `aria-progressbar-name`, `label`]).analyze();
    expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
    if ((page.viewportSize()?.width ?? 0) > 640 || !(await page.locator(`#drawer-body`).isVisible())) return;
    await page.locator(`.drawer-panel`).evaluate((panel) => {
        panel.scrollTop = 0;
    });
    await page.screenshot({ path: `e2e/shots/drawer-analysis-${name.replace(`--`, `-head--`)}.png` });
}

const head = (page: Page) => page.locator(`.dr-reading`);
const card = (page: Page) => page.locator(`.dr-card`);
const row = (page: Page, turn: number) => page.locator(`.feed-line`).filter({ has: page.locator(`.feed-n`, { hasText: new RegExp(`^${String(turn)}$`, `u`) }) });
const scrubWords = (page: Page) => page.locator(`.hud-bottom-center .scrub-words`);

for (const width of [laptop, phone]) {
    test(`a finished game read by two analyzers shows its readings, graph, marks, and judged turns at ${width.name}`, async ({ page }) => {
        const state = await open(page, width, lists.review);
        await openPanel(page, width);
        await expect(head(page).getByRole(`group`, { name: `Readings` }).getByRole(`button`)).toHaveText([`kestrel`, `driftwood`, `Own view`]);
        await expect(head(page).getByRole(`button`, { name: `kestrel` })).toHaveAttribute(`aria-pressed`, `true`);
        await expect(page.locator(`.dr-by`)).toHaveText(`kestrelBOT0.9, by tom; 2 s a position`);
        await expect(page.getByRole(`switch`, { name: `Lines on the board` })).toBeChecked();
        await expect(page.getByRole(`switch`, { name: `Stone numbers` })).toBeVisible();
        await expect(page.locator(`.dr-marks-row`)).toHaveText([`hextide?!1 inaccuracy??3 blunders`, `quietlake??7 blunders`]);
        await expect(row(page, 22).locator(`.feed-mark`)).toHaveText(`??blunder`);
        // x's turn 22 leaves o a six on the board, o's win in 1 under every analyzer.
        await expect(row(page, 22).locator(`.feed-value`)).toHaveText(`o wins in 1`);
        await expect(row(page, 25).locator(`.feed-value`)).toHaveText(`o wins`);
        // A value's side and number never break apart.
        expect(await row(page, 21).locator(`.feed-value`).textContent()).toBe(`o\u00a00.12`);
        await expect(page.locator(`.feed-note`)).toHaveText(/^Blunder: left a six; this turn leaves o a six to complete; kestrel preferred x: \[-?\d+,-?\d+\] \[-?\d+,-?\d+\]\.$/u);
        await expect(page.locator(`.feed-note`)).toBeInViewport();
        // The board: line A on its empty cells in x's color, the mark beside the played stones.
        await expect(page.locator(`.board-tag.jd-blunder`)).toHaveText(`??`);
        await expect(page.locator(`.line-mark.line-x .line-letters`)).toHaveText([`A`, `A`]);
        await capture(page, `review--ink--${width.name}`);
        expect(state.asked).toEqual([]);
    });
}

test(`the graph and the marks follow the reading picked, and the own view judges nothing`, async ({ page }) => {
    await open(page, laptop, lists.review);
    await openPanel(page, laptop);
    // The drawer's graph; the phone peek's mini graph stays hidden at this width.
    const graph = page.locator(`.dr-graph`);
    await expect(graph.locator(`.graph-mark`)).toHaveCount(11);
    await expect(graph.locator(`.graph-mark.jd-blunder`)).toHaveCount(10);
    // From turn 10 each of x's turns leaves o a six: pins on o's edge, the trace broken around them, the turns o held a win shaded.
    const pins = await graph.locator(`.graph-forced-o`).count();
    expect(pins).toBeGreaterThan(4);
    await expect(graph.locator(`.graph-trace:not(.graph-trace-x):not(.graph-trace-o)`)).toHaveCount(7);
    await expect(graph.locator(`.graph-wash`)).toHaveCount(14);
    await expect(graph.locator(`.graph-hold-o`)).toHaveCount(8);
    await expect(graph.locator(`.graph-hold-x`)).toHaveCount(1);
    await expect(graph.locator(`.graph-run`)).toHaveCount(1);
    await expect(graph.locator(`.graph-cursor`)).toHaveCount(1);
    await expect(page.getByRole(`img`, { name: `Graph of kestrel's reading, from the opening to turn 25` })).toBeVisible();
    // The span names the turns as the feed does, from the opening's line.
    await expect(page.locator(`.dr-graph-label`).first()).toHaveText(`x ahead above the lineop 0-2 to turn 25`);
    await head(page).getByRole(`button`, { name: `driftwood` }).click();
    await expect(page.locator(`.dr-by`)).toHaveText(`driftwoodBOTby mika; 2 s a position`);
    await expect(page.getByRole(`img`, { name: `Graph of driftwood's reading, from the opening to turn 25` })).toBeVisible();
    await head(page).getByRole(`button`, { name: `Own view` }).click();
    await expect(page.locator(`.dr-by-note`)).toHaveText(`Each bot's view of its own turns, published once the game ended`);
    await expect(graph.locator(`.graph-trace-x`)).toHaveCount(1);
    await expect(graph.locator(`.graph-trace-o`)).toHaveCount(1);
    await expect(graph.locator(`.graph-wash`)).toHaveCount(0);
    await expect(page.locator(`.graph-mark, .dr-marks, .feed-note, .feed .jd, .board-tag`)).toHaveCount(0);
    await expect(page.locator(`.dr-own-key`)).toHaveText(`hextidequietlake`);
});

test(`lines B and C show while the line shown is pointed at or focused, and the switch takes the lines off the board`, async ({ page }) => {
    await open(page, laptop, lists.review);
    await openPanel(page, laptop);
    const letters = page.locator(`.line-mark .line-letters`);
    await expect(letters).toHaveText([`A`, `A`]);
    // x's turn 22 took one of B's cells and both of C's, so B shows one cell and C none.
    await row(page, 22).hover();
    await expect(letters).toHaveText([`B`, `A`, `A`]);
    await page.mouse.move(10, 400);
    await expect(letters).toHaveText([`A`, `A`]);
    await row(page, 22).focus();
    await expect(letters).toHaveText([`B`, `A`, `A`]);
    await page.getByRole(`switch`, { name: `Lines on the board` }).click();
    await expect(page.locator(`.line-mark`)).toHaveCount(0);
    await expect(page.locator(`.board-tag`)).toHaveCount(1);
});

test(`a press on a line of the feed or on the graph shows that turn`, async ({ page }) => {
    await open(page, laptop, lists.review);
    await openPanel(page, laptop);
    await row(page, 6).click();
    await expect(scrubWords(page)).toHaveText(`Turn 6 of 25`);
    await expect(row(page, 6).locator(`.feed-mark`)).toHaveText(`?!inaccuracy`);
    await expect(page.locator(`.feed-note`)).toHaveText(/^Inaccuracy: kestrel rates this turn 0\.12 below its choice, x\u00a00\.17 before and x\u00a00\.05 after; it preferred x: /u);
    await expect(page.locator(`.board-tag.jd-inaccuracy`)).toHaveCount(1);
    const graph = await page.locator(`.dr-graph .graph-svg`).boundingBox();
    if (graph === null) throw new Error(`no graph`);
    await page.mouse.click(graph.x + 6, graph.y + graph.height / 2);
    await expect(scrubWords(page)).toHaveText(`Opening, 5 stones`);
    await expect(page.locator(`.feed-line.latest .feed-n`)).toContainText(`op 0-2`);
});

// Each part of a feed line that leaves its line's box or overlaps the next line, and each opening group broken over lines.
async function openingFaults(page: Page): Promise<string[]> {
    return page.locator(`.feed`).evaluate((feed) => {
        const found: string[] = [];
        const lines = (element: Element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
        };
        const opening = feed.querySelector(`.feed-opening`);
        const next = opening?.nextElementSibling ?? null;
        if (opening === null || next === null) return [`no opening line`];
        const box = opening.getBoundingClientRect();
        for (const part of opening.querySelectorAll(`.feed-n, .feed-group`)) {
            const rect = part.getBoundingClientRect();
            if (rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5) found.push(`${part.textContent} runs out of its line`);
            if (part.classList.contains(`feed-group`) && lines(part) !== 1) found.push(`${part.textContent} breaks`);
        }
        if (next.getBoundingClientRect().top < box.bottom - 0.5) found.push(`the next line overlaps the opening`);
        return found;
    });
}

for (const width of [laptop, phone]) {
    test(`the feed's opening line keeps its label and each side's stones whole and clear of the next line at ${width.name}`, async ({ page }) => {
        await open(page, width, lists.review);
        await openPanel(page, width);
        await page.locator(`.feed-opening`).click();
        await expect(scrubWords(page)).toHaveText(`Opening, 5 stones`);
        await expect(page.locator(`.feed-opening .feed-group`)).toHaveText([`x: [0,0]`, /^o: /u, /^x: /u]);
        expect(await openingFaults(page)).toEqual([]);
        // Large text takes the room from the stones, never the line's height from them.
        const devtools = await page.context().newCDPSession(page);
        await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: 24 } });
        await page.waitForTimeout(250);
        expect(await openingFaults(page)).toEqual([]);
    });
}

for (const width of [laptop, phone]) {
    test(`with no community reading yet the own view stands, and a request names its analyzer and waits for one at ${width.name}`, async ({ page }) => {
        const state = await open(page, width, lists.none);
        await openPanel(page, width);
        await expect(head(page).getByRole(`group`, { name: `Readings` }).getByRole(`button`)).toHaveText([`Own view`]);
        await expect(page.getByRole(`heading`, { name: `No community reading yet` })).toBeVisible();
        const analyzer = page.getByRole(`combobox`, { name: `Analyzer` });
        await expect(analyzer.locator(`option`)).toHaveText([`Any analyzer (2 online)`, `kestrel, by tom`, `driftwood, by mika`]);
        await expect(card(page)).toContainText(`10 of 10 requests left today.`);
        await capture(page, `none--ink--${width.name}`);
        await analyzer.selectOption(`kestrel`);
        await page.getByRole(`button`, { name: `Request analysis` }).click();
        await expect(card(page)).toHaveText(`Waiting for an analyzer; this game is next`);
        // The button went with the request, so the keyboard lands on the card in its place.
        await expect(page.locator(`.dr-status`)).toBeFocused();
        expect(state.requested).toEqual([{ gameId: `long-finished`, request: { analyzer: `kestrel` } }]);
        expect(state.asked).toEqual([]);
    });
}

test(`a requested reading is polled while it waits and runs: the graph fills, then the marks appear`, async ({ page }) => {
    const state = await open(page, laptop, lists.none);
    await openPanel(page, laptop);
    await page.getByRole(`button`, { name: `Request analysis` }).click();
    await expect(card(page)).toHaveText(`Waiting for an analyzer; this game is next`);
    state.analyses[`long-finished`] = lists.running;
    await expect(card(page)).toContainText(`kestrel is reading turn 13 of 25`, { timeout: 8_000 });
    await expect(head(page).getByRole(`button`, { name: `kestrel` })).toHaveAttribute(`aria-pressed`, `true`);
    await expect(page.locator(`.dr-marks, .graph-mark`)).toHaveCount(0);
    state.analyses[`long-finished`] = { analyses: [longReadings.kestrel, ...longReadings.own], optedOut: false };
    await expect(page.locator(`.dr-marks-row`)).toHaveCount(2, { timeout: 8_000 });
    await expect(card(page)).toHaveCount(0);
    // Done, nothing is under way, so the page reads no more.
    let reads = 0;
    page.on(`request`, (request) => {
        if (request.url().endsWith(`/api/games/long-finished/analyses`)) reads += 1;
    });
    await page.waitForTimeout(4_000);
    expect(reads).toBe(0);
});

for (const width of [laptop, phone]) {
    test(`a queued reading says how many games are ahead of it at ${width.name}`, async ({ page }) => {
        await open(page, width, lists.queued);
        await openPanel(page, width);
        await expect(card(page)).toHaveText(`Waiting for an analyzer; 2 games ahead`);
        await expect(head(page).getByRole(`button`, { name: `Own view` })).toHaveAttribute(`aria-pressed`, `true`);
        await capture(page, `queued--ink--${width.name}`);
    });

    test(`a running reading names its analyzer and turn, fills its graph, and holds its marks at ${width.name}`, async ({ page }) => {
        await open(page, width, lists.running);
        await openPanel(page, width);
        await expect(card(page).locator(`.dr-card-title`)).toHaveText(`kestrel is reading turn 13 of 25`);
        await expect(page.getByRole(`progressbar`, { name: `kestrel is reading turn 13 of 25` })).toHaveAttribute(`aria-valuenow`, `43`);
        await expect(card(page)).toContainText(`Marks appear when the reading is done; the graph fills as turns arrive.`);
        await expect(row(page, 11).locator(`.feed-value`)).not.toHaveText(``);
        await expect(row(page, 13).locator(`.feed-value`)).toHaveText(``);
        await expect(page.locator(`.dr-marks, .feed .jd, .board-tag`)).toHaveCount(0);
        await capture(page, `running--ink--${width.name}`);
    });

    test(`a failed reading says who did not finish, why, and where, and asks again at ${width.name}`, async ({ page }) => {
        const state = await open(page, width, lists.failed);
        await openPanel(page, width);
        await expect(card(page).locator(`.dr-card-title`)).toHaveText(`kestrel did not finish: timed out on turn 14`);
        await capture(page, `failed--ink--${width.name}`);
        await page.getByRole(`button`, { name: `Request again` }).focus();
        await page.keyboard.press(`Enter`);
        await expect(card(page)).toHaveText(`Waiting for an analyzer; this game is next`);
        await expect(page.locator(`.dr-status`)).toBeFocused();
        expect(state.requested).toEqual([{ gameId: `long-finished`, request: {} }]);
    });

    test(`an opted-out game says so and shows no reading at ${width.name}`, async ({ page }) => {
        await open(page, width, lists[`opted-out`]);
        await openPanel(page, width);
        await expect(card(page)).toHaveText(`A player in this game asked that their games not be analyzed`);
        await expect(page.locator(`.dr-pills, .graph, .feed .feed-value`)).toHaveCount(0);
        await expect(page.getByRole(`switch`, { name: `Lines on the board` })).toHaveCount(0);
        await capture(page, `opted-out--ink--${width.name}`);
    });
}

test(`signed out, the card asks for a sign-in instead of a request`, async ({ page }) => {
    await open(page, laptop, lists.none, { me: null });
    await openPanel(page, laptop);
    await expect(card(page)).toContainText(`Sign in to ask an analyzer to read this game.`);
    await expect(card(page).getByRole(`link`, { name: /Sign in/u })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Request analysis` })).toHaveCount(0);
    await capture(page, `signed-out--ink--1280`);
});

test(`with the day's requests spent the card says so and offers no button`, async ({ page }) => {
    const me = world().me;
    if (me?.kind !== `user`) throw new Error(`the default world is signed in`);
    await open(page, laptop, lists.failed, { me: { ...me, analysisLeft: { ...me.analysisLeft, games: 0 } } });
    await openPanel(page, laptop);
    await expect(card(page)).toContainText(`No requests left today; the count starts again at 00:00 UTC.`);
    await expect(page.getByRole(`button`, { name: `Request again` })).toHaveCount(0);
});

// The lines of the feed the panel shows whole, below its head.
async function linesInView(page: Page): Promise<number> {
    return page.evaluate(() => {
        const panel = document.querySelector(`.drawer-panel`)?.getBoundingClientRect();
        const head = document.querySelector(`.moves-head`)?.getBoundingClientRect();
        if (panel === undefined || head === undefined) return 0;
        return [...document.querySelectorAll(`.feed-line`)].filter((line) => {
            const box = line.getBoundingClientRect();
            return box.top >= head.bottom - 1 && box.bottom <= panel.bottom + 1;
        }).length;
    });
}

test(`on a short laptop a head as tall as the request card scrolls on its own, and the feed keeps lines in view`, async ({ page }) => {
    await open(page, { ...laptop, height: 720 }, lists.none);
    await openPanel(page, laptop);
    await expect(page.getByRole(`heading`, { name: `No community reading yet` })).toBeAttached();
    expect(await linesInView(page)).toBeGreaterThanOrEqual(5);
    // Focus brings the button into view inside the head.
    await page.getByRole(`button`, { name: `Request analysis` }).focus();
    await expect(page.getByRole(`button`, { name: `Request analysis` })).toBeInViewport();
    const head = await page.locator(`.moves-head`).boundingBox();
    const button = await page.getByRole(`button`, { name: `Request analysis` }).boundingBox();
    if (head === null || button === null) throw new Error(`no head or button`);
    expect(button.y + button.height).toBeLessThanOrEqual(head.y + head.height + 1);
});

for (const size of [24, 32]) {
    for (const width of [320, 390]) {
        test(`at ${String((size / 16) * 100)}% text on a ${String(width)} px phone no mark covers a turn's cells`, async ({ page }) => {
            const ink = looks[0];
            if (ink === undefined) throw new Error(`no look registered`);
            await wear(page, ink);
            await serve(page, world({ analyses: { 'long-finished': lists.review } }));
            await page.setViewportSize({ width, height: 844 });
            const devtools = await page.context().newCDPSession(page);
            await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
            await page.goto(`${game}?turn=22`);
            await page.getByRole(`button`, { name: `Open the game panel` }).click();
            await page.locator(`.feed .jd`).first().waitFor();
            const overlaps = await page.evaluate(() =>
                [...document.querySelectorAll(`.feed-line`)].flatMap((line) => {
                    const cells = line.querySelector(`.feed-group`);
                    const mark = line.querySelector(`.feed-mark`);
                    if (cells === null || mark === null) return [];
                    const range = document.createRange();
                    range.selectNodeContents(cells);
                    const text = range.getBoundingClientRect();
                    return text.right > mark.getBoundingClientRect().left + 0.5 ? [line.textContent] : [];
                }),
            );
            expect(overlaps).toEqual([]);
        });
    }
}

test(`a refused request says why in plain words`, async ({ page }) => {
    await open(page, laptop, lists.none, { analyzers: [] });
    await openPanel(page, laptop);
    await expect(page.getByRole(`combobox`, { name: `Analyzer` }).locator(`option`)).toHaveText([`Any analyzer (0 online)`]);
    await page.getByRole(`button`, { name: `Request analysis` }).click();
    await expect(card(page).getByRole(`alert`)).toHaveText(`No analyzer is free to read this game; request again later`);
    await expect(page.getByRole(`heading`, { name: `No community reading yet` })).toBeVisible();
});

const peeks: readonly { name: Named; readout: RegExp | null; graph: boolean }[] = [
    { name: `review`, readout: /^\?\?blunderhextide: left a six; kestrel$/u, graph: true },
    { name: `none`, readout: /^hextide: o wins in 2; own view$/u, graph: true },
    { name: `queued`, readout: /^Waiting for an analyzer; 2 games ahead$/u, graph: true },
    { name: `running`, readout: /^kestrel is reading turn 13 of 25$/u, graph: true },
    { name: `opted-out`, readout: null, graph: false },
];

for (const peek of peeks) {
    test(`a phone's closed sheet carries the ${peek.name} reading in its peek, above which the chip keeps Open in Analysis`, async ({ page }) => {
        await open(page, phone, lists[peek.name]);
        if (peek.readout === null) await expect(page.locator(`.peek-readout`)).toHaveCount(0);
        else await expect(page.locator(`.peek-readout`)).toHaveText(peek.readout);
        await expect(page.locator(`.peek-graph .graph`)).toHaveCount(peek.graph ? 1 : 0);
        await expect(page.locator(`.peek-scrub`).getByRole(`button`, { name: `Go back a turn` })).toBeVisible();
        const chip = page.locator(`.hud-bottom-center`);
        await expect(chip.getByRole(`link`, { name: `Open in Analysis` })).toBeVisible();
        // The chip stands clear above the peek.
        const chipBox = await chip.boundingBox();
        const peekBox = await page.locator(`.sheet-peek`).boundingBox();
        if (chipBox === null || peekBox === null) throw new Error(`no chip or peek`);
        expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(peekBox.y);
        await capture(page, `${peek.name}-peek--ink--390`);
        await page.getByRole(`button`, { name: `Open the game panel` }).click();
        await expect(page.locator(`.peek-readout, .peek-graph`).first()).toBeHidden();
    });
}

test(`the feed folds a run of marked turns after its first line, opens it to its lines, and keeps it open while the turn shown lies in it`, async ({ page }) => {
    await open(page, laptop, lists.review);
    await openPanel(page, laptop);
    const fold = page.locator(`.feed-fold-go`);
    // Turn 22, shown, lies in the run of turns 19 to 24, so its lines stand open.
    await expect(fold).toHaveText(`Turns 19 to 24: wins let goEach turn here let a win go or handed one over; kestrel marks all 6.`);
    await expect(fold).toHaveAttribute(`aria-expanded`, `true`);
    await expect(row(page, 22)).toHaveCount(1);
    await row(page, 12).click();
    await expect(scrubWords(page)).toHaveText(`Turn 12 of 25`);
    await expect(fold).toHaveAttribute(`aria-expanded`, `false`);
    await expect(row(page, 22)).toHaveCount(0);
    await expect(page.locator(`.dr-marks-runs`)).toHaveText(`6 in runs`);
    await fold.click();
    await expect(row(page, 22).locator(`.feed-mark`)).toHaveText(`??blunder`);
});
