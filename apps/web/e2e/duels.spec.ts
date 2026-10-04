import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { looks, wear } from './matrix';
import { anaMe, brunoMe, duelBotOf, duelBots, duelFixture, duelFixtures, duelGameRows, keptNames, serve, world, type World } from './mock-api';

const allDuels = Object.values(duelFixtures).filter((duel) => duel.id !== duelFixtures.testLive.id);
// ana, who owns hextide, cinder, pebble, and lantern, among everyone's bots, the live duel and the past ones listed.
const dueling = (overrides: Partial<World> = {}) => world({ me: anaMe, bots: duelBots, duels: structuredClone(allDuels), live: [], ...overrides });

async function open(page: Page, path: string, state: World, width = 1280): Promise<void> {
    await page.setViewportSize({ width, height: 900 });
    const look = looks[0];
    if (look === undefined) throw new Error(`no look registered`);
    await wear(page, look);
    await serve(page, state);
    await page.goto(path);
}

const picker = (page: Page) => page.locator(`dialog.duel-picker[open]`);
const row = (page: Page, bot: string) => picker(page).getByRole(`button`, { name: new RegExp(`^${bot}\\b`, `u`) });
const started = (page: Page) => page.waitForRequest((request) => new URL(request.url()).pathname === `/api/duels` && request.method() === `POST`);

function listed(name: string) {
    const bot = duelBots.find((each) => each.name === name);
    if (bot === undefined) throw new Error(`no duel bot ${name}`);
    return bot;
}

