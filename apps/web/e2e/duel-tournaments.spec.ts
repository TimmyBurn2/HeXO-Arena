import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Me, TournamentDetail } from '@hexo-arena/contract';
import { looks, pickBots, wear } from './matrix';
import { anaMe, brunoMe, duelBots, duelGameRows, duelGameSnapshots, games as gameFixtures, keptNames, longTest, roundRobins, serve, tournaments, world, type World } from './mock-api';

const ownerMe: Me = { kind: `user`, name: `devowner-b`, rating: 1500, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };

// ana's bots and everyone else's, the weekly waiting, and the duels and round robins people set up.
const events = (overrides: Partial<World> = {}) =>
    world({ me: anaMe, bots: duelBots, tournaments: [...structuredClone(tournaments().filter((entry) => entry.status !== `running`)), ...structuredClone(roundRobins())], live: [], ...overrides });

async function open(page: Page, path: string, width: number, state: World = events()): Promise<void> {
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

function fixture(id: string): TournamentDetail {
    const found = roundRobins().find((detail) => detail.id === id);
    if (found === undefined) throw new Error(`no fixture ${id}`);
    return found;
}

const picker = (page: Page) => page.locator(`dialog.duel-picker[open]`);
const row = (page: Page, bot: string) => picker(page).getByRole(`button`, { name: new RegExp(`^${bot}\\b`, `u`) });
const started = (page: Page) => page.waitForRequest((request) => new URL(request.url()).pathname === `/api/tournaments` && request.method() === `POST`);

async function addOnHome(page: Page, slot: `First` | `Second`, bot: string): Promise<void> {
    await page.getByRole(`button`, { name: `Add a bot, ${slot} bot` }).click();
    await row(page, bot).dblclick();
    await expect(picker(page)).toHaveCount(0);
}

for (const width of [1280, 390]) {
    test(`two bots picked on Play's Tournament place set a duel up, its games one after another, and open its page, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/play/tournament`, width);
        await expect(page.getByRole(`heading`, { name: `New duel` })).toBeVisible();
        await pickBots(page, [`devbot-a`, `devbot-c`]);
        await expect(page.getByText(`2 bots; a third makes a round robin`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Add bots`, exact: true })).toBeVisible();
        await page.getByRole(`radiogroup`, { name: `Games` }).getByRole(`radio`, { name: `10` }).check({ force: true });
        await expect(page.getByText(`5 openings, each played twice with sides swapped.`)).toBeVisible();
        await expect(page.getByText(/^10 games, one at a time\. You can stop the duel/u)).toBeVisible();
        await noSidewaysScroll(page);
        await page.getByRole(`button`, { name: `Start duel` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
        await expect(page.getByRole(`heading`, { name: `devbot-a vs devbot-c`, level: 1 })).toBeAttached();
        await expect(page.getByText(`Game 1 of 10 is live.`)).toBeVisible();
        await expect(page.locator(`.duel-kicker`)).toContainText(`Duel`);
        await expect(page.getByRole(`heading`, { name: `Opening 5` })).toHaveCount(0);
        await noSidewaysScroll(page);
        await page.goBack();
        await expect(page).toHaveURL(/\/play\/tournament\?bots=devbot-a%2Cdevbot-c&games=10&clock=t10&opening=5$/u);
    });

    test(`a duel's page faces its bots across the score and groups its games by opening, and its creator stops it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunoduel001`, width, events({ me: brunoMe }));
        await expect(page.getByText(`Game 7 of 10 is live; devbot-b leads 4-2.`)).toBeVisible();
        await expect(page.getByRole(`img`, { name: `4 to 2, game 7 of 10` })).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Opening 1` })).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Game 7, live` })).toBeVisible();
        await expect(page.getByText(`Drawn when game 7 started; game 8 replays it with sides swapped.`)).toBeVisible();
        await noSidewaysScroll(page);
        await page.getByRole(`button`, { name: `Stop duel` }).focus();
        await page.keyboard.press(`Enter`);
        await expect(page.getByText(`Stop the duel? No further game starts; the live game plays on, and the score stands as it is.`)).toBeVisible();
        await expect(page.getByRole(`button`, { name: `Keep playing` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await expect(page.getByRole(`button`, { name: `Stop duel` })).toBeFocused();
        await page.keyboard.press(`Enter`);
        await page.getByRole(`button`, { name: `Stop; no further game starts` }).click();
        await expect(page.getByText(/^You stopped the duel after game 6; devbot-b leads 4-2\.$/u)).toBeVisible();
        await expect(page.locator(`.duel-actions`).getByRole(`link`, { name: `These games in Games` })).toBeFocused();
        await expect(page.getByRole(`heading`, { name: `Game 7, live` })).toBeVisible();
    });

    test(`a bot's owner withdraws it from a duel, which ends it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunoduel001`, width, events({ me: ownerMe }));
        await expect(page.getByRole(`button`, { name: `Stop duel` })).toHaveCount(0);
        await page.getByRole(`button`, { name: `Withdraw devbot-b` }).click();
        await expect(page.getByText(`Withdraw devbot-b? The duel ends: its live game plays on and counts, and no further game starts.`)).toBeVisible();
        await page.getByRole(`button`, { name: `Withdraw; the duel ends` }).click();
        await expect(page.getByText(`Cut short at 4-2: devbot-b's owner withdrew it.`)).toBeVisible();
        await expect(page.getByRole(`img`, { name: `4 to 2, cut short` })).toBeVisible();
    });

    test(`a duel cut short marks its no-shows and the games never played, and lists as a duel's row under Games, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_dmitricut001`, width);
        await expect(page.getByText(`Cut short at 3-1: cinder missed two openings in a row.`)).toBeVisible();
        await expect(page.getByText(`No-show: cinder did not come; quietlake scores`)).toHaveCount(2);
        await expect(page.getByText(`Not played`)).toHaveCount(2);
        await page.goto(`/games/tournaments`);
        const listed = page.locator(`a.duel-row`, { hasText: `quietlake` });
        await expect(listed).toContainText(`Cut short at 3-1: cinder missed two openings in a row`);
        await expect(listed.getByRole(`img`, { name: `quietlake and cinder, 3-1` })).toBeVisible();
        await noSidewaysScroll(page);
    });

    test(`Games > Tournaments frames duels and round robins alike, one link a row with its figure and one date form, and narrows to one bot, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/tournaments?list=tests`, width);
        const past = page.getByRole(`region`, { name: `Past` });
        const duel = past.locator(`a.duel-row[href="/tournaments/t_anaduel00001"]`);
        const field = past.locator(`a.duel-row[href="/tournaments/t_anatest00001"]`);
        for (const each of [duel, field]) {
            await expect(each).toBeVisible();
            await expect(each.locator(`a`)).toHaveCount(0);
            await expect(each.locator(`.duel-row-facts`)).toHaveText(/\d+ h ago$/u);
        }
        await expect(duel.locator(`.duel-figure`)).toBeVisible();
        await expect(field.locator(`.event-figure-main`)).toHaveText(`7 of 8`);
        await expect(field.locator(`.event-figure-sub`)).toHaveText(`hextide won`);
        const [duelBox, fieldBox] = await Promise.all([duel.boundingBox(), field.boundingBox()]);
        if (duelBox === null || fieldBox === null) throw new Error(`a row drew no box`);
        expect(Math.round(duelBox.width)).toBe(Math.round(fieldBox.width));
        const all = page.getByRole(`region`, { name: `Live` });
        await page.getByRole(`button`, { name: `All`, exact: true }).click();
        await expect(all.locator(`a.duel-row[href="/tournaments/t_brunoduel001"]`)).toContainText(`Game 7 of 10 live`);
        await expect(all.locator(`a.duel-row[href="/tournaments/t_brunorobin01"] .event-figure-sub`)).toHaveText(`hextide leads`);
        await page.goto(`/games/tournaments?bot=hextide`);
        await expect(page.locator(`.events-for`)).toContainText(`Tournaments of hextide`);
        await expect(page.locator(`a.duel-row[href="/tournaments/t_brunoduel001"]`)).toHaveCount(0);
        await expect(page.locator(`a.duel-row[href="/tournaments/t_brunorobin01"]`)).toBeVisible();
        const [lineBox, pillsBox] = await Promise.all([page.locator(`.events-for`).boundingBox(), page.getByRole(`group`, { name: `Which tournaments` }).boundingBox()]);
        if (lineBox === null || pillsBox === null) throw new Error(`the bot's line or the pills drew no box`);
        expect(Math.round(pillsBox.y - (lineBox.y + lineBox.height))).toBe(12);
        await page.getByRole(`button`, { name: `Tests` }).click();
        await expect(page).toHaveURL(/\/games\/tournaments\?bot=hextide&list=tests$/u);
        await expect(page.locator(`a.duel-row[href="/tournaments/t_anaduel00001"]`)).toBeVisible();
        await page.getByRole(`link`, { name: `Every bot` }).click();
        await expect(page).toHaveURL(/\/games\/tournaments\?list=tests$/u);
        await noSidewaysScroll(page);
    });

    test(`Games asks a signed-out reader on Yours to sign in once, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/games/tournaments?list=yours`, width, events({ me: null }));
        await expect(page.getByText(`Sign in to see the duels and round robins you set up and your bots' tournaments.`)).toBeVisible();
        await expect(page.getByRole(`heading`, { name: `Live` })).toHaveCount(0);
        await expect(page.getByRole(`heading`, { name: `Past` })).toHaveCount(0);
    });

    test(`a duel's page leads to its games under Games, narrowed to it, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_brunoduel001`, width, events({ finished: [...duelGameRows, ...keptNames] }));
        await page.getByRole(`link`, { name: `These games in Games` }).first().click();
        await expect(page).toHaveURL(/\/games\?event=tournament&tournament=t_brunoduel001$/u);
        await expect(page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` })).toBeVisible();
        await expect(page.locator(`.game-row`)).toHaveCount(1);
        await page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` }).click();
        await expect(page).toHaveURL(/\/games\?event=tournament$/u);
        await expect(page.getByRole(`button`, { name: `Remove in a tournament` })).toBeVisible();
    });

    test(`a duel's page offers its games over so far as one download, and none before the first is over, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/tournaments/t_anaduel00001`, width);
        const exported = page.getByRole(`link`, { name: `Export games` });
        await expect(exported).toHaveAttribute(`href`, `/api/tournaments/t_anaduel00001/export`);
        // The browser downloads past the page's routes, so the server's own tests read the archive.
        await expect(exported).toHaveAttribute(`download`, ``);
        await page.goto(`/play/tournament?bots=hextide%2Cdevbot-a`);
        await page.getByRole(`button`, { name: `Start duel` }).click();
        await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
        await expect(page.locator(`.duel-head`)).toBeVisible();
        await expect(page.getByRole(`link`, { name: `Export games` })).toHaveCount(0);
    });

    test(`Profile lists the reader's latest duels and round robins, and its link opens them under Games on Yours, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/profile`, width);
        const block = page.locator(`.your-duels`);
        await expect(block.getByRole(`heading`, { name: `Your tournaments` })).toBeVisible();
        await expect(block.locator(`a.duel-row`)).toHaveCount(3);
        await noSidewaysScroll(page);
        await block.getByRole(`link`, { name: `All yours` }).click();
        await expect(page).toHaveURL(/\/games\/tournaments\?list=yours$/u);
        await expect(page.getByRole(`button`, { name: `Yours` })).toHaveAttribute(`aria-pressed`, `true`);
    });

    test(`the drawer names a duel's game as a duel, links its page with the score, and says who set it up, at ${String(width)} px`, async ({ page }) => {
        await open(page, `/game/duel-game`, width, events({ games: { ...structuredClone(gameFixtures), ...structuredClone(duelGameSnapshots) } }));
        await page.locator(`svg polygon.cell`).first().waitFor();
        await page.keyboard.press(`m`);
        await page.locator(`#drawer-body:not([hidden])`).waitFor();
        await page.getByRole(`tab`, { name: `Game` }).click();
        const facts = page.locator(`.facts`);
        await expect(facts.locator(`dt`, { hasText: /^Duel$/u })).toHaveCount(1);
        await expect(facts.getByRole(`link`, { name: `Duel, game 7 of 10` })).toHaveAttribute(`href`, `/tournaments/t_brunoduel001`);
        await expect(facts).toContainText(`devbot-b leads 4-2`);
        await expect(facts).toContainText(`No; a duel bruno set up`);
    });
}

