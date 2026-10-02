import { expect, test, type Page, type Request } from '@playwright/test';
import { discordLoginHref, discordLoginPath, type Me } from '@hexo-arena/contract';
import { playBots, serve, world, type World } from './mock-api';

const guest: Me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };

async function open(page: Page, path: string, overrides: Partial<World> = {}): Promise<World> {
    const state = world({ bots: playBots, ...overrides });
    await serve(page, state);
    await page.goto(path);
    await page.locator(`.play-setup`).waitFor();
    return state;
}

function gameStarts(page: Page): Request[] {
    const seen: Request[] = [];
    page.on(`request`, (request) => {
        if (new URL(request.url()).pathname === `/api/games` && request.method() === `POST`) seen.push(request);
    });
    return seen;
}

const card = (page: Page) => page.locator(`.play-setup h2`).first();

// The tiles and counts hide their radios under the labels, so a pointer
// picks by the label, as a person does.
async function pickClock(page: Page, name: string): Promise<void> {
    await page.locator(`label.clock-tile`, { has: page.getByRole(`radio`, { name }) }).click();
}

async function pickOpening(page: Page, count: number): Promise<void> {
    await page.locator(`.opening summary`).click();
    await page.locator(`.opening-counts label`, { hasText: new RegExp(`^${String(count)}$`, `u`) }).click();
}

test('someone signed in starts a game with the bot, clock, and opening picked, and lands on the board', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`);
    await pickClock(page, `Turn clock, 20 seconds`);
    await pickOpening(page, 7);
    const sent = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/games` && request.method() === `POST`);
    await page.getByRole(`button`, { name: `Start game` }).click();
    expect((await sent).postDataJSON()).toEqual({ bot: `devbot-c`, timeControl: { mode: `turn`, turnTimeMs: 20_000 }, openingPlies: 7 });
    await expect(page).toHaveURL(/\/game\/running$/u);
    await page.locator(`svg polygon.cell`).first().waitFor();
});

test('a signed-out visitor plays as a guest from the keyboard, and the guest session comes first', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { me: null });
    const order: string[] = [];
    page.on(`request`, (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === `POST` && (path === `/api/auth/guest` || path === `/api/games`)) order.push(path);
    });
    await page.getByRole(`button`, { name: `Play as guest` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(page).toHaveURL(/\/game\/running$/u);
    expect(order).toEqual([`/api/auth/guest`, `/api/games`]);
});

test('the address follows the setup in place, and a sign-in from the card returns to it', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { me: null });
    const entries = await page.evaluate(() => window.history.length);
    await pickClock(page, `Turn clock, 60 seconds`);
    await pickOpening(page, 9);
    const setup = `/play?bot=devbot-c&clock=t60&opening=9`;
    await expect(page).toHaveURL(setup);
    expect(await page.evaluate(() => window.history.length)).toBe(entries);
    await expect(page.locator(`.start-area a.discord-button`)).toHaveAttribute(`href`, discordLoginHref(setup));
    // The top bar's link reads the address as it leaves.
    await page.route((url) => url.pathname === discordLoginPath, (route) => route.fulfill({ status: 204 }));
    const login = page.waitForRequest((request) => new URL(request.url()).pathname === discordLoginPath);
    await page.locator(`header a.discord-button`).click();
    expect(new URL((await login).url()).searchParams.get(`next`)).toBe(setup);
});

test('Play on a bot page and on a Bots row opens the Play page on that bot', async ({ page }) => {
    await serve(page, world({ bots: playBots }));
    await page.goto(`/bots/devbot-b`);
    await page.getByRole(`link`, { name: `Play devbot-b` }).click();
    await expect(page).toHaveURL(`/play?bot=devbot-b&clock=t10`);
    await expect(card(page)).toHaveText(`Play devbot-b`);
    await page.goBack();
    await expect(page).toHaveURL(`/bots/devbot-b`);
    await page.goto(`/bots`);
    await page.getByRole(`link`, { name: `Play quietlake` }).click();
    await expect(card(page)).toHaveText(`Play quietlake`);
    await expect(page.getByRole(`link`, { name: `Play sealbot` })).toHaveCount(0);
});

