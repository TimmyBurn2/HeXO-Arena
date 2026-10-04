import { expect, test, type Page } from '@playwright/test';
import type { Me } from '@hexo-arena/contract';
import { looks, wear } from './matrix';
import { analyzerBots, bots, duelBots, duelFixtures, duelGameRows, heldBots, keptNames, liveGames, longReadings, playBots, rivalry, roundRobins, serve, signup, tournamentGameRows, tournaments, world, type World } from './mock-api';

const visitors: readonly { name: string; me: Me }[] = [
    { name: `signed-out`, me: null },
    { name: `signed-in`, me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } },
    { name: `long-named`, me: { kind: `user`, name: `sealbot-owner-with-a-long-name`, rating: 1503, provisional: false, discord: { username: `owner.of.sealbot.and.two.more.xy`, displayName: `The Owner Of Sealbot And Two Mor` }, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } },
    { name: `guest`, me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } },
];

// Every framed screen;
// the first sign-in's page shows its form to someone signed out,
// and hands anyone else on to Profile.
// Play runs on its roster, once more on a bot whose clock note sits beside Custom clock.
// A screen that needs a signed-in visitor runs for them alone, its `then` taking it to the state checked.
const screens: readonly { name: string; path: string; world?: Partial<World>; then?: (page: Page) => Promise<void> }[] = [
    { name: `the root`, path: `/` },
    { name: `play`, path: `/play`, world: { bots: playBots } },
    { name: `play with a limited bot`, path: `/play?bot=quietlake`, world: { bots: playBots } },
    { name: `bot duel`, path: `/play/duels?first=Pistol1`, world: { bots: duelBots, duels: Object.values(duelFixtures).filter((duel) => duel.id !== duelFixtures.testLive.id) } },
    {
        name: `a new test with its picker`,
        path: `/play/duels?first=pebble`,
        world: { bots: duelBots.map((bot) => ({ ...bot, ownerName: bot.ownerName === `ana` ? `quinn` : bot.ownerName })) },
        then: async (page) => {
            await page.getByRole(`button`, { name: `Add a bot, Second bot` }).click();
            await page.locator(`dialog.duel-picker[open] .pick-detail`).waitFor();
        },
    },
    { name: `a duel`, path: `/duels/${duelFixtures.live.id}`, world: { bots: duelBots, duels: [duelFixtures.live] } },
    { name: `a test`, path: `/duels/${duelFixtures.test.id}`, world: { bots: duelBots, duels: [duelFixtures.test] } },
    { name: `a duel over, its games to export`, path: `/duels/${duelFixtures.rated.id}`, world: { bots: duelBots, duels: [duelFixtures.rated] } },
    { name: `the duels under Games`, path: `/games/duels`, world: { bots: duelBots, duels: Object.values(duelFixtures), live: [...duelFixtures.live.live, ...duelFixtures.testLive.live] } },
    { name: `the tournament place under Play`, path: `/play/tournament`, world: { tournaments } },
    {
        name: `games narrowed to one duel, its pick open`,
        path: `/games?event=duel&duel=${duelFixtures.live.id}`,
        world: { bots: duelBots, duels: Object.values(duelFixtures), finished: [...duelGameRows, ...keptNames] },
        then: async (page) => {
            await page.getByRole(`button`, { name: /^Filters/u }).click();
            await page.locator(`#games-duel`).waitFor();
        },
    },
    { name: `games narrowed to one round of a tournament`, path: `/games?event=tournament&tournament=t_autumnrobin1&round=2`, world: { tournaments, finished: [...tournamentGameRows, ...keptNames] } },
    { name: `games`, path: `/games` },
    { name: `games of duels and tournaments`, path: `/games`, world: { finished: [...tournamentGameRows, ...duelGameRows, ...keptNames] } },
    { name: `a head-to-head`, path: `/games?player=hextide&vs=quietlake`, world: { finished: rivalry(30) } },
    { name: `live games`, path: `/games/live` },
    { name: `the analysis board`, path: `/analysis` },
    { name: `a game on the analysis board`, path: `/analysis?game=long-finished&turn=12` },
    { name: `a game read whole on the analysis board`, path: `/analysis?game=long-finished&turn=17`, world: { analyses: { 'long-finished': { analyses: [longReadings.kestrel, longReadings.driftwood, ...longReadings.own], optedOut: false, independentOnline: false } } } },
    {
        name: `a game read only by a player's analyzer on the analysis board`,
        path: `/analysis?game=long-finished&turn=22`,
        world: { analyses: { 'long-finished': { analyses: [{ ...longReadings.kestrel, involved: true }, ...longReadings.own], optedOut: false, independentOnline: true } } },
    },
    {
        name: `an analyzer's lines on the analysis board`,
        path: `/analysis?game=long-finished&turn=12`,
        then: async (page) => {
            await page.getByRole(`switch`, { name: `Analyze` }).check();
            await page.getByRole(`button`, { name: `Lines B, C` }).click();
            await page.locator(`button.an-line`).nth(2).waitFor();
        },
    },
    { name: `the ladder`, path: `/ladder` },
    {
        name: `a round robin set up on Play`,
        path: `/play/tournament?bots=hextide%2Ccinder%2CPistol1%2Cdevbot-b%2Cquietlake`,
        world: { bots: duelBots.map((bot) => ({ ...bot, ownerName: bot.ownerName === `ana` ? `quinn` : bot.ownerName })), tournaments: tournaments.filter((entry) => entry.status !== `running`) },
    },
    {
        name: `a round robin's bot list`,
        path: `/play/tournament?bots=hextide`,
        world: { bots: duelBots.map((bot) => ({ ...bot, ownerName: bot.ownerName === `ana` ? `quinn` : bot.ownerName })), tournaments: tournaments.filter((entry) => entry.status !== `running`) },
        then: async (page) => {
            await page.getByRole(`button`, { name: `Add bots to the round robin` }).click();
            await page.locator(`dialog.rr-picker[open] .rr-pick`).first().waitFor();
        },
    },
    { name: `the round robins under Games`, path: `/games/tournaments`, world: { tournaments: [...tournaments, ...roundRobins] } },
    { name: `a live round robin`, path: `/tournaments/t_brunorobin01`, world: { tournaments: roundRobins } },
    { name: `a test of several bots`, path: `/tournaments/t_anatest00001`, world: { tournaments: roundRobins } },
    { name: `a round robin over`, path: `/tournaments/t_brunorobin02`, world: { tournaments: roundRobins } },
    { name: `tournaments`, path: `/games/tournaments`, world: { tournaments } },
    { name: `a running tournament`, path: `/tournaments/t_autumnrobin1`, world: { tournaments } },
    { name: `a waiting tournament`, path: `/tournaments/t_wintercup202` },
    { name: `bots`, path: `/bots` },
    { name: `a bot page`, path: `/bots/sealbot` },
    { name: `a bot page with its tournaments`, path: `/bots/hextide`, world: { tournaments } },
    { name: `an analyzer's page`, path: `/bots/kestrel`, world: { bots: [...bots, ...analyzerBots] } },
    { name: `build a bot`, path: `/connect` },
    { name: `profile`, path: `/profile` },
    { name: `profile with duels and tests`, path: `/profile`, world: { bots: duelBots, duels: [{ ...duelFixtures.rated, startedBy: `quinn` }, { ...duelFixtures.live, startedBy: `quinn` }] } },
    {
        name: `profile at the bot cap, or with no bots for the long name`,
        path: `/profile`,
        world: { bots: [...bots.filter((bot) => bot.ownerName !== `quinn`), ...heldBots] },
        then: async (page) => {
            await page.locator(`.bot-rows-foot`).waitFor();
        },
    },
    { name: `a player page`, path: `/players/ana` },
    { name: `credits`, path: `/credits` },
    { name: `the report form`, path: `/report?subject=%2Fbots%2Fsealbot` },
    { name: `the first sign-in`, path: `/welcome` },
    { name: `the legal notice`, path: `/legal/imprint` },
    { name: `privacy`, path: `/legal/privacy` },
    { name: `terms`, path: `/legal/terms` },
    { name: `a missing page`, path: `/nowhere` },
    { name: `a missing game`, path: `/game/nope` },
    { name: `a missing tournament`, path: `/tournaments/t_nosuchthing1` },
];