test('Home\'s duel starts through the bot list by pointer: a press picks a bot, Add adds it, a double press adds the bot pressed, and Start sets a duel of two up', async ({ page }) => {
    await open(page, `/`, 1280);
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
    await expect(page.locator(`.home-duel`).getByRole(`link`, { name: `Tournament`, exact: true })).toHaveAttribute(`href`, `/play/tournament`);
    const sent = started(page);
    await page.getByRole(`button`, { name: `Start duel` }).click();
    expect((await sent).postDataJSON()).toMatchObject({ bots: [{ name: `hextide` }, { name: `devbot-a` }], gamesPerPair: 2, openingPlies: 5 });
    await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
    await expect(page.getByRole(`heading`, { name: `hextide vs devbot-a`, level: 1 })).toBeAttached();
    await expect(page.getByRole(`navigation`, { name: `Main` }).first().getByRole(`link`, { name: `Games` })).toHaveAttribute(`aria-current`, `page`);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/u);
});

test('Home counts the live duels and leaves tests out, leading to every tournament', async ({ page }) => {
    const state = events();
    state.tournaments.push(longTest());
    await open(page, `/`, 1280, state);
    const block = page.locator(`.home-duel`);
    await expect(block.getByText(/^1 live; All tournaments$/u)).toBeVisible();
    await expect(block.getByRole(`link`, { name: `All tournaments` })).toHaveAttribute(`href`, `/games/tournaments`);
});