test('a duel starts through the picker by pointer: a press picks a bot, Add adds it, and a double press adds the bot pressed', async ({ page }) => {
    await open(page, `/play/duels`, dueling());
    await page.getByRole(`button`, { name: `Add a bot, First bot` }).click();
    await expect(picker(page).getByRole(`heading`, { name: `Add the first bot` })).toBeVisible();
    await row(page, `hextide`).click();
    await expect(row(page, `hextide`)).toHaveAttribute(`aria-pressed`, `true`);
    await picker(page).getByRole(`button`, { name: `Add hextide` }).click();
    await expect(picker(page)).toHaveCount(0);
    await page.getByRole(`button`, { name: `Add a bot, Second bot` }).click();
    await row(page, `devbot-a`).dblclick();
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Change hextide` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Change devbot-a` })).toBeVisible();
    const sent = started(page);
    await page.getByRole(`button`, { name: `Start duel` }).click();
    expect((await sent).postDataJSON()).toMatchObject({ first: `hextide`, second: `devbot-a`, games: 2, rated: false });
    await expect(page).toHaveURL(/\/duels\/d_started/u);
    await expect(page.getByRole(`heading`, { name: `hextide vs devbot-a`, level: 1 })).toBeAttached();
    await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Games` })).toHaveAttribute(`aria-current`, `page`);
    await expect(page.locator(`.duel-kicker`).getByRole(`link`, { name: `Duels` })).toHaveAttribute(`href`, `/games/duels`);
    // Back finds the setup as it was left, Play lit again.
    await page.goBack();
    await expect(page.getByRole(`button`, { name: `Change hextide` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Change devbot-a` })).toBeVisible();
    await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Play` })).toHaveAttribute(`aria-current`, `page`);
});

test('on a phone a double press adds only the bot pressed, however the list moves under it', async ({ page }) => {
    for (const bot of [`devbot-a`, `quietlake`, `devbot-c`, `Pistol1`]) {
        await open(page, `/play/duels?first=hextide`, dueling(), 390);
        await page.getByRole(`button`, { name: `Add a bot, Second bot` }).click();
        await row(page, bot).scrollIntoViewIfNeeded();
        await row(page, bot).dblclick();
        await expect(picker(page)).toHaveCount(0);
        await expect(page.getByRole(`button`, { name: `Change ${bot}` })).toBeVisible();
    }
});

// Text at 150 and 200% fills a phone's sheet with the head and the foot; the rows still scroll into reach and Add stays in view.
for (const [width, height] of [[320, 640], [360, 740], [390, 844]] as const) {
    test(`the picker keeps every row within reach and Add in view at 150 and 200% text on a ${String(width)} px phone`, async ({ page }) => {
        const devtools = await page.context().newCDPSession(page);
        for (const size of [24, 32]) {
            await open(page, `/play/duels`, dueling(), width);
            await page.setViewportSize({ width, height });
            await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
            await page.getByRole(`button`, { name: `Add a bot, First bot` }).click();
            const last = picker(page).locator(`.pick:not([aria-disabled='true'])`).last();
            const name = (await last.getAttribute(`data-bot`)) ?? ``;
            await last.click();
            await expect(last).toHaveAttribute(`aria-pressed`, `true`);
            const add = picker(page).getByRole(`button`, { name: `Add ${name}` });
            await expect(add).toBeInViewport({ ratio: 1 });
            await add.click();
            await expect(picker(page)).toHaveCount(0);
            await expect(page.getByRole(`button`, { name: `Change ${name}` })).toBeAttached();
        }
    });
}

test('the picker takes the keyboard: its rows are one Tab stop, the arrows move the pick, Enter adds, and focus goes on to the next slot', async ({ page }) => {
    await open(page, `/play/duels`, dueling());
    await page.getByRole(`button`, { name: `Add a bot, First bot` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(picker(page).getByRole(`searchbox`)).toBeFocused();
    await page.keyboard.press(`ArrowDown`);
    await expect(row(page, `hextide`)).toBeFocused();
    await page.keyboard.press(`ArrowDown`);
    await expect(row(page, `cinder`)).toBeFocused();
    await expect(row(page, `cinder`)).toHaveAttribute(`aria-pressed`, `true`);
    await page.keyboard.press(`Tab`);
    await expect(picker(page).getByRole(`button`, { name: `Add cinder` })).toBeFocused();
    await page.keyboard.press(`Shift+Tab`);
    await expect(row(page, `cinder`)).toBeFocused();
    await page.keyboard.press(`Enter`);
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Add a bot, Second bot` })).toBeFocused();
    await page.keyboard.press(`Enter`);
    await expect(picker(page).getByRole(`searchbox`)).toBeFocused();
    await page.keyboard.press(`ArrowDown`);
    await expect(row(page, `hextide`)).toBeFocused();
    await page.keyboard.press(`Enter`);
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Change hextide` })).toBeFocused();
    await expect(page.getByRole(`heading`, { name: `New test` })).toBeVisible();
});

test('a refusal says why by its code, naming the bot and the cause the server found though the page read it late', async ({ page }) => {
    const state = dueling();
    await open(page, `/play/duels?first=hextide&second=Pistol1`, state);
    await expect(page.getByRole(`button`, { name: `Start duel` })).toBeVisible();
    // Pistol1 meets its most duels after the page read the duel states.
    state.duelStates = duelBots.map((bot) => ({ name: bot.name, duelsByOthers: true, dueling: bot.name === `Pistol1` ? [`devbot-a`, `devbot-b`] : [], roundRobins: 0 }));
    await page.getByRole(`button`, { name: `Start duel` }).click();
    await expect(page.getByText(`Pistol1 is in 2 duels or round robins already; try again after one ends.`)).toBeVisible();
    await expect(page).toHaveURL(/\/play\/duels\?/u);
});

test('the day\'s cap names the next start once, in the reader\'s own clock', async ({ page }) => {
    await open(page, `/play/duels?first=hextide&second=devbot-a`, dueling({ duelStart: { status: 429, code: `daily_duel_cap`, retryAfter: 3600 } }));
    await page.getByRole(`button`, { name: `Start duel` }).click();
    await expect(page.getByText(/^You started 10 duels and tests today; the next can start at \d{1,2}:\d{2}( [AP]M)?\.$/u)).toBeVisible();
});

test('Stop asks once, keeps focus on a button that is there, and leaves the live game playing', async ({ page }) => {
    await open(page, `/duels/${duelFixtures.live.id}`, dueling({ me: brunoMe }));
    await page.getByRole(`button`, { name: `Stop duel` }).focus();
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`button`, { name: `Keep playing` })).toBeFocused();
    await expect(page.getByRole(`button`, { name: `Stop`, exact: true })).toHaveAccessibleDescription(`No further game starts; the live one plays on.`);
    await page.keyboard.press(`Enter`);
    await expect(page.getByRole(`button`, { name: `Stop duel` })).toBeFocused();
    await page.keyboard.press(`Enter`);
    await page.getByRole(`button`, { name: `Stop`, exact: true }).click();
    await expect(page.getByText(`You stopped the duel after game 3; devbot-b 3, devbot-c 0.`)).toBeVisible();
    await expect(page.getByText(`Started by you.`, { exact: false })).toBeVisible();
    await expect(page.getByRole(`link`, { name: `Duel again` })).toBeFocused();
    await expect(page.getByRole(`heading`, { name: `Game 4, live` })).toBeVisible();
});

test('Duel again opens the setup on the same bots, strengths, games, clock, and opening', async ({ page }) => {
    const sharp = listed(`devbot-b`).levels?.list.find((level) => level.id === `sharp`);
    if (sharp === undefined) throw new Error(`devbot-b declares no sharp`);
    const over = duelFixture({
        id: `d_againduel012`,
        first: duelBotOf(listed(`devbot-b`), { level: { id: sharp.id, label: sharp.label }, ratingAtStart: null }),
        second: duelBotOf(listed(`devbot-a`)),
        kind: `duel`,
        startedBy: `ana`,
        games: 6,
        rated: false,
        timeControl: { mode: `turn`, turnTimeMs: 25_000 },
        openingPlies: 7,
        outcomes: [`first`, `second`, `first`, `first`, `second`, `first`],
        live: false,
        status: `finished`,
    });
    await open(page, `/duels/${over.id}`, dueling({ duels: [over] }));
    await page.getByRole(`link`, { name: `Duel again` }).click();
    await expect(page.getByRole(`button`, { name: `Change devbot-b` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Change devbot-a` })).toBeVisible();
    await expect(page.getByLabel(`Strength`).first()).toHaveValue(`sharp`);
    await expect(page.getByRole(`radio`, { name: `6`, exact: true })).toBeChecked();
    const sent = started(page);
    await page.getByRole(`button`, { name: `Start duel` }).click();
    expect((await sent).postDataJSON()).toMatchObject({
        first: `devbot-b`,
        second: `devbot-a`,
        games: 6,
        openingPlies: 7,
        timeControl: { mode: `turn`, turnTimeMs: 25_000 },
        levels: { first: `sharp` },
    });
});

