import { expect, test, type Page } from '@playwright/test';
import type { GameSnapshot, Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { serve, world } from './mock-api';

// The chip under the board holds the result with both names, and a name
// may run to 30 characters; it must stay inside the window, keep its text
// and its actions inside itself, leave the seat chip beside it clear, and
// sit below the room the camera keeps for the board.
const long: GameSnapshot[`players`] = {
    x: { name: `abcdefghijklmnopqrstuvwxyz1234`, rating: 1500, provisional: false, kind: `bot` },
    o: { name: `WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW`, rating: 1388, provisional: false, kind: `bot` },
};
const ordinary: GameSnapshot[`players`] = {
    x: { name: `driftwood`, rating: 1388, provisional: false, kind: `bot` },
    o: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
};
const results = [
    [`x`, `terminated`],
    [null, `terminated`],
    [`o`, `surrender`],
    [`x`, `six-in-a-row`],
    [`o`, `timeout`],
] as const;
const tom: Me = { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: [] };
const seats = [
    [`watching`, null],
    [`seated`, tom],
] as const;

async function showResults(page: Page, players: GameSnapshot[`players`], me: Me, fixture = `finished`): Promise<number> {
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const base = world({ me });
    const finished = base.games[fixture];
    if (finished === undefined) throw new Error(`no ${fixture} game in the world`);
    const games = Object.fromEntries(
        results.map(([winner, reason], index) => [`r${String(index)}`, { ...finished, gameId: `r${String(index)}`, players, winner, reason }]),
    );
    await serve(page, { ...base, games });
    return results.length;
}

type Box = { x: number; y: number; width: number; height: number };
const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const apart = (a: Box, b: Box) => right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y;
const middle = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
// Beside the seat chip on its row, the chip keeps at least the room the
// seat chip keeps to the board's edge.
const besideClear = (chip: Box, seat: Box, host: Box) => bottom(chip) <= seat.y || chip.x - right(seat) >= seat.x - host.x - 0.5;
// The least room the camera leaves between the board and the chip, its
// --space-2 at the default text size.
const gap = 8;

async function open(page: Page, id: number) {
    await page.goto(`/game/r${String(id)}`);
    await page.locator(`.hud-bottom-center .hud-result`).waitFor();
}

async function measure(page: Page) {
    return page.evaluate(() => {
        const box = (target: Pick<Element, `getBoundingClientRect`> | null) => {
            if (target === null) return null;
            const rect = target.getBoundingClientRect();
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const result = document.querySelector(`.hud-bottom-center .hud-result`);
        const range = document.createRange();
        if (result !== null) range.selectNodeContents(result);
        const seat = document.querySelector(`.hud-bottom-left`);
        const camera = document.querySelector(`.board-camera`);
        // The room the camera keeps for the board, inside its paddings: a
        // board that fits ends in it, and one that scrolls can scroll its
        // last row to its floor.
        let room = null;
        if (camera !== null) {
            const rect = camera.getBoundingClientRect();
            const style = getComputedStyle(camera);
            const [top, rightPad, bottomPad, left] = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(Number.parseFloat);
            if (top === undefined || rightPad === undefined || bottomPad === undefined || left === undefined) throw new Error(`no camera padding`);
            room = {
                x: rect.x + camera.clientLeft + left,
                y: rect.y + camera.clientTop + top,
                width: camera.clientWidth - left - rightPad,
                height: camera.clientHeight - top - bottomPad,
            };
        }
        const stones = [...document.querySelectorAll(`.board-camera .stone`)].map((stone) => box(stone));
        const drawer = document.querySelector(`.drawer-body:not([hidden])`);
        return {
            chip: box(document.querySelector(`.hud-bottom-center .hud-chip`)),
            top: box(document.querySelector(`.hud-top-left .hud-chip`)),
            text: result === null ? null : box(range),
            // A phone keeps the replay's steps in the sheet, so the chip holds the result alone.
            steps: ((steps) => (steps instanceof HTMLElement && steps.offsetParent !== null ? box(steps) : null))(document.querySelector(`.hud-bottom-center .scrubber`)),
            seat: seat !== null && getComputedStyle(seat).display !== `none` ? box(seat) : null,
            host: box(document.querySelector(`.board-host`)),
            room,
            stones: stones.filter((stone) => stone !== null),
            scrolls: camera !== null && (camera.scrollHeight > camera.clientHeight || camera.scrollWidth > camera.clientWidth),
            drawer: drawer === null ? null : box(drawer),
        };
    });
}

function span(boxes: readonly Box[]): Box {
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    return { x, y, width: Math.max(...boxes.map(right)) - x, height: Math.max(...boxes.map(bottom)) - y };
}

for (const [width, height] of [
    [320, 568],
    [360, 740],
    [390, 844],
    [430, 932],
] as const) {
    for (const [names, players] of [
        [`30-character`, long],
        [`ordinary`, ordinary],
    ] as const) {
        test(`the result chip keeps the longest results with ${names} names inside itself and under the board at ${String(width)} px`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            const count = await showResults(page, players, null);
            for (let id = 0; id < count; id += 1) {
                await open(page, id);
                await expect(async () => {
                    const { chip, top, text, steps, room } = await measure(page);
                    if (chip === null || top === null || text === null || room === null) throw new Error(`the chip or the board is missing`);
                    expect(chip.x).toBeGreaterThanOrEqual(0);
                    expect(right(chip)).toBeLessThanOrEqual(width);
                    // At its widest, a result naming the long names, the chip keeps the top chip's gutters.
                    if (players === long && results[id]?.[0] !== null) {
                        expect(Math.abs(chip.x - top.x)).toBeLessThanOrEqual(0.5);
                        expect(Math.abs(right(chip) - right(top))).toBeLessThanOrEqual(0.5);
                    }
                    for (const inner of steps === null ? [text] : [text, steps]) {
                        expect(inner.x).toBeGreaterThanOrEqual(chip.x - 0.5);
                        expect(right(inner)).toBeLessThanOrEqual(right(chip) + 0.5);
                    }
                    expect(chip.y - bottom(room)).toBeGreaterThanOrEqual(gap - 0.5);
                }).toPass();
            }
        });
    }
}

for (const [width, height] of [
    [667, 375],
    [768, 1024],
    [844, 390],
    [1024, 768],
    [1280, 800],
] as const) {
    for (const [who, me] of seats) {
        test(`the result chip leaves the seat chip clear at ${String(width)} by ${String(height)} px, ${who}`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            const count = await showResults(page, ordinary, me);
            for (let id = 0; id < count; id += 1) {
                await open(page, id);
                const { chip, seat } = await measure(page);
                if (chip === null || seat === null) throw new Error(`a chip is missing`);
                expect(apart(chip, seat)).toBe(true);
                expect(right(chip)).toBeLessThanOrEqual(width);
                // From the pinnable width an ordinary result has room on
                // the seat chip's row, so it stays there.
                if (width >= 1280) expect(Math.abs(bottom(chip) - bottom(seat))).toBeLessThanOrEqual(0.5);
            }
        });
    }
}