test('Home asks a signed-out reader to sign in before a duel', async ({ page }) => {
    await open(page, `/`, 1280, events({ me: null }));
    const block = page.locator(`.home-duel`);
    await addOnHome(page, `First`, `hextide`);
    await addOnHome(page, `Second`, `devbot-a`);
    await expect(block.getByText(`Sign in to set up a duel or round robin; anyone can watch one.`)).toBeVisible();
    await expect(block.getByRole(`button`, { name: `Start duel` })).toHaveCount(0);
});

test('on a phone a double press adds only the bot pressed, however the list moves under it', async ({ page }) => {
    for (const bot of [`devbot-a`, `quietlake`, `devbot-c`, `Pistol1`]) {
        await open(page, `/`, 390);
        await addOnHome(page, `First`, `hextide`);
        await page.getByRole(`button`, { name: `Add a bot, Second bot` }).click();
        await row(page, bot).scrollIntoViewIfNeeded();
        await row(page, bot).dblclick();
        await expect(picker(page)).toHaveCount(0);
        await expect(page.getByRole(`button`, { name: `Change ${bot}` })).toBeVisible();
    }
});

test('on a phone a double press adds the bot pressed though its pick grows the foot over its row, and one begun on the foot adds nothing', async ({ page }) => {
    // With Pistol1 first, the list opens on hextide, whose foot is shorter than devbot-a's with its strengths.
    await open(page, `/`, 390);
    await addOnHome(page, `First`, `Pistol1`);
    await page.getByRole(`button`, { name: `Add a bot, Second bot` }).click();
    const foot = picker(page).locator(`.pick-detail`);
    await row(page, `devbot-a`).scrollIntoViewIfNeeded();
    const box = await row(page, `devbot-a`).boundingBox();
    if (box === null) throw new Error(`devbot-a has no box`);
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(point.x, point.y);
    await expect(row(page, `devbot-a`)).toHaveAttribute(`aria-pressed`, `true`);
    expect(await foot.evaluate((element, at) => element.contains(document.elementFromPoint(at.x, at.y)), point)).toBe(true);
    await page.mouse.down({ clickCount: 2 });
    await page.mouse.up({ clickCount: 2 });
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Change devbot-a` })).toBeVisible();

    await page.getByRole(`button`, { name: `Change devbot-a` }).click();
    await row(page, `devbot-c`).click();
    await expect(row(page, `devbot-c`)).toHaveAttribute(`aria-pressed`, `true`);
    await foot.locator(`.pick-detail-name`).dblclick();
    await page.keyboard.press(`Escape`);
    await expect(picker(page)).toHaveCount(0);
    await expect(page.getByRole(`button`, { name: `Change devbot-a` })).toBeVisible();
});

// Text at 150 and 200% fills a phone's sheet with the head and the foot; the rows still scroll into reach and Add stays in view.
for (const [width, height] of [[320, 640], [360, 740], [390, 844]] as const) {
    test(`Home's bot list keeps every row within reach and Add in view at 150 and 200% text on a ${String(width)} px phone`, async ({ page }) => {
        const devtools = await page.context().newCDPSession(page);
        for (const size of [24, 32]) {
            await open(page, `/`, width);
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

test('Home\'s bot list takes the keyboard: its rows are one Tab stop, the arrows move the pick, Enter adds, and focus goes on to the next slot', async ({ page }) => {
    await open(page, `/`, 1280);
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
    await expect(page.getByRole(`button`, { name: `Remove hextide` })).toBeFocused();
    await expect(page.getByRole(`button`, { name: `Start test` })).toBeVisible();
});

test('a refusal on Home says why by its code, naming the bot the server names though the page read it late, its plate saying why once read again', async ({ page }) => {
    const state = events();
    await open(page, `/`, 1280, state);
    await addOnHome(page, `First`, `hextide`);
    await addOnHome(page, `Second`, `Pistol1`);
    await expect(page.getByRole(`button`, { name: `Start duel` })).toBeVisible();
    // Pistol1 meets its most duels and round robins after the page read the bots' states.
    state.botStates = duelBots.map((bot) => ({ name: bot.name, duelsByOthers: true, running: bot.name === `Pistol1` ? 2 : 0 }));
    state.tournamentStart = { status: 400, code: `bot_busy`, bot: `Pistol1` };
    await page.getByRole(`button`, { name: `Start duel` }).click();
    await expect(page.getByText(/^Pistol1 is busy: /u)).toBeVisible();
    await expect(page.getByText(`Pistol1: In 2 duels or round robins; try again after one ends`)).toBeVisible();
    await expect(page).toHaveURL(/\/$/u);
});

test('the day\'s cap names the next start once, in the reader\'s own clock', async ({ page }) => {
    await open(page, `/play/tournament?bots=hextide%2Cdevbot-a`, 1280, events({ tournamentStart: { status: 429, code: `daily_tournament_cap`, retryAfter: 3600 } }));
    await page.getByRole(`button`, { name: `Start duel` }).click();
    await expect(page.getByText(/^You set up 10 duels and round robins today; the next can start at \d{1,2}:\d{2}( [AP]M)? \(00:00 UTC\)\.$/u)).toBeVisible();
});

test('Duel again opens the setup on the same bots, strengths, games, clock, and opening', async ({ page }) => {
    const sharp = { id: `sharp`, label: `sharp` };
    const base = fixture(`t_dmitricut001`);
    const over: TournamentDetail = {
        ...base,
        id: `t_againduel012`,
        createdBy: `ana`,
        gamesPerPair: 6,
        openingPlies: 7,
        timeControl: { mode: `turn`, turnTimeMs: 25_000 },
        entries: base.entries.map((entry, index) => (index === 0 ? { ...entry, bot: `devbot-c`, ownerName: `devowner-c`, level: sharp, ratingAtStart: null } : { ...entry, bot: `devbot-a`, ownerName: `devowner-a` })),
    };
    const state = events();
    state.tournaments.push(over);
    await open(page, `/tournaments/${over.id}`, 1280, state);
    await page.getByRole(`link`, { name: `Duel again` }).click();
    await expect(page.getByRole(`button`, { name: `Remove devbot-c` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Remove devbot-a` })).toBeVisible();
    await expect(page.getByLabel(`Strength`).first()).toHaveValue(`sharp`);
    await expect(page.getByRole(`radiogroup`, { name: `Games` }).getByRole(`radio`, { name: `6`, exact: true })).toBeChecked();
    const sent = started(page);
    await page.getByRole(`button`, { name: `Start duel` }).click();
    expect((await sent).postDataJSON()).toMatchObject({
        bots: [{ name: `devbot-c`, level: `sharp` }, { name: `devbot-a` }],
        gamesPerPair: 6,
        openingPlies: 7,
        timeControl: { mode: `turn`, turnTimeMs: 25_000 },
    });
});

test('Run 10 more starts a test of two again for its creator, a refusal says why, and a visitor gets none', async ({ page }) => {
    await open(page, `/tournaments/t_anaduel00001`, 1280);
    const sent = started(page);
    await page.getByRole(`button`, { name: `Run 10 more` }).click();
    expect((await sent).postDataJSON()).toMatchObject({ bots: [{ name: `hextide` }, { name: `pebble` }], gamesPerPair: 10, openingPlies: 5, timeControl: { mode: `turn`, turnTimeMs: 10_000 } });
    await expect(page).toHaveURL(/\/tournaments\/t_newrobin0001$/u);
    await expect(page.getByText(`The estimate shows once a game is over.`)).toBeVisible();

    await open(page, `/tournaments/t_anaduel00001`, 1280, events({ tournamentStart: { status: 400, code: `tournament_busy` } }));
    await page.getByRole(`button`, { name: `Run 10 more` }).click();
    await expect(page.locator(`.rr-error`)).toHaveText(`You run 2 duels or round robins already; stop one or wait for one to end.`);

    await open(page, `/tournaments/t_anaduel00001`, 1280, events({ me: brunoMe }));
    await expect(page.locator(`.estimate`)).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Run 10 more` })).toHaveCount(0);
});

test('a two-bot test\'s estimate leaves out how far more games would narrow it, over or under way', async ({ page }) => {
    const state = events();
    state.tournaments.push(longTest());
    for (const id of [`t_anaduel00001`, `t_analongtest1`]) {
        await open(page, `/tournaments/${id}`, 1280, state);
        await expect(page.locator(`.estimate`)).toBeVisible();
        await expect(page.locator(`.estimate`)).not.toContainText(/would narrow/u);
    }
    await expect(page.locator(`.estimate`)).toContainText(`28 more games to go`);
});

test('a long test lists its first openings and the one under way, and shows every game on asking', async ({ page }) => {
    const state = events();
    state.tournaments.push(longTest());
    await open(page, `/tournaments/t_analongtest1`, 1280, state);
    await expect(page.getByText(/^Game 23 of 50 is live; cinder leads 12-9/u)).toBeVisible();
    const openings = page.locator(`#duel-games`).locator(`..`).locator(`..`).getByRole(`heading`, { level: 3 });
    await expect(openings).toHaveText([`Opening 1`, `Opening 2`, `Opening 3`, `Opening 12`, `Opening 13`]);
    await expect(page.getByText(`12 more openings to come`)).toBeVisible();
    await page.getByRole(`button`, { name: `show all games` }).click();
    await expect(openings).toHaveCount(25);
});

test('the scoreboards\' game links are large enough to press with the Points column at rest on a phone, and a long test\'s compact board links none', async ({ page }) => {
    const state = events({ me: brunoMe });
    state.tournaments.push(longTest());
    for (const [path, width] of [
        [`/tournaments/t_brunoduel001`, 390],
        [`/tournaments/t_anaduel00001`, 390],
        [`/tournaments/t_anaduel00001`, 1280],
        [`/tournaments/t_analongtest1`, 390],
    ] as const) {
        await open(page, path, width, state);
        const board = page.getByRole(`region`, { name: `Score`, exact: true });
        await board.waitFor();
        if (width === 390) await expect(board.locator(`.sb-points`).first()).toHaveCSS(`position`, `static`);
        const axe = await new AxeBuilder({ page }).withRules([`target-size`]).analyze();
        expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
    }
    const board = page.getByRole(`region`, { name: `Score`, exact: true });
    await expect(board.getByRole(`img`, { name: /^cinder as x .*: won$/u }).first()).toBeVisible();
    await expect(board.locator(`a[href^="/game/"]`)).toHaveCount(0);
    await expect(page.locator(`.duel-games a[href^="/game/"]`).first()).toBeVisible();
});

test('on a phone the tab bar paints over the duel\'s score as it scrolls under', async ({ page }) => {
    await open(page, `/tournaments/t_brunoduel001`, 390);
    const score = page.locator(`.duel-head .score-hex`);
    await score.waitFor();
    const top = await score.boundingBox();
    if (top === null) throw new Error(`the score drew no box`);
    // A window ending just below the score's middle starts it under the bar, a short scroll from the bar's middle.
    await page.setViewportSize({ width: 390, height: Math.round(top.y + top.height / 2) + 10 });
    const bar = page.getByRole(`navigation`, { name: `Main` }).last();
    const [barBox, scoreBox] = await Promise.all([bar.boundingBox(), score.boundingBox()]);
    if (barBox === null || scoreBox === null) throw new Error(`the tab bar or the score drew no box`);
    await page.evaluate((by) => {
        window.scrollBy(0, by);
    }, scoreBox.y + scoreBox.height / 2 - (barBox.y + barBox.height / 2));
    const at = { x: scoreBox.x + scoreBox.width / 2, y: barBox.y + barBox.height / 2 };
    const moved = await score.boundingBox();
    if (moved === null) throw new Error(`the score drew no box`);
    expect(moved.y < at.y && at.y < moved.y + moved.height).toBe(true);
    expect(await score.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), at)).toBe(false);
    expect(await bar.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), at)).toBe(true);
});