test('a guest sees Start game, and a note that the game is unrated under the guest name', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { me: guest });
    await expect(page.getByRole(`button`, { name: `Start game` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Play as guest` })).toHaveCount(0);
    await expect(page.locator(`.start-area .note`)).toContainText(`Guest k3f9`);
});

test('arrow keys walk the roster past a busy bot, and the card and the address follow', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`);
    const roster = page.locator(`.play-roster`);
    await roster.getByRole(`radio`, { name: `devbot-c` }).focus();
    await page.keyboard.press(`ArrowDown`);
    await expect(roster.getByRole(`radio`, { name: `quietlake` })).toBeFocused();
    await expect(card(page)).toHaveText(`Play quietlake`);
    await expect(page).toHaveURL(`/play?bot=quietlake&clock=t10`);
    // sealbot is at its game cap, so the walk wraps to the top without it.
    await page.keyboard.press(`ArrowDown`);
    await expect(roster.getByRole(`radio`, { name: `hextide` })).toBeFocused();
    await expect(roster.getByRole(`radio`, { name: `sealbot` })).toBeDisabled();
    await expect(card(page)).toHaveText(`Play hextide`);
});

test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the card stands alone, and Change opens the roster in a sheet that a tap closes', async ({ page }) => {
        await open(page, `/play?bot=devbot-c`);
        await expect(page.locator(`.play-roster`)).toBeHidden();
        await expect(page.getByRole(`button`, { name: `Start game` })).toBeInViewport();
        await page.getByRole(`button`, { name: `Change opponent` }).click();
        const sheet = page.locator(`dialog.play-sheet`);
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole(`radio`, { name: `devbot-c` })).toBeFocused();
        await sheet.locator(`label`, { hasText: `devbot-b` }).click();
        await expect(sheet).toBeHidden();
        await expect(page.locator(`.bot-choice-name strong`)).toHaveText(`devbot-b`);
    });

    test('arrow keys in the sheet pick as they move and keep it open, Enter closes it, and Escape leaves the pick', async ({ page }) => {
        await open(page, `/play?bot=devbot-c`);
        await page.getByRole(`button`, { name: `Change opponent` }).click();
        const sheet = page.locator(`dialog.play-sheet`);
        await expect(sheet.getByRole(`radio`, { name: `devbot-c` })).toBeFocused();
        await page.keyboard.press(`ArrowUp`);
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole(`radio`, { name: `devbot-a` })).toBeFocused();
        await page.keyboard.press(`ArrowUp`);
        await expect(sheet).toBeVisible();
        await page.keyboard.press(`Enter`);
        await expect(sheet).toBeHidden();
        await expect(page.locator(`.bot-choice-name strong`)).toHaveText(`devbot-b`);
        await expect(page.getByRole(`button`, { name: `Change opponent` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await expect(sheet).toBeVisible();
        await page.keyboard.press(`ArrowDown`);
        await page.keyboard.press(`Escape`);
        await expect(sheet).toBeHidden();
        await expect(page.locator(`.bot-choice-name strong`)).toHaveText(`devbot-a`);
    });
});

test('a double click on Start game starts one game', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { start: { status: 400, code: `bot_busy` } });
    const starts = gameStarts(page);
    await page.getByRole(`button`, { name: `Start game` }).dblclick();
    await page.locator(`.start-lines p`).first().waitFor();
    expect(starts).toHaveLength(1);
});