test('Run 50 more starts the same test again for its owner, and a refusal says why', async ({ page }) => {
    await open(page, `/duels/${duelFixtures.test.id}`, dueling());
    const sent = started(page);
    await page.getByRole(`button`, { name: `Run 50 more` }).click();
    expect((await sent).postDataJSON()).toMatchObject({ first: `cinder`, second: `pebble`, games: 50, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 }, rated: false });
    await expect(page).toHaveURL(/\/duels\/d_started/u);
    await expect(page.getByText(`The estimate shows once a game is over.`)).toBeVisible();

    await open(page, `/duels/${duelFixtures.test.id}`, dueling({ duelStart: { status: 400, code: `duel_busy` } }));
    await page.getByRole(`button`, { name: `Run 50 more` }).click();
    await expect(page.getByRole(`alert`)).toHaveText(`You have 2 live duels and tests; stop one or wait for one to end.`);
});

test('a visitor gets no Run 50 more on another\'s test, which the server would refuse them', async ({ page }) => {
    await open(page, `/duels/${duelFixtures.test.id}`, dueling({ me: brunoMe }));
    await expect(page.getByRole(`heading`, { name: /^cinder scored 31 to 19/u })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Run 50 more` })).toHaveCount(0);
    const answer = await page.evaluate(async () => {
        const response = await fetch(`/api/duels`, {
            method: `POST`,
            headers: { 'content-type': `application/json` },
            body: JSON.stringify({ first: `cinder`, second: `pebble`, games: 50, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 } }),
        });
        return { status: response.status, body: (await response.json()) as unknown };
    });
    expect(answer).toEqual({ status: 400, body: { error: `refused`, code: `not_open` } });
});

test('a long test lists its first pairs and the one under way, names its games without a winner, and shows every game on asking', async ({ page }) => {
    await open(page, `/duels/${duelFixtures.testLive.id}`, dueling({ duels: [structuredClone(duelFixtures.testLive)] }));
    await expect(page.getByText(`Game 23 of 50 is live; cinder leads 12-9, with 1 game without a winner.`)).toBeVisible();
    await expect(page.getByRole(`heading`, { name: `So far cinder leads 12.5 to 9.5, after 22 of 50, with 1 game without a winner` })).toBeVisible();
    const pairs = page.getByRole(`region`, { name: `Games`, exact: true }).getByRole(`heading`, { level: 3 });
    await expect(pairs).toHaveText([`Pair 1`, `Pair 2`, `Pair 3`, `Pair 12`, `Pair 13`]);
    await expect(page.getByText(`12 more pairs to come`)).toBeVisible();
    await page.getByRole(`button`, { name: `show all games` }).click();
    await expect(pairs).toHaveCount(25);
});

test('the scoreboards\' game links are large enough to press, and a test\'s compact board links none', async ({ page }) => {
    for (const [path, width] of [
        [`/duels/${duelFixtures.live.id}`, 390],
        [`/duels/${duelFixtures.test.id}`, 1280],
        [`/duels/${duelFixtures.test.id}`, 390],
    ] as const) {
        await open(page, path, dueling({ me: brunoMe }), width);
        await page.getByRole(`region`, { name: `Score`, exact: true }).waitFor();
        const axe = await new AxeBuilder({ page }).withRules([`target-size`]).analyze();
        expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
    }
    await expect(page.getByRole(`region`, { name: `Score`, exact: true }).getByRole(`img`, { name: /^cinder as x .*: won$/u }).first()).toBeVisible();
    await expect(page.getByRole(`region`, { name: `Score`, exact: true }).locator(`a[href^="/game/"]`)).toHaveCount(0);
    await expect(page.getByRole(`region`, { name: `Games`, exact: true }).locator(`a[href^="/game/"]`).first()).toBeVisible();
});

test('Start a duel on a bot page stands disabled with the picker\'s reason where the bot cannot be added', async ({ page }) => {
    const states = duelBots.map((bot) => ({ name: bot.name, duelsByOthers: bot.name !== `quietlake`, dueling: [], roundRobins: 0 }));
    await open(page, `/bots/quietlake`, dueling({ duelStates: states }));
    await expect(page.getByRole(`button`, { name: `Start a duel` })).toBeDisabled();
    await expect(page.getByRole(`button`, { name: `Start a duel` })).toHaveAccessibleDescription(`Duels by others are off`);
    await expect(page.getByRole(`link`, { name: `Play quietlake` })).toBeVisible();

    const axe = await new AxeBuilder({ page }).withRules([`dlitem`, `definition-list`]).analyze();
    expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);

    await open(page, `/bots/devbot-a`, dueling({ duelStates: states }));
    await expect(page.getByRole(`link`, { name: `Start a duel` })).toHaveAttribute(`href`, `/play/duels?first=devbot-a`);
});

test('a bot page leads to its duels and to its tests under Games', async ({ page }) => {
    await open(page, `/bots/hextide`, dueling());
    await expect(page.getByRole(`link`, { name: `All duels` })).toHaveAttribute(`href`, `/games/duels?bot=hextide`);
    await expect(page.getByRole(`link`, { name: `All tests` })).toHaveAttribute(`href`, `/games/duels?bot=hextide&list=tests`);
});

test('Home counts the live duels and leaves tests out, leading to every duel and to the setup', async ({ page }) => {
    const running = [structuredClone(duelFixtures.live), structuredClone(duelFixtures.testLive), ...structuredClone(allDuels.filter((duel) => duel.status !== `running`))];
    await open(page, `/`, dueling({ duels: running }));
    await expect(page.getByText(/^1 live; All duels$/u)).toBeVisible();
    await expect(page.locator(`.home-duel`).getByRole(`link`, { name: `All duels` })).toHaveAttribute(`href`, `/games/duels`);
});

test('an old link to a duel or to the duel lists under Play lands on its new address, Back skipping the old one', async ({ page }) => {
    await open(page, `/`, dueling());
    await page.evaluate(() => {
        window.history.pushState(null, ``, `/play/duels/d_devbotbclive`);
        window.dispatchEvent(new PopStateEvent(`popstate`));
    });
    await expect(page).toHaveURL(/\/duels\/d_devbotbclive$/u);
    await expect(page.getByRole(`heading`, { name: `devbot-b vs devbot-c`, level: 1 })).toBeAttached();
    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
    await open(page, `/play/duels?bot=hextide&list=tests`, dueling());
    await expect(page).toHaveURL(/\/games\/duels\?bot=hextide&list=tests$/u);
    await expect(page.getByText(`Duels and tests of hextide`)).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Tests` })).toHaveAttribute(`aria-pressed`, `true`);
});

