import { expect, test, type Page } from '@playwright/test';
import { looks, pickBots, wear } from './matrix';
import { anaMe, duelBots, roundRobins, serve, tournaments, world, type World } from './mock-api';

const quinnMe = { kind: `user` as const, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

// ana's bots and everyone else's, the weekly waiting, and the round robins people set up.
const robins = (overrides: Partial<World> = {}) =>
    world({ me: anaMe, bots: duelBots, tournaments: [...structuredClone(tournaments().filter((entry) => entry.status !== `running`)), ...structuredClone(roundRobins())], live: [], ...overrides });

async function open(page: Page, path: string, width: number, state: World = robins()): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, state);
    await page.goto(path);
}

async function noSidewaysScroll(page: Page): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const width of [1280, 390]) {
    test(`a round robin is set up from bots picked several at once and opens its page, Back finding the setup as it was left, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width);
        await expect(page.getByRole(`heading`, { name: `New duel` })).toBeVisible();
        await expect(page.getByText(`Pick 2 to 8 from the bot list, several at once`)).toBeVisible();
        await pickBots(page, [`hextide`, `Pistol1`, `devbot-a`]);
        await expect(page.getByRole(`heading`, { name: `New round robin` })).toBeVisible();
        await expect(page.getByText(/^Every pair meets once: 3 pairs in 3 rounds\./u)).toBeVisible();
        await expect(page.getByText(`Entered in the weekly, which starts in 2 h 59 min; it leaves this duel or round robin then.`)).toBeVisible();
        await noSidewaysScroll(page);
        await page.getByRole(`button`, { name: `Start round robin` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
        await expect(page.getByRole(`heading`, { name: `Round robin by ana`, level: 1 })).toBeVisible();
        // The server answers with every round drawn and the first under way.
        await expect(page.getByText(`Round 1 of 3 is live.`)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Next: round 2` })).toBeVisible();
        await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Games` })).toHaveAttribute(`aria-current`, `page`);
        await page.goBack();
        await expect(page).toHaveURL(/\/play\/tournament\?bots=hextide%2CPistol1%2Cdevbot-a&games=2&clock=t10&opening=5$/u);
        await expect(page.locator(`.rr-plates .slot-filled`)).toHaveCount(3);
    });

    test(`the bot list dims the bots that cannot join with the reason, tags those added, and fills a phone, at ${String(width)} px`, async ({ page }) => {
        const state = robins();
        state.duelStates = duelBots.map((bot) => ({ name: bot.name, duelsByOthers: bot.name !== `quietlake`, dueling: [], roundRobins: bot.name === `devbot-c` ? 2 : 0 }));
        await open(page, `/play/tournament`, width, state);
        await pickBots(page, [`hextide`]);
        await page.getByRole(`button`, { name: `Add a second bot` }).click();
        const dialog = page.locator(`dialog.rr-picker[open]`);
        await expect(dialog.getByRole(`button`, { name: /^hextide\b/u })).toContainText(`added`);
        await expect(dialog.getByRole(`button`, { name: /^quietlake\b/u })).toHaveAttribute(`aria-disabled`, `true`);
        await expect(dialog.getByRole(`button`, { name: /^quietlake\b/u })).toContainText(`Duels by others are off`);
        await expect(dialog.getByRole(`button`, { name: /^devbot-c\b/u })).toContainText(`In 2 duels or round robins; try again after one ends`);
        await dialog.getByRole(`button`, { name: /^Pistol1\b/u }).click();
        await expect(dialog.getByText(`1 picked`)).toBeVisible();
        await expect(dialog.getByText(`6 more fit; up to 8 bots`)).toBeVisible();
        if (width === 390) {
            const box = await dialog.boundingBox();
            expect(box?.width).toBe(390);
        }
        await noSidewaysScroll(page);
    });

    test(`a refusal says why under Start and marks the bot it names, and a test takes up to fifty games a pair while no bot passes 70, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width, robins({ roundRobinStart: { status: 400, code: `bot_busy`, bot: `devbot-a` } }));
        await pickBots(page, [`hextide`, `Pistol1`, `devbot-a`]);
        await page.getByRole(`button`, { name: `Start round robin` }).click();
        await expect(page.locator(`.start-refusal`)).toHaveText(/^devbot-a is busy/u);
        await expect(page.locator(`.slot-marked`)).toContainText(`devbot-a`);
        for (const name of [`Pistol1`, `devbot-a`]) await page.getByRole(`button`, { name: `Remove ${name}` }).click();
        await pickBots(page, [`cinder`, `pebble`]);
        await expect(page.getByRole(`heading`, { name: `New test` })).toBeVisible();
        const counts = page.getByRole(`radiogroup`, { name: `Games per pair` }).getByRole(`radio`);
        await expect(counts).toHaveCount(9);
        await expect(counts.last()).toBeDisabled();
        await expect(page.getByText(`3 bots take up to 30 a pair: no bot plays more than 30 games, or 70 in a test.`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Start test` })).toBeVisible();
        await noSidewaysScroll(page);
    });

    test(`a signed-out reader is asked to sign in to set one up, the weekly beside it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width, robins({ me: null }));
        await expect(page.getByText(`Sign in to set up a duel or round robin; anyone can watch one.`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Add bots`, exact: true })).toHaveCount(0);
        await expect(page.getByRole(`heading`, { name: `Weekly tournament` })).toBeVisible();
        await expect(page.getByText(`Sign in to see your tournaments.`)).toBeVisible();
        await noSidewaysScroll(page);
    });

    test(`a live round robin's page shows its round, the bot waited for, the round to come, and lets an owner withdraw a bot, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunorobin01`, width);
        await expect(page.getByText(`Round 2 of 3 is live; hextide leads with 2 points.`)).toBeVisible();
        await expect(page.locator(`.duel-kicker`)).toContainText(`Round robin`);
        await expect(page.getByText(/^Waiting for quietlake; \d+ s left$/u)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Next: round 3` })).toBeVisible();
        await page.getByRole(`button`, { name: `Withdraw hextide` }).click();
        await page.getByRole(`button`, { name: `Withdraw; hextide plays no further game` }).click();
        await expect(page.getByRole(`button`, { name: `Withdraw hextide` })).toHaveCount(0);
        await noSidewaysScroll(page);
    });

    test(`its creator stops a round robin, confirmed in place, focus on a control that is there throughout, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_quinnrobin01`, width, robins({ me: quinnMe }));
        await page.getByRole(`button`, { name: `Stop round robin` }).focus();
        await page.keyboard.press(`Enter`);
        await expect(page.getByText(`Stop the round robin? No further game starts; the live games play on, and the standings stand as they are.`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Keep playing` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await expect(page.getByRole(`button`, { name: `Stop round robin` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await page.keyboard.press(`Shift+Tab`);
        await expect(page.getByRole(`button`, { name: `Stop; no further game starts` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await expect(page.getByText(/^Stopped by quinn after round 2/u)).toBeVisible();
        await expect(page.getByRole(`link`, { name: `These games in Games` })).toBeFocused();
        await noSidewaysScroll(page);
    });

    test(`a test leads with each bot against the others and runs again for its creator, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_anatest00001`, width);
        await expect(page.getByText(`hextide scored 7 of 8 against the other two: stronger.`)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Each bot against the other two` })).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Pairs` })).toBeVisible();
        await page.getByRole(`button`, { name: `Run 12 more` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
        await noSidewaysScroll(page);
    });

    test(`the tournaments under Games tag each one and narrow to the reader's own and to tests, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/tournaments`, width);
        await expect(page.getByRole(`link`, { name: `New duel or round robin` })).toHaveAttribute(`href`, `/play/tournament`);
        const live = page.getByRole(`region`, { name: `Live` });
        await expect(live.locator(`.tournament-row`)).toHaveCount(2);
        await expect(live.locator(`.tournament-row`).first()).toContainText(`unrated`);
        await expect(page.getByRole(`link`, { name: `Round robin by ana` })).toHaveCount(0);
        await page.getByRole(`button`, { name: `Tests` }).click();
        await expect(page).toHaveURL(/\/games\/tournaments\?list=tests$/u);
        await expect(page.getByRole(`link`, { name: `Round robin by ana` })).toBeVisible();
        await expect(page.getByText(`No duel or round robin is live right now.`)).toBeVisible();
        await page.getByRole(`button`, { name: `Yours` }).click();
        await expect(page.getByRole(`link`, { name: `Round robin by ana` })).toBeVisible();
        await noSidewaysScroll(page);
    });

    test(`Home's tournament block offers an owner the weekly's entry and anyone signed in a round robin, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/`, width, robins({ me: quinnMe, bots: duelBots.map((bot) => (bot.name === `driftwood` ? { ...bot, ownerName: `quinn` } : bot)) }));
        const block = page.getByRole(`region`, { name: `Tournament` });
        await expect(block.getByRole(`link`, { name: `Enter a bot in Winter cup` })).toBeVisible();
        await expect(block.locator(`.home-row`).filter({ hasText: `Winter cup` }).getByRole(`link`, { name: `Enter a bot in Winter cup` })).toBeVisible();
        await expect(block.getByRole(`link`, { name: `Set up a round robin` })).toHaveAttribute(`href`, `/play/tournament`);
    });

    test(`Profile's round robins are rows as on Play when Profile is the first page loaded, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/profile`, width);
        const block = page.locator(`section:has(#your-round-robins-title)`);
        const row = block.locator(`.tournament-row`).first();
        await expect(row).toHaveCSS(`display`, `flex`);
        const weights = await row.evaluate((element) => ({ name: getComputedStyle(element.querySelector(`.tournament-row-name`) ?? element).fontWeight, facts: getComputedStyle(element.querySelector(`.tournament-row-facts`) ?? element).fontWeight }));
        expect(Number(weights.name)).toBeGreaterThan(Number(weights.facts));
        await expect(row.locator(`.tournament-row-facts`)).not.toHaveCSS(`color`, await row.locator(`.tournament-row-yours`).evaluate((element) => getComputedStyle(element).color));
    });
}