test('the second click of a double click never follows the Discord link that took the place of Start game', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { start: { status: 401, code: `unauthorized` } });
    const logins: string[] = [];
    page.on(`request`, (request) => {
        if (new URL(request.url()).pathname === discordLoginPath) logins.push(request.url());
    });
    const start = page.getByRole(`button`, { name: `Start game` });
    const box = await start.boundingBox();
    if (box === null) throw new Error(`Start game is not laid out`);
    await start.click();
    const link = page.locator(`.start-area a.discord-button`);
    await link.waitFor();
    const under = await link.boundingBox();
    if (under === null) throw new Error(`the Discord link is not laid out`);
    // The second press of a double click, where the pointer still is.
    await page.mouse.move(under.x + 4, under.y + under.height / 2);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect(page.locator(`.start-area .warn`)).toBeVisible();
    expect(logins).toEqual([]);
    await expect(page).toHaveURL(/\/play\?/u);
});

test('a cooldown counts down on the start and lets go at zero', async ({ page }) => {
    await page.clock.install();
    await open(page, `/play?bot=devbot-c`, { start: { status: 429, code: `game_cooldown`, retryAfter: 3 } });
    const start = page.getByRole(`button`, { name: `Start game` });
    await start.click();
    await expect(page.locator(`.start-lines`)).toContainText(`try again in 3 s`);
    await expect(start).toHaveAttribute(`aria-disabled`, `true`);
    await page.clock.runFor(4000);
    await expect(start).not.toHaveAttribute(`aria-disabled`);
    await expect(page.locator(`.start-lines p`)).toHaveCount(0);
});

test('Enter twice on a start refused for a lapsed session starts no guest game', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`, { start: { status: 401, code: `unauthorized` } });
    const guests: string[] = [];
    page.on(`request`, (request) => {
        if (new URL(request.url()).pathname === `/api/auth/guest`) guests.push(request.url());
    });
    await page.getByRole(`button`, { name: `Start game` }).focus();
    await page.keyboard.press(`Enter`);
    const warning = page.locator(`.start-area .warn`);
    await expect(warning).toBeFocused();
    await page.keyboard.press(`Enter`);
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`button`, { name: `Play as guest` })).toBeVisible();
    expect(guests).toEqual([]);
});

test('a stepper button shows keyboard focus, and keeps it at the end of its range', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`);
    await page.getByRole(`button`, { name: `Custom clock` }).click();
    await page.getByRole(`button`, { name: `Match` }).click();
    const more = page.getByRole(`button`, { name: `Increase Increment` });
    const rest = await more.screenshot();
    await page.getByRole(`spinbutton`, { name: `Increment` }).focus();
    await page.keyboard.press(`Tab`);
    await expect(more).toBeFocused();
    expect((await more.screenshot()).equals(rest)).toBe(false);
    for (let press = 0; press < 30; press += 1) await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`spinbutton`, { name: `Increment` })).toHaveAttribute(`aria-valuenow`, `30`);
    await expect(more).toBeFocused();
});