for (const width of [1280, 390]) {
    test(`Games lists the live duels with their live games and the past ones, filtered in the address, and a duel's page leads back, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/duels`, dueling({ live: structuredClone(duelFixtures.live.live) }), width);
        await expect(page.getByRole(`link`, { name: `Duels`, exact: true }).first()).toHaveAttribute(`aria-current`, `page`);
        const card = page.locator(`a.live-duel`);
        await expect(card).toHaveCount(1);
        await expect(card.locator(`.live-duel-board svg`)).toBeVisible();
        await expect(card.locator(`.live-duel-status`)).toHaveText(`Game 4 of 10 livedevbot-b leads 3-0`);
        await expect(page.getByRole(`region`, { name: `Past` }).locator(`.duel-row`)).toHaveCount(allDuels.length - 1);
        await page.getByRole(`button`, { name: `Yours` }).click();
        await expect(page).toHaveURL(/\/games\/duels\?list=yours$/u);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByRole(`button`, { name: `All`, exact: true }).click();
        await card.click();
        await expect(page).toHaveURL(/\/duels\/d_devbotbclive$/u);
        await page.locator(`.duel-kicker`).getByRole(`link`, { name: `Duels` }).click();
        await expect(page).toHaveURL(/\/games\/duels$/u);
    });

    test(`Games asks a signed-out reader on Yours to sign in once, and one bot's duels stand clear of the pills, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/duels?list=yours`, dueling({ me: null }), width);
        await expect(page.getByText(`Sign in to see your duels and tests.`)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Live` })).toHaveCount(0);
        await expect(page.getByRole(`heading`, { name: `Past` })).toHaveCount(0);
        await page.goto(`/games/duels?bot=hextide`);
        const line = page.locator(`.duels-for`);
        await expect(line).toContainText(`Duels and tests of hextide`);
        const [lineBox, pillsBox] = await Promise.all([line.boundingBox(), page.getByRole(`group`, { name: `Which duels` }).boundingBox()]);
        if (lineBox === null || pillsBox === null) throw new Error(`the bot's line or the pills drew no box`);
        expect(Math.round(pillsBox.y - (lineBox.y + lineBox.height))).toBe(12);
    });

    test(`a duel's page leads to its games under Games, narrowed to it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/duels/${duelFixtures.live.id}`, dueling({ finished: [...duelGameRows, ...keptNames] }), width);
        await page.getByRole(`link`, { name: `These games in Games` }).click();
        await expect(page).toHaveURL(new RegExp(`/games\\?event=duel&duel=${duelFixtures.live.id}$`, `u`));
        await expect(page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` })).toBeVisible();
        await expect(page.locator(`.game-row`)).toHaveCount(1);
        await page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` }).click();
        await expect(page).toHaveURL(/\/games\?event=duel$/u);
        await expect(page.getByRole(`button`, { name: `Remove in a duel` })).toBeVisible();
    });
}