// Text at 100, 150, and 200% of the default size, as a reader sets it in the browser;
// every rem, breakpoints included, scales with it.
const sizes = [16, 24, 32];
const widths = [320, 360, 390, 414, 480, 540, 600, 656, 700, 768, 820, 900, 1024, 1280];

// Whatever breaks the layout at the width the page stands at, as sentences.
async function faults(page: Page, width: number, longName: boolean): Promise<string[]> {
    return page.evaluate(
        ({ width, longName }) => {
            const found: string[] = [];
            const shown = (element: Element | null): element is Element => element !== null && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== `hidden`;
            const lines = (element: Element) => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
            };
            const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
            if (overflow > 0) found.push(`the page scrolls ${String(overflow)} px sideways`);
            const header = document.querySelector(`header.topbar`);
            for (const element of [...(header?.querySelectorAll(`.brand, .nav-link, .settings-gear, .identity, a.discord-button`) ?? [])].filter(shown)) {
                const box = element.getBoundingClientRect();
                const name = element.classList[0] ?? `?`;
                if (box.left < 0 || box.right > width + 0.5) found.push(`the bar's ${name} runs past the window`);
            }
            const brand = header?.querySelector(`.brand`);
            const words = brand === undefined || brand === null ? undefined : [...brand.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
            if (words !== undefined) {
                const range = document.createRange();
                range.selectNodeContents(words);
                if (new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size !== 1) found.push(`the wordmark breaks`);
            }
            for (const link of [...document.querySelectorAll(`.nav-links .nav-link`)].filter(shown)) {
                if (lines(link) !== 1) found.push(`the ${link.textContent} label breaks`);
            }
            const label = header?.querySelector(`.identity-label`);
            if (!longName && label !== null && label !== undefined && label.getBoundingClientRect().width > 1 && label.scrollWidth > label.clientWidth) found.push(`the name is cut`);
            // Each tab's label stays inside its tab, on one line, and apart from the next label,
            // so the labels never read as one word.
            // Tabs that wrap to a second row stand apart by the row.
            let before: number | null = null;
            let row: number | null = null;
            for (const tab of [...document.querySelectorAll(`nav.tabbar .tab-link`)].filter(shown)) {
                const box = tab.getBoundingClientRect();
                if (row !== null && Math.round(box.top) !== row) before = null;
                row = Math.round(box.top);
                const range = document.createRange();
                range.selectNodeContents(tab);
                const text = range.getBoundingClientRect();
                if (box.right > width + 0.5 || text.left < box.left - 0.5 || text.right > box.right + 0.5) found.push(`the ${tab.textContent} tab runs past its place`);
                if (lines(tab) !== 1) found.push(`the ${tab.textContent} tab breaks`);
                if (before !== null && text.left - before < 8) found.push(`the ${tab.textContent} tab stands against the one before`);
                before = text.right;
            }
            // A clock preset's words stay inside its tile.
            for (const words of [...document.querySelectorAll(`.clock-tile .clock-value, .clock-tile .clock-kind`)].filter(shown)) {
                const tile = words.closest(`.clock-tile`);
                if (tile === null) continue;
                const range = document.createRange();
                range.selectNodeContents(words);
                const text = range.getBoundingClientRect();
                const box = tile.getBoundingClientRect();
                if (text.left < box.left - 0.5 || text.right > box.right + 0.5) found.push(`the ${words.textContent} preset runs past its tile`);
            }
            // A seat's swatch stands on the first line of its name.
            for (const seat of [...document.querySelectorAll(`.live-seat`)].filter(shown)) {
                const swatch = seat.querySelector(`.swatch`)?.getBoundingClientRect();
                const name = seat.querySelector(`.live-name`);
                if (swatch === undefined || name === null) continue;
                const range = document.createRange();
                range.selectNodeContents(name);
                const first = range.getClientRects()[0];
                const middle = swatch.top + swatch.height / 2;
                if (first !== undefined && (middle < first.top || middle > first.bottom)) found.push(`the swatch of ${name.textContent} stands apart from it`);
            }
            // A name breaks only between its words,
            // never inside a word short enough to fit a line;
            // a word near the name length limit may.
            for (const name of [...document.querySelectorAll(`.player-name, .live-name`)].filter(shown)) {
                const text = name.firstChild;
                if (text === null || text.nodeType !== Node.TEXT_NODE) continue;
                const words = text.textContent ?? ``;
                let top: number | null = null;
                for (let index = 0; index < words.length; index += 1) {
                    const range = document.createRange();
                    range.setStart(text, index);
                    range.setEnd(text, index + 1);
                    const at = Math.round(range.getBoundingClientRect().top);
                    const end = words.indexOf(` `, index);
                    const word = words.slice(words.lastIndexOf(` `, index - 1) + 1, end === -1 ? words.length : end);
                    if (top !== null && at !== top && words[index - 1] !== ` ` && words[index] !== ` ` && word.length <= 12) {
                        found.push(`the name ${words} breaks inside a word`);
                        break;
                    }
                    if (words[index] !== ` `) top = at;
                }
            }
            // A footer link keeps one line;
            // the legal notice, longer than a narrow row at large text,
            // breaks only after its slash.
            for (const link of [...document.querySelectorAll(`footer.site-footer a`)].filter(shown)) {
                const text = link.firstChild;
                if (lines(link) === 1 || text === null || text.nodeType !== Node.TEXT_NODE) continue;
                const words = text.textContent ?? ``;
                const slash = words.indexOf(`/ `);
                const part = (from: number, to: number) => {
                    const range = document.createRange();
                    range.setStart(text, from);
                    range.setEnd(text, to);
                    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
                };
                if (slash < 0 || part(0, slash + 1) !== 1 || part(slash + 2, words.length) !== 1) found.push(`the ${words} link breaks inside a phrase`);
            }
            return found.map((fault) => `${String(width)} px: ${fault}`);
        },
        { width, longName },
    );
}