test('under forced colors the picked bot, clock, and count stand out, and what cannot be picked is gray', async ({ page }) => {
    await page.emulateMedia({ forcedColors: `active` });
    await open(page, `/play?bot=quietlake`);
    await page.locator(`.opening summary`).click();
    const outline = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(await outline(`.roster-row:has(input:checked)`)).toBe(`solid`);
    expect(await outline(`.roster-row:has(input:not(:checked)):not([aria-disabled])`)).toBe(`none`);
    expect(await outline(`.clock-tile:has(input:checked)`)).toBe(`solid`);
    expect(await outline(`.clock-tile:has(input:not(:checked))`)).toBe(`none`);
    expect(await outline(`.opening-counts input:checked + label`)).toBe(`solid`);
    const gray = await page.evaluate(() => {
        const probe = document.createElement(`span`);
        probe.style.color = `GrayText`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    const color = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).color);
    expect(await color(`.clock-tile:has(input:disabled) .clock-value`)).toBe(gray);
    expect(await color(`.roster-row[aria-disabled="true"] .player-name`)).toBe(gray);
    // quietlake takes no match clock, so in the clock set by hand Turn is pressed and Match refused;
    // the pressed mode is filled, so a ring on the other still reads as focus.
    await page.getByRole(`button`, { name: `Custom clock` }).click();
    const highlight = await page.evaluate(() => {
        const probe = document.createElement(`span`);
        probe.style.color = `Highlight`;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
    });
    const fill = (selector: string) => page.locator(selector).first().evaluate((element) => getComputedStyle(element).backgroundColor);
    const pressed = page.locator(`.seg-btn[aria-pressed="true"]`);
    expect(await fill(`.seg-btn[aria-pressed="true"]`)).toBe(highlight);
    expect(await pressed.evaluate((element) => getComputedStyle(element).forcedColorAdjust)).toBe(`none`);
    expect(await fill(`.seg-btn[aria-pressed="false"]`)).not.toBe(highlight);
    expect(await color(`.seg-btn[aria-disabled="true"]`)).toBe(gray);
    // Focus on the pressed mode shows against its fill.
    await pressed.focus();
    await page.keyboard.press(`Shift+Tab`);
    await page.keyboard.press(`Tab`);
    await expect(pressed).toBeFocused();
    const ring = await pressed.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, color: style.outlineColor, fill: style.backgroundColor };
    });
    expect(ring.style).toBe(`solid`);
    expect(ring.color).not.toBe(ring.fill);
});

const devbotC = playBots.find((bot) => bot.name === `devbot-c`);
if (devbotC === undefined) throw new Error(`no devbot-c in the Play bots`);

