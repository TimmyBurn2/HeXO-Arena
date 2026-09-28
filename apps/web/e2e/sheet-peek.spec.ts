import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot, Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// On a phone the sheet's peek keeps the bottom seat's name and clock in
// reach; while the raised sheet covers the result chip, the peek states
// the result instead, whole, however long the names.
const bot = (name: string, rating: number) => ({ name, rating, provisional: false, kind: `bot` as const });
const tom = { kind: `user`, name: `tom`, rating: 1503, provisional: false } as const;
const long = { x: bot(`abcdefghijklmnopqrstuvwxyz1234`, 1500), o: bot(`W`.repeat(30), 1388) };
const seats: readonly (readonly [string, GameSnapshot[`players`], Me])[] = [
    [`watching 9-letter names`, { x: bot(`driftwood`, 1388), o: bot(`quietlake`, 1461) }, null],
    [`watching 30-character names`, long, null],
    [`seated`, { x: tom, o: bot(`quietlake`, 1461) }, tom],
];
const results = [
    [`x`, `six-in-a-row`],
    [`o`, `timeout`],
    [`o`, `surrender`],
    [`x`, `disconnect`],
    [`x`, `terminated`],
    [null, `terminated`],
    [null, `aborted`],
] as const;

async function serveGames(page: Page, games: Record<string, GameSnapshot>, me: Me) {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, { ...world({ me }), games });
}

// Each item of the peek's row, its text included, since a squeezed item's
// text spills past its box.
async function rowItems(page: Page) {
    return page.locator(`.peek-row`).evaluate((row) =>
        [...row.children]
            .flatMap((child) => (child.classList.contains(`peek-who`) ? [...child.children] : [child]))
            .map((item) => {
                const box = item.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(item);
                const text = range.getBoundingClientRect();
                return {
                    name: item.className,
                    left: text.width > 0 ? Math.min(box.left, text.left) : box.left,
                    right: text.width > 0 ? Math.max(box.right, text.right) : box.right,
                    top: box.top,
                    bottom: box.bottom,
                    width: box.width,
                };
            })
            .filter((item) => item.width > 0),
    );
}

for (const width of [320, 360, 390]) {
    for (const [who, players, me] of seats) {
        test(`the running peek keeps its name, clock, and last move apart at ${String(width)} px, ${who}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const running = world().games.running;
            if (running?.status !== `in-progress`) throw new Error(`no running game in the world`);
            await serveGames(page, { running: { ...running, players } }, me);
            await page.goto(`/game/running`);
            await page.locator(`.peek-row .clock`).waitFor();
            const items = await rowItems(page);
            const touching = items.slice(1).filter((item, index) => {
                const before = items[index];
                return before !== undefined && item.top < before.bottom && item.left < before.right - 0.5;
            });
            expect(touching).toEqual([]);
        });
    }
}

for (const width of [320, 344, 390]) {
    for (const [who, players, me] of seats) {
        test(`the raised sheet shows the whole result at ${String(width)} px, ${who}`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 });
            const finished = world().games.finished;
            if (finished === undefined) throw new Error(`no finished game in the world`);
            await serveGames(
                page,
                Object.fromEntries(results.map(([winner, reason], index) => [`r${String(index)}`, { ...finished, gameId: `r${String(index)}`, players, winner, reason }])),
                me,
            );
            for (let id = 0; id < results.length; id += 1) {
                await page.goto(`/game/r${String(id)}`);
                const sentence = await page.locator(`.hud-bottom-center .hud-result`).innerText();
                await page.locator(`.hud-bottom-center`).getByRole(`button`, { name: `Moves` }).click();
                const peek = page.locator(`.peek-result`);
                await expect(peek).toHaveText(sentence);
                const fit = await peek.evaluate((line) => {
                    const node = line.firstChild;
                    const words: { word: string; top: number }[] = [];
                    let at = 0;
                    for (const word of (node?.textContent ?? ``).split(` `)) {
                        const range = document.createRange();
                        if (node !== null) {
                            range.setStart(node, at);
                            range.setEnd(node, at + word.length);
                        }
                        // A word broken across lines ends on the line of its last piece.
                        words.push({ word, top: Math.round(range.getBoundingClientRect().bottom) });
                        at += word.length + 1;
                    }
                    const tops = [...new Set(words.map((entry) => entry.top))];
                    const whole = document.createRange();
                    whole.selectNodeContents(line);
                    const text = whole.getBoundingClientRect();
                    return {
                        cut: line.scrollWidth > line.clientWidth || line.scrollHeight > line.clientHeight,
                        lines: tops.length,
                        last: words.filter((entry) => entry.top === Math.max(...tops)).length,
                        left: text.left,
                        right: text.right,
                        top: text.top,
                        bottom: text.bottom,
                    };
                });
                expect(fit.cut).toBe(false);
                expect(fit.left).toBeGreaterThanOrEqual(0);
                expect(fit.right).toBeLessThanOrEqual(width);
                // A 30-character name can leave no room beside it for the
                // word after it, so only ordinary names never end alone.
                if (fit.lines > 1 && players !== long) expect(fit.last).toBeGreaterThan(1);
                const [swatch, name] = await rowItems(page);
                if (swatch === undefined || name === undefined) throw new Error(`the peek has no name`);
                // The name keeps its swatch beside it, and the result sits on
                // their line only when it fits there whole; otherwise it
                // takes its own line under them.
                expect(name.top).toBeLessThan(swatch.bottom);
                expect(name.right).toBeLessThanOrEqual(width);
                if (fit.top < name.bottom) {
                    expect(fit.lines).toBe(1);
                    expect(fit.left).toBeGreaterThanOrEqual(name.right);
                } else {
                    expect(fit.top).toBeGreaterThanOrEqual(name.bottom - 0.5);
                }
                const badge = page.locator(`.peek-row .badge-bot`);
                if ((await badge.count()) > 0) {
                    const lines = await badge.evaluate((element) => {
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
                    });
                    expect(lines).toBe(1);
                }
            }
        });
    }
}