test('counts out of reach look disabled: no fill, a not-allowed pointer, and no change under it', async ({ page }) => {
    await open(page, `/play/tournament`, 1280);
    await pickBots(page, [`hextide`, `cinder`, `pebble`]);
    const counts = page.getByRole(`radiogroup`, { name: `Games per pair` });
    const out = counts.locator(`label`, { has: page.locator(`input:disabled`) }).last();
    await expect(out).toHaveCSS(`background-color`, `rgba(0, 0, 0, 0)`);
    await expect(out).toHaveCSS(`cursor`, `not-allowed`);
    const before = await out.evaluate((element) => getComputedStyle(element).boxShadow);
    await out.hover({ force: true });
    await expect(out).toHaveCSS(`background-color`, `rgba(0, 0, 0, 0)`);
    expect(await out.evaluate((element) => getComputedStyle(element).boxShadow)).toBe(before);
});

test('Start a duel on a bot page opens the setup on that bot, and stands disabled with the bot list\'s reason where it cannot be added', async ({ page }) => {
    const states = duelBots.map((bot) => ({ name: bot.name, duelsByOthers: bot.name !== `quietlake`, running: 0 }));
    await open(page, `/bots/quietlake`, 1280, events({ botStates: states }));
    await expect(page.getByRole(`button`, { name: `Start a duel` })).toBeDisabled();
    await expect(page.getByRole(`button`, { name: `Start a duel` })).toHaveAccessibleDescription(`Duels by others are off`);
    await expect(page.getByRole(`link`, { name: `Play quietlake` })).toBeVisible();
    const axe = await new AxeBuilder({ page }).withRules([`dlitem`, `definition-list`]).analyze();
    expect(axe.violations.flatMap((violation) => violation.nodes.map((node) => node.target))).toEqual([]);

    await open(page, `/bots/devbot-a`, 1280, events({ botStates: states }));
    await expect(page.getByRole(`link`, { name: `Start a duel` })).toHaveAttribute(`href`, `/play/tournament?bots=devbot-a`);
});