// Sixteen characters fit the card beside nothing, and thirty, the longest a name runs, do not.
for (const [width, long] of [
    [320, `longnamedbot-xyz`],
    [320, `a-bot-name-of-thirty-letters-z`],
    [360, `longnamedbot-xyz`],
    [360, `a-bot-name-of-thirty-letters-z`],
] as const) {
    test(`the phone chooser shows a ${String(long.length)}-character bot name whole at ${String(width)} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page, `/play?bot=${long}`, { bots: [...playBots, { ...devbotC, name: long }] });
        const name = page.locator(`.bot-choice-name strong`);
        await expect(name).toHaveText(long);
        const fits = await name.evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const card = element.closest(`.play-setup`)?.getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth + 0.5 && card !== undefined && range.getBoundingClientRect().right <= card.right;
        });
        expect(fits).toBe(true);
        await expect(page.getByRole(`button`, { name: `Change opponent` })).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
}

test('the phone sheet closes when the window widens past the phone and the roster returns', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `/play?bot=devbot-c`);
    await page.getByRole(`button`, { name: `Change opponent` }).click();
    await expect(page.locator(`dialog.play-sheet`)).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 844 });
    await expect(page.locator(`dialog.play-sheet`)).toHaveCount(0);
    await expect(page.locator(`.play-roster`)).toBeVisible();
    // Change is hidden past the phone, so focus lands on the picked bot rather than the page.
    await expect(page.locator(`.play-roster`).getByRole(`radio`, { name: `devbot-c` })).toBeFocused();
});

test('Play in the nav on the Play page opens a fresh setup, and Back returns to the one before', async ({ page }) => {
    await open(page, `/play?bot=hextide&clock=m5`);
    await expect(card(page)).toHaveText(`Play hextide`);
    await page.locator(`.nav-links`).getByRole(`link`, { name: `Play` }).click();
    await expect(page).toHaveURL(`/play?bot=devbot-c&clock=t10`);
    await expect(card(page)).toHaveText(`Play devbot-c`);
    await page.goBack();
    await expect(page).toHaveURL(`/play?bot=hextide&clock=m5`);
    await expect(card(page)).toHaveText(`Play hextide`);
    await expect(page.getByRole(`radio`, { name: `Match clock, 5 minutes plus 3 seconds` })).toBeChecked();
});

test('Start game stays where it is while the start is sent', async ({ page }) => {
    await open(page, `/play?bot=devbot-c`);
    const held: { release: (() => void) | null } = { release: null };
    await page.route(
        (url) => url.pathname === `/api/games`,
        async (route) => {
            await new Promise<void>((resolve) => {
                held.release = resolve;
            });
            await route.fallback();
        },
    );
    const start = page.getByRole(`button`, { name: `Start game` });
    const before = await start.boundingBox();
    await start.click();
    await expect(page.locator(`.start-lines .sr-only`)).toHaveText(`Starting the game`);
    expect(await start.boundingBox()).toEqual(before);
    held.release?.();
    await expect(page).toHaveURL(/\/game\/running$/u);
});

test('Enter after a busy refusal starts the game once the bot is free, with no pick in between', async ({ page }) => {
    const state = await open(page, `/play?bot=devbot-c`, { start: { status: 400, code: `bot_busy` } });
    const start = page.getByRole(`button`, { name: `Start game` });
    await start.focus();
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`.start-lines`)).toContainText(`devbot-c is in 4 games already; try again shortly`);
    state.start = `created`;
    await expect(start).not.toHaveAttribute(`aria-disabled`);
    await page.keyboard.press(`Enter`);
    await expect(page).toHaveURL(/\/game\/running$/u);
});

test.describe('on a phone, after the sheet', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the card head keeps only its title for screen readers, the chooser saying the rating', async ({ page }) => {
        await open(page, `/play?bot=devbot-c`);
        await expect(page.locator(`.setup-head h2`)).toHaveText(`Play devbot-c`);
        await expect(page.locator(`.setup-head .setup-rating`)).toBeHidden();
        await expect(page.locator(`.bot-choice-side .setup-rating`)).toBeVisible();
    });

    test('Back with the sheet open puts focus on the card of the setup it returns to', async ({ page }) => {
        await open(page, `/play?bot=hextide&clock=m5`);
        await page.locator(`.nav-tabs, nav.tabbar`).getByRole(`link`, { name: `Play` }).click();
        await expect(card(page)).toHaveText(`Play devbot-c`);
        await page.getByRole(`button`, { name: `Change opponent` }).click();
        await expect(page.locator(`dialog.play-sheet`)).toBeVisible();
        await page.goBack();
        await expect(page.locator(`dialog.play-sheet`)).toHaveCount(0);
        await expect(card(page)).toHaveText(`Play hextide`);
        await expect(page.getByRole(`button`, { name: `Change opponent` })).toBeFocused();
    });
});

test('Space on the clock shown, and Enter on the bot shown in the sheet, count as picks and let a held start go', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const state = await open(page, `/play?bot=devbot-c&clock=m5`, { start: { status: 400, code: `clock_not_accepted` } });
    const start = page.getByRole(`button`, { name: `Start game` });
    const refuse = async () => {
        // The list read after the refusal takes match clocks away, so the card moves to a turn clock nobody picked.
        state.bots = playBots.map((bot) => (bot.name === `devbot-c` ? { ...bot, accepts: { turnMs: [5000, 60000], match: false, unlimited: false } } : bot));
        await start.click();
        await expect(page.getByRole(`radio`, { name: `Turn clock, 10 seconds` })).toBeChecked();
        await expect(start).toHaveAttribute(`aria-disabled`, `true`);
    };
    await refuse();
    await page.getByRole(`radio`, { name: `Turn clock, 10 seconds` }).focus();
    await page.keyboard.press(`Space`);
    await expect(start).not.toHaveAttribute(`aria-disabled`);
    state.bots = playBots;
    await page.goto(`/play?bot=devbot-c&clock=m5`);
    await page.locator(`.play-setup`).waitFor();
    await refuse();
    await page.getByRole(`button`, { name: `Change opponent` }).click();
    await expect(page.locator(`dialog.play-sheet`).getByRole(`radio`, { name: `devbot-c` })).toBeFocused();
    await page.keyboard.press(`Enter`);
    await expect(page.locator(`dialog.play-sheet`)).toHaveCount(0);
    await expect(start).not.toHaveAttribute(`aria-disabled`);
});