for (const visitor of visitors) {
    for (const size of sizes) {
        for (const screen of screens.filter((entry) => entry.then === undefined || visitor.me?.kind === `user`)) {
            test(`at ${String((size / 16) * 100)}% text the ${visitor.name} bar and ${screen.name} stay inside the window from 320 to 1280 px`, async ({ page }) => {
                const look = looks[0];
                if (look === undefined) throw new Error(`no look registered`);
                await wear(page, look);
                await serve(page, world({ me: visitor.me, signup, live: liveGames, ...screen.world }));
                await page.setViewportSize({ width: widths[0] ?? 320, height: 800 });
                const devtools = await page.context().newCDPSession(page);
                await devtools.send(`Page.setFontSizes`, { fontSizes: { standard: size } });
                await page.goto(screen.path);
                await page.locator(`h1`).first().waitFor();
                if (visitor.me !== null) await page.locator(`header button.identity`).waitFor();
                await screen.then?.(page);
                await page.evaluate(async () => {
                    await document.fonts.ready;
                });
                const found: string[] = [];
                for (const width of widths) {
                    await page.setViewportSize({ width, height: 800 });
                    await page.evaluate(
                        () =>
                            new Promise<void>((resolve) => {
                                requestAnimationFrame(() => {
                                    requestAnimationFrame(() => {
                                        resolve();
                                    });
                                });
                            }),
                    );
                    found.push(...(await faults(page, width, visitor.name === `long-named`)));
                }
                expect(found).toEqual([]);
            });
        }
    }
}