test('a bot page shows one Tournaments block of its duels and round robins, a duel by its pair and score, leading to them all under Games', async ({ page }) => {
    await open(page, `/bots/devbot-b`, 1280);
    await expect(page.getByRole(`heading`, { name: `Tournaments`, exact: true })).toHaveCount(1);
    const block = page.locator(`section`, { has: page.getByRole(`heading`, { name: `Tournaments`, exact: true }) });
    const duel = block.locator(`a.place-row[href="/tournaments/t_brunoduel001"]`);
    await expect(duel).toContainText(`devbot-b`);
    await expect(duel).toContainText(`devbot-c`);
    await expect(duel).toContainText(`Game 7 of 10 live`);
    await expect(duel).not.toContainText(/round \d/iu);
    await expect(duel.locator(`a`)).toHaveCount(0);
    await expect(block.getByRole(`link`, { name: `All tournaments` })).toHaveAttribute(`href`, `/games/tournaments?bot=devbot-b`);
    await expect(page.getByRole(`link`, { name: `All duels` })).toHaveCount(0);
});

test('Play\'s places are Play a bot and Tournament, and Games\' are Finished, Live, and Tournaments', async ({ page }) => {
    await open(page, `/play`, 1280);
    await expect(page.getByRole(`navigation`, { name: `Play`, exact: true }).getByRole(`link`)).toHaveText([`Play a bot`, `Tournament`]);
    await expect(page.getByRole(`navigation`, { name: `Play`, exact: true }).getByRole(`link`, { name: `Play a bot` })).toHaveAttribute(`aria-current`, `page`);
    await page.goto(`/games`);
    await expect(page.getByRole(`navigation`, { name: `Games`, exact: true }).getByRole(`link`)).toHaveText([`Finished`, `Live`, `Tournaments`]);
    await page.goto(`/games/tournaments`);
    await expect(page.getByRole(`navigation`, { name: `Games`, exact: true }).getByRole(`link`, { name: `Tournaments` })).toHaveAttribute(`aria-current`, `page`);
});