test('Games shows a duel\'s games with their caption, and a test\'s only while Show tests is on', async ({ page }) => {
    await open(page, `/games`, dueling({ finished: [...duelGameRows, ...keptNames] }));
    await expect(page.getByRole(`link`, { name: `Duel, game 3 of 10` })).toBeVisible();
    await expect(page.getByRole(`link`, { name: `Test, game 22 of 50` })).toHaveCount(0);
    await page.getByRole(`switch`, { name: `Show tests` }).check();
    await expect(page.getByRole(`link`, { name: `Test, game 22 of 50` })).toBeVisible();
    await page.getByRole(`switch`, { name: `Show tests` }).uncheck();
    await expect(page.getByRole(`link`, { name: `Test, game 22 of 50` })).toHaveCount(0);
});

for (const width of [1280, 390]) {
    test(`a duel's page offers its games over so far as one download, and none before the first is over, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/duels/${duelFixtures.rated.id}`, dueling(), width);
        const exported = page.getByRole(`link`, { name: `Export games` });
        await expect(exported).toHaveAttribute(`href`, `/api/duels/${duelFixtures.rated.id}/export`);
        // The browser downloads past the page's routes, so the server's own tests read the archive.
        await expect(exported).toHaveAttribute(`download`, ``);
        const fresh = duelFixture({ id: `d_freshduel001`, first: duelBotOf(listed(`hextide`)), second: duelBotOf(listed(`devbot-a`)), kind: `duel`, startedBy: `ana`, games: 2, rated: false, outcomes: [`live`], live: true, status: `running` });
        await open(page, `/duels/${fresh.id}`, dueling({ duels: [fresh] }), width);
        await expect(page.locator(`.duel-head`)).toBeVisible();
        await expect(page.getByRole(`link`, { name: `Export games` })).toHaveCount(0);
    });

    test(`Profile lists the reader's latest duels and tests, and its link opens the duels under Games on Yours, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/profile`, dueling(), width);
        const block = page.locator(`.your-duels`);
        await expect(block.getByRole(`heading`, { name: `Your duels and tests` })).toBeVisible();
        await expect(block.locator(`.duel-row`)).toHaveCount(3);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await block.getByRole(`link`, { name: `All your duels and tests` }).click();
        await expect(page).toHaveURL(/\/games\/duels\?list=yours$/u);
        await expect(page.getByRole(`button`, { name: `Yours` })).toHaveAttribute(`aria-pressed`, `true`);
    });
}

test('Profile leaves the duels block out for a reader with no duel or test', async ({ page }) => {
    await open(page, `/profile`, world());
    await expect(page.getByRole(`heading`, { name: `Your bots` })).toBeVisible();
    await expect(page.locator(`.rating-chart-plot`)).toBeVisible();
    await expect(page.locator(`.your-duels`)).toHaveCount(0);
});