async function openMoves(page: Page) {
    await page.getByRole(`button`, { name: `Game panel` }).click();
    await page.getByRole(`tab`, { name: `Moves` }).click();
    await expect(page.getByRole(`tab`, { name: `Moves` })).toHaveAttribute(`aria-selected`, `true`);
}

// A finish seen live opens the Moves panel, which here takes its own
// column, so the chip wraps in a narrower board beside it.
async function underTheStones(page: Page, me: Me) {
    const count = await showResults(page, ordinary, me, `five-finished`);
    for (let id = 0; id < count; id += 1) {
        await open(page, id);
        await openMoves(page);
        await expect(async () => {
            const { chip, seat, host, room, stones } = await measure(page);
            if (chip === null || seat === null || host === null || room === null) throw new Error(`a chip or the board is missing`);
            expect(chip.y - bottom(room)).toBeGreaterThanOrEqual(gap - 0.5);
            expect(stones.filter((stone) => !apart(stone, chip))).toEqual([]);
            expect(apart(chip, seat)).toBe(true);
            expect(right(chip)).toBeLessThanOrEqual(right(host));
        }).toPass();
    }
}

for (const [width, height] of [
    [667, 375],
    [740, 360],
    [844, 390],
    [915, 412],
    [1024, 768],
] as const) {
    for (const [who, me] of seats) {
        test(`the result chip stays under the stones with the Moves panel open at ${String(width)} by ${String(height)} px, ${who}`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await underTheStones(page, me);
        });
    }
}