test('an old link to a duel lands on its tournament page, Back skipping the old address', async ({ page }) => {
    const state = events();
    state.tournaments.push({ ...fixture(`t_brunoduel001`), id: `d_devbotbclive` });
    await open(page, `/`, 1280, state);
    for (const old of [`/play/duels/d_devbotbclive`, `/duels/d_devbotbclive`]) {
        await page.evaluate((path) => {
            window.history.pushState(null, ``, path);
            window.dispatchEvent(new PopStateEvent(`popstate`));
        }, old);
        await expect(page).toHaveURL(/\/tournaments\/d_devbotbclive$/u);
        await expect(page.getByRole(`heading`, { name: `devbot-b vs devbot-c`, level: 1 })).toBeAttached();
        await page.goBack();
        await expect(page).toHaveURL(/\/$/u);
    }
});

test('an old duel setup link opens the tournament setup on its bots, and an old duel list opens Games > Tournaments on its query', async ({ page }) => {
    await open(page, `/play/duels?first=hextide&second=devbot-a&games=6`, 1280);
    await expect(page).toHaveURL(/\/play\/tournament\?bots=hextide%2Cdevbot-a&games=6$/u);
    await expect(page.getByRole(`button`, { name: `Remove hextide` })).toBeVisible();
    await expect(page.getByRole(`button`, { name: `Remove devbot-a` })).toBeVisible();
    await page.goto(`/games/duels?list=tests&bot=hextide`);
    await expect(page).toHaveURL(/\/games\/tournaments\?list=tests&bot=hextide$/u);
    await expect(page.locator(`.events-for`)).toContainText(`Tournaments of hextide`);
    await expect(page.getByRole(`button`, { name: `Tests` })).toHaveAttribute(`aria-pressed`, `true`);
});

