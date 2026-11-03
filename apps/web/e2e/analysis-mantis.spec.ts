import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// A stand-in for the pinned engine: the same exports, answering with the first empty cells near the origin,
// holding a turn while the page asks it to, and failing to start when the page says so.
const fakeEngine = `
const named = (name, message) => Object.assign(new Error(message), { name });
export async function createEngine() {
    if (window.mantisFails) throw named('NoBackendPassed', 'no candidate held');
    const taken = new Set();
    const put = (q, r) => taken.add(q + ',' + r);
    let abort = null;
    window.mantisCalls = [];
    const free = () => {
        for (let ring = 1; ; ring++)
            for (let q = -ring; q <= ring; q++)
                for (let r = -ring; r <= ring; r++)
                    if (!taken.has(q + ',' + r) && Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) === ring) return [q, r];
    };
    return {
        info: () => ({ backend: 'cpu', minTurnMs: 4500 }),
        newGame: async (opening) => { window.mantisCalls.push('newGame'); taken.clear(); for (const s of opening.stones) put(s.q, s.r); },
        play: async (stones) => { window.mantisCalls.push('play'); for (const s of stones) put(s.q, s.r); },
        playTurn: (budget) => new Promise((resolve, reject) => {
            window.mantisCalls.push(JSON.stringify(budget));
            const answer = () => {
                const stones = [free()];
                put(...stones[0]);
                stones.push(free());
                put(...stones[1]);
                resolve({ stones: stones.map((cell) => ({ cell })) });
            };
            abort = () => reject(named('AbortError', 'aborted'));
            const tick = () => (window.mantisHold ? setTimeout(tick, 20) : answer());
            tick();
        }),
        abort: () => abort?.(),
        dispose: () => undefined,
    };
}
`;

async function open(page: Page): Promise<void> {
    await page.setViewportSize({ width: 1280, height: 800 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, world({ me: null }));
    await page.route(`**/engines/mantis-0.1.0/src/index.js`, (route) => route.fulfill({ contentType: `text/javascript`, body: fakeEngine }));
    await page.goto(`/analysis`);
    await page.locator(`h1`).first().waitFor();
}

const card = (page: Page) => page.locator(`.an-mantis`);
const cell = (page: Page, x: number, y: number) => page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`);
const stones = (page: Page) => page.locator(`.board-camera .board-svg g.stone`);
const rows = (page: Page) => page.locator(`.an-tree .an-row:not(.an-opening) .an-move .sr-only`);

test('mantis answers each turn at the end of a line, at the level picked, and a clock below its shortest is not offered', async ({ page }) => {
    await open(page);
    await expect(card(page).locator(`option`)).toHaveText([`32 sims a stone`, `128 sims a stone`, `512 sims a stone`]);
    await card(page).getByRole(`button`, { name: `Mantis plays o` }).click();
    await expect(rows(page)).toHaveText([`o: [-1,0] [-1,1]`]);
    await expect(card(page).getByRole(`status`)).toHaveText(`Mantis answers at the end of a lineon the CPU`);
    await expect(card(page).locator(`option`)).toHaveText([`32 sims a stone`, `128 sims a stone`, `512 sims a stone`, `5 s a turn`, `10 s a turn`]);
    await card(page).getByLabel(`Level`).selectOption(`5 s a turn`);
    await cell(page, -3, 0).click();
    await cell(page, -4, 0).click();
    await expect(stones(page)).toHaveCount(7);
    expect(await page.evaluate(() => (window as unknown as { mantisCalls: string[] }).mantisCalls)).toEqual([`newGame`, `{"sims":128}`, `play`, `{"turnMs":5000}`]);
    // Stepping back shows the game without mantis playing over it.
    await page.keyboard.press(`ArrowLeft`);
    await expect(stones(page)).toHaveCount(5);
    await expect(card(page).getByRole(`status`)).toContainText(`Mantis answers at the end of a line`);
});

test('stopping mantis mid-turn leaves the board as it was and playable by hand', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
        (window as unknown as { mantisHold: boolean }).mantisHold = true;
    });
    await card(page).getByRole(`button`, { name: `Mantis plays o` }).click();
    await expect(card(page).getByRole(`status`)).toContainText(`Mantis is thinking`);
    await card(page).getByRole(`button`, { name: `Stop` }).click();
    await expect(card(page).getByRole(`button`, { name: `Mantis plays o` })).toBeVisible();
    await expect(stones(page)).toHaveCount(1);
    await cell(page, 1, 0).click();
    await cell(page, 0, 1).click();
    await expect(rows(page)).toHaveText([`o: [1,0] [1,-1]`]);
    await page.evaluate(() => {
        (window as unknown as { mantisHold: boolean }).mantisHold = false;
    });
    await card(page).getByRole(`button`, { name: `Mantis plays x` }).click();
    await expect(stones(page)).toHaveCount(5);
});

test('a browser that cannot run mantis is told so', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
        (window as unknown as { mantisFails: boolean }).mantisFails = true;
    });
    await card(page).getByRole(`button`, { name: `Mantis plays o` }).click();
    await expect(card(page).getByRole(`alert`)).toHaveText(`This browser cannot run mantis.`);
    await expect(stones(page)).toHaveCount(1);
});