test.describe(`on a touch screen`, () => {
    test.use({ hasTouch: true, isMobile: true });

    // With the panel pinned a finish resizes nothing, so the board refits
    // for the finish itself: a finger's cell size no longer applies.
    test(`a board that finishes while watched refits to its whole frontier with the panel pinned at 1280 by 800 px`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await wear(page, { name: `pinned`, storage: { 'hexo-arena.drawer-pinned.v1': `1` } });
        const base = world({ me: null });
        const running = base.games.running;
        if (running?.status !== `in-progress`) throw new Error(`no running game in the world`);
        await serve(page, { ...base, games: { live: { ...running, gameId: `live`, players: ordinary } } });
        await page.addInitScript(() => {
            const Held = window.EventSource;
            const streams: EventTarget[] = [];
            Object.defineProperty(window, `streams`, { value: streams });
            Object.defineProperty(window, `EventSource`, {
                value: class extends Held {
                    constructor(url: string | URL, init?: EventSourceInit) {
                        super(url, init);
                        streams.push(this);
                    }
                },
                configurable: true,
                writable: true,
            });
        });
        await page.goto(`/game/live`);
        await page.locator(`.hud-bottom-center .hud-turn`).waitFor();
        await expect(async () => {
            expect((await measure(page)).scrolls).toBe(true);
        }).toPass();
        await page.evaluate(
            (snapshot) => {
                const streams: unknown = Reflect.get(window, `streams`);
                if (!Array.isArray(streams)) throw new Error(`no stream was opened`);
                for (const stream of streams) {
                    if (stream instanceof EventTarget) stream.dispatchEvent(new MessageEvent(`snapshot`, { data: JSON.stringify(snapshot) }));
                }
            },
            { gameId: `live`, players: ordinary, openingPlies: running.openingPlies, board: running.board, timeControl: running.timeControl, status: `finished`, winner: `x`, reason: `six-in-a-row`, voided: false },
        );
        await page.locator(`.hud-bottom-center .hud-result`).waitFor();
        await expect(async () => {
            expect((await measure(page)).scrolls).toBe(false);
        }).toPass();
    });
    for (const [width, height] of [
        [667, 375],
        [740, 360],
        [812, 375],
    ] as const) {
        for (const [who, me] of seats) {
            test(`the result chip stays under the stones with the Moves panel open at ${String(width)} by ${String(height)} px, ${who}`, async ({ page }) => {
                await page.setViewportSize({ width, height });
                await underTheStones(page, me);
            });
        }
    }
});