test('an old Games address naming a duel reads as the tournament it became', async ({ page }) => {
    const state = events({ finished: [...duelGameRows.map((game) => (game.tournament?.id === `t_brunoduel001` ? { ...game, tournament: { ...game.tournament, id: `d_devbotbclive` } } : game)), ...keptNames] });
    state.tournaments.push({ ...fixture(`t_brunoduel001`), id: `d_devbotbclive` });
    const asked = page.waitForRequest((request) => new URL(request.url()).pathname === `/api/games/finished`);
    await open(page, `/games?event=duel&duel=d_devbotbclive`, 1280, state);
    const query = new URL((await asked).url()).searchParams;
    expect([query.get(`event`), query.get(`tournament`), query.get(`duel`)]).toEqual([`tournament`, `d_devbotbclive`, null]);
    await expect(page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` })).toBeVisible();
    await expect(page.locator(`.game-row`)).toHaveCount(1);
});

test('Games shows a duel\'s games with their caption, and a test\'s only while Show tests is on', async ({ page }) => {
    await open(page, `/games`, 1280, events({ finished: [...duelGameRows, ...keptNames] }));
    await expect(page.getByRole(`link`, { name: `Duel, game 3 of 10` })).toHaveAttribute(`href`, `/tournaments/t_brunoduel001`);
    await expect(page.getByRole(`link`, { name: `Test, game 4 of 10` })).toHaveCount(0);
    await page.getByRole(`switch`, { name: `Show tests` }).check();
    await expect(page.getByRole(`link`, { name: `Test, game 4 of 10` })).toBeVisible();
    await page.getByRole(`switch`, { name: `Show tests` }).uncheck();
    await expect(page.getByRole(`link`, { name: `Test, game 4 of 10` })).toHaveCount(0);
});

test('Profile leaves the tournaments block out for a reader with none', async ({ page }) => {
    await open(page, `/profile`, 1280, world());
    await expect(page.getByRole(`heading`, { name: `Your bots` })).toBeVisible();
    await expect(page.locator(`.rating-chart-plot`)).toBeVisible();
    await expect(page.locator(`.your-duels`)).toHaveCount(0);
});