// Text at 150 and 200% fills a phone's sheet with the head and the foot; the rows still scroll into reach and Add stays in view.
for (const [width, height] of [[320, 640], [360, 740], [390, 844]] as const) {
    test(`the bot list keeps every row within reach and Add in view at 150 and 200% text on a ${String(width)} px phone`, async ({ page }) => {
        await open(page, `/play/tournament?bots=hextide%2CPistol1%2Cdevbot-a&games=2&clock=t10&opening=5`, width);
        await page.setViewportSize({ width, height });
        const devtools = await page.context().newCDPSession(page);
        for (const size of [24, 32]) {
            await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
            await page.getByRole(`button`, { name: `Add bots`, exact: true }).click();
            const dialog = page.locator(`dialog.rr-picker[open]`);
            const last = dialog.locator(`.rr-pick:not([aria-disabled='true'])`).last();
            const name = (await last.getAttribute(`data-bot`)) ?? ``;
            await last.click();
            await expect(last).toHaveAttribute(`aria-pressed`, `true`);
            const add = dialog.getByRole(`button`, { name: `Add 1 bot` });
            await expect(add).toBeInViewport({ ratio: 1 });
            await add.click();
            await expect(dialog).toHaveCount(0);
            await page.getByRole(`button`, { name: `Remove ${name}` }).click();
        }
    });
}