for (const [width, height] of [
    [667, 375],
    [740, 360],
] as const) {
    test(`the camera centers the stones it scrolls between the chips, and again beside the Moves panel, at ${String(width)} by ${String(height)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await showResults(page, ordinary, null, `five-finished`);
        await open(page, 0);
        const centered = async () => {
            await expect(async () => {
                const { room, stones, scrolls } = await measure(page);
                if (room === null) throw new Error(`the board is missing`);
                expect(scrolls).toBe(true);
                const stonesAt = middle(span(stones));
                const roomAt = middle(room);
                expect(Math.abs(stonesAt.x - roomAt.x)).toBeLessThanOrEqual(1);
                expect(Math.abs(stonesAt.y - roomAt.y)).toBeLessThanOrEqual(1);
            }).toPass();
        };
        await centered();
        await openMoves(page);
        await centered();
    });
}

// From the pinnable width the chips share a row, so a result with long
// names stacks above the seat chip when the two would meet, and keeps
// clear of the panel floating beside the board.
const longSeated: GameSnapshot[`players`] = { x: long.o, o: ordinary.o };
for (const [width, height] of [
    [1280, 800],
    [1920, 1080],
] as const) {
    for (const [who, me, players] of [
        [`watching`, seats[0][1], long],
        [`seated`, seats[1][1], longSeated],
    ] as const) {
        for (const panel of [`shut`, `open`, `pinned`] as const) {
            test(`a result with 30-character names leaves the seat chip and the panel clear at ${String(width)} by ${String(height)} px, ${who}, the panel ${panel}`, async ({ page }) => {
                await page.setViewportSize({ width, height });
                if (panel === `pinned`) await wear(page, { name: `pinned`, storage: { 'hexo-arena.drawer-pinned.v1': `1` } });
                const count = await showResults(page, players, me);
                for (let id = 0; id < count; id += 1) {
                    await open(page, id);
                    if (panel === `open`) await openMoves(page);
                    await expect(async () => {
                        const { chip, seat, host, room, drawer } = await measure(page);
                        if (chip === null || seat === null || host === null || room === null) throw new Error(`a chip or the board is missing`);
                        expect(besideClear(chip, seat, host)).toBe(true);
                        if (drawer !== null) expect(apart(chip, drawer)).toBe(true);
                        expect(chip.y - bottom(room)).toBeGreaterThanOrEqual(gap - 0.5);
                    }).toPass();
                }
            });
        }
    }
}

test(`a result with 30-character names stacks again when the window narrows from 1920 to 1280 px`, async ({ page }) => {
    const count = await showResults(page, long, null);
    for (let id = 0; id < count; id += 1) {
        await page.setViewportSize({ width: 1920, height: 1080 });
        await open(page, id);
        await page.setViewportSize({ width: 1280, height: 800 });
        await expect(async () => {
            const { chip, seat, host } = await measure(page);
            if (chip === null || seat === null || host === null) throw new Error(`a chip is missing`);
            expect(besideClear(chip, seat, host)).toBe(true);
        }).toPass();
    }
});

// A running chip is not measured, so a watched board keeps its room as the
// turn passes between a long name and a short one.
test(`a watched board keeps its room whoever is thinking at 320 px`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    const base = world({ me: null });
    const running = base.games.running;
    if (running?.status !== `in-progress`) throw new Error(`no running game in the world`);
    const players = { x: long.x, o: ordinary.x };
    await serve(page, {
        ...base,
        games: {
            long: { ...running, gameId: `long`, players, toMove: `x` },
            short: { ...running, gameId: `short`, players, toMove: `o` },
        },
    });
    const floors: number[] = [];
    for (const id of [`long`, `short`]) {
        await page.goto(`/game/${id}`);
        await page.locator(`.hud-bottom-center .hud-turn`).waitFor();
        const { room } = await measure(page);
        if (room === null) throw new Error(`the board is missing`);
        floors.push(bottom(room));
    }
    expect(floors[0]).toBe(floors[1]);
});

// The turn chip and the seat chip meet on one row at the narrow end of the
// band, so a running game stacks them as a finished one does.
for (const [width, height] of [
    [641, 800],
    [667, 375],
    [740, 360],
] as const) {
    test(`your turn chip leaves your seat chip clear at ${String(width)} by ${String(height)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        const look = looks[0];
        if (look === undefined) throw new Error(`no look registered`);
        await wear(page, look);
        await serve(page, world());
        await page.goto(`/game/running`);
        await page.locator(`.hud-bottom-center .hud-turn`).waitFor();
        const { chip, seat } = await measure(page);
        if (chip === null || seat === null) throw new Error(`a chip is missing`);
        expect(apart(chip, seat)).toBe(true);
    });
}
