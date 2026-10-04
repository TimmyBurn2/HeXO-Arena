import type { Page } from '@playwright/test';
import { themes } from '../src/theme/themes';
import { anaMe, analyzerBots, bots, brunoMe, duelBots, duelFixtures, duelGameRows, duelGameSnapshots, games as gameFixtures, heldBots, keptNames, leaderboard, liveGames, longReadings, playBots, rivalry, roundRobins, signup, tournamentGameRows, tournaments, world, type World } from './mock-api';

/** A named look the whole site can wear. */
export interface Look {
    name: string;
    storage: Record<string, string>;
}

export const looks: readonly Look[] = themes.map((theme) => ({
    name: theme.id,
    storage: { 'hexo-arena.theme.v1': theme.id },
}));

export interface Viewport {
    name: string;
    width: number;
    height: number;
}

export const viewports: readonly Viewport[] = [
    { name: `desktop`, width: 1440, height: 900 },
    { name: `tablet`, width: 768, height: 1024 },
    { name: `phone`, width: 390, height: 844 },
    { name: `narrow`, width: 360, height: 740 },
];

// An open top-bar panel is a popover or a sheet, so one width of each
// shows it.
const panelViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];

/**
 * One screen in one state: where to go, the world it sees, and the
 * element whose presence means the state has rendered.
 */
export interface Shot {
    name: string;
    path: string;
    world: World;
    ready: string;
    // Framed screens must never scroll sideways; the game stage owns the
    // viewport and scrolls its board by design.
    framed: boolean;
    after?: (page: Page) => Promise<void>;
    // Extra preferences this state needs before the app boots.
    storage?: Record<string, string>;
    // A board or the theme swatches are on screen, so every look is
    // captured; elsewhere a look changes only surface and text tokens,
    // which the contrast gate holds pair by pair and step by step, so the
    // default look stands for all.
    // A list names the widths the other looks take, the default look taking every one.
    board?: true | readonly Viewport[];
    // Widths other than the matrix's own.
    viewports?: readonly Viewport[];
    // A page read top to bottom is captured whole, so one shot shows every part.
    fullPage?: true;
}

const signedOut = world({ me: null });
const analysedLong = world({ analyses: { 'long-finished': { analyses: [longReadings.kestrel, longReadings.driftwood, ...longReadings.own], optedOut: false, independentOnline: false } } });
const playing = (overrides: Partial<World> = {}) => world({ bots: playBots, ...overrides });
// The top chip carries a level beside the clock, down to the narrowest phone.
const levelChipViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
    { name: `narrow`, width: 360, height: 740 },
    { name: `small`, width: 320, height: 640 },
];
const phones: readonly Viewport[] = [
    { name: `phone`, width: 390, height: 844 },
    { name: `narrow`, width: 360, height: 740 },
];

// A start the mock refuses, pressed, its line shown.
function refusedStart(name: string, status: number, code: string, path = `/play?bot=devbot-c`, retryAfter?: number): Shot {
    return {
        name,
        path,
        world: playing({ start: retryAfter === undefined ? { status, code } : { status, code, retryAfter } }),
        ready: `.play-setup`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Start game` }).click();
            await page.locator(`.start-lines p`).first().waitFor();
        },
    };
}
// Every name at its longest: a 30-character public name and 32-character
// Discord names.
const longNamed: World[`me`] = {
    kind: `user`,
    name: `sealbot-owner-with-a-long-name`,
    rating: 1503,
    provisional: false,
    discord: { username: `owner.of.sealbot.and.two.more.xy`, displayName: `The Owner Of Sealbot And Two Mor` },
    liveGames: [],
    analysisOptOut: false,
    analysisLeft: { positions: 300, games: 10 },
};
const welcoming = (overrides: Partial<World> = {}) => world({ me: null, signup, ...overrides });

async function typeName(page: Page, name: string): Promise<void> {
    await page.getByRole(`textbox`, { name: `Public name` }).fill(name);
}

async function createAccount(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Create account` }).click();
}
const guest = world({ me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } });
// Signed in, but not as sealbot's owner.
const visitingAna: World[`me`] = { kind: `user`, name: `ana`, rating: 1402, provisional: false, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } };
// The bot page's head for each kind of bot, as a laptop and a phone show it.
const botPageViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];

// The guide reads down one column, so a laptop and a phone show it.
const guideViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];

// Quinn, signed in by default, holding the named bots of `heldBots` beside everyone else's.
const holding = (names: readonly string[]) =>
    world({ bots: [...bots.filter((bot) => bot.ownerName !== `quinn`), ...heldBots.filter((bot) => names.includes(bot.name))] });

// The bot list at each width its rows change between.
const botListViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];

// The bot list whole: where the window or a phone's tab bar cuts it off,
// the page scrolls the list to the top.
async function showBots(page: Page): Promise<void> {
    const section = page.locator(`.your-bots`);
    await section.locator(`.bot-rows-foot`).waitFor();
    await section.evaluate((element) => {
        const bar = document.querySelector(`nav.tabbar`);
        const floor = bar === null || bar.getClientRects().length === 0 ? window.innerHeight : bar.getBoundingClientRect().top;
        if (element.getBoundingClientRect().bottom > floor) element.scrollIntoView({ block: `start` });
    });
}

async function openSettings(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Settings`, exact: true }).click();
    await page.locator(`dialog.settings[open]`).waitFor();
}

async function openIdentity(page: Page): Promise<void> {
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel[open]`).waitFor();
}

// The duel screens at a laptop's width and a phone's, as the duel mockups show them.
const duelViewports: readonly Viewport[] = [
    { name: `laptop`, width: 1280, height: 900 },
    { name: `phone`, width: 390, height: 844 },
];
const laptopOnly: readonly Viewport[] = [{ name: `laptop`, width: 1280, height: 900 }];
// The matrix's widths and a laptop's, for a screen the duel and tournament mockups show at 1280.
const withLaptop: readonly Viewport[] = [...laptopOnly, ...viewports];
const allDuels = Object.values(duelFixtures).filter((duel) => duel.id !== duelFixtures.testLive.id);
// ana's bots and everyone else's, the live duel and the past ones listed.
const dueling = (overrides: Partial<World> = {}) => world({ me: anaMe, bots: duelBots, duels: structuredClone(allDuels), live: [], ...overrides });

async function addBot(page: Page, slot: `first` | `second`, name: string): Promise<void> {
    await page.getByRole(`button`, { name: `Add a bot, ${slot === `first` ? `First` : `Second`} bot` }).click();
    const dialog = page.locator(`dialog.duel-picker[open]`);
    await dialog.waitFor();
    await dialog.getByRole(`button`, { name: new RegExp(`^${name}\\b`, `u`) }).dblclick();
    await dialog.waitFor({ state: `detached` });
}

/** Checks bots in the round robin's bot list and adds them, the list closing. */
export async function pickBots(page: Page, names: readonly string[]): Promise<void> {
    await page.getByRole(`button`, { name: `Add bots to the round robin` }).click();
    const dialog = page.locator(`dialog.rr-picker[open]`);
    await dialog.waitFor();
    for (const name of names) await dialog.getByRole(`button`, { name: new RegExp(`^${name}\\b`, `u`) }).click();
    await dialog.getByRole(`button`, { name: /^Add \d+ bots?$/u }).click();
    await dialog.waitFor({ state: `detached` });
}

// ana's bots and everyone else's on Play's Tournament place, the weekly waiting beside them.
const robins = (overrides: Partial<World> = {}) => world({ me: anaMe, bots: duelBots, tournaments: [...structuredClone(tournaments().filter((entry) => entry.status !== `running`)), ...structuredClone(roundRobins())], live: [], ...overrides });

// A duel's page in every look at a laptop's width, since it draws boards, and in the default look on a phone.
function duelPage(name: string, path: string, state: World, ready: string): Shot {
    return { name, path, world: state, ready, framed: true, board: laptopOnly, viewports: duelViewports };
}

export const shots: readonly Shot[] = [
    { name: `duels-empty`, path: `/play/duels`, world: dueling(), ready: `.duel-card`, framed: true, viewports: duelViewports },
    {
        name: `duels-picker`,
        path: `/play/duels`,
        world: dueling(),
        ready: `.duel-card`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Add a bot, First bot` }).click();
            await page.locator(`dialog.duel-picker[open] .pick-detail`).waitFor();
        },
    },
    {
        name: `duels-ready`,
        path: `/play/duels?first=Pistol1`,
        world: dueling(),
        ready: `.slot-filled`,
        framed: true,
        viewports: duelViewports,
        fullPage: true,
        after: async (page) => {
            await page.getByLabel(`Strength`).first().selectOption(`club`);
            await addBot(page, `second`, `devbot-a`);
            await page.getByRole(`button`, { name: `Start duel` }).waitFor();
        },
    },
    {
        name: `duels-test`,
        path: `/play/duels?first=pebble`,
        world: dueling(),
        ready: `.slot-filled`,
        framed: true,
        viewports: duelViewports,
        fullPage: true,
        after: async (page) => {
            await addBot(page, `second`, `cinder`);
            await page.getByRole(`button`, { name: `Start test` }).waitFor();
        },
    },
    { name: `duels-signed-out`, path: `/play/duels`, world: dueling({ me: null }), ready: `.discord-button`, framed: true, viewports: duelViewports },
    {
        name: `duels-refused`,
        path: `/play/duels?first=hextide`,
        world: dueling({ duelStart: { status: 400, code: `duel_busy` } }),
        ready: `.slot-filled`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await addBot(page, `second`, `devbot-a`);
            await page.getByRole(`button`, { name: `Start duel` }).click();
            await page.locator(`.start-refusal`).waitFor();
        },
    },
    {
        name: `duels-gone`,
        path: `/play/duels?first=driftwood`,
        world: dueling(),
        ready: `.slot-warn`,
        framed: true,
        viewports: duelViewports,
    },
    {
        name: `duels-none-ready`,
        path: `/play/duels`,
        world: dueling({ bots: duelBots.map((bot) => (bot.name === `hextide` ? bot : { ...bot, online: false })) }),
        ready: `.empty`,
        framed: true,
        viewports: duelViewports,
    },
    { name: `duels-signed-in-side`, path: `/play/duels`, world: dueling(), ready: `.duels-side .duel-row`, framed: true, viewports: duelViewports },
    { name: `duel-list`, path: `/games/duels`, world: dueling({ live: structuredClone([...duelFixtures.live.live, ...duelFixtures.testLive.live]), duels: structuredClone(Object.values(duelFixtures)) }), ready: `.live-duel-board svg`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `duel-list-tests`, path: `/games/duels?list=tests`, world: dueling(), ready: `.duel-row`, framed: true, viewports: duelViewports },
    { name: `duel-list-bot`, path: `/games/duels?bot=hextide`, world: dueling(), ready: `.duel-row`, framed: true, viewports: duelViewports },
    { name: `duel-list-none`, path: `/games/duels`, world: dueling({ duels: [] }), ready: `#past-duels ~ .note`, framed: true, viewports: duelViewports },
    { name: `duel-list-yours-signed-out`, path: `/games/duels?list=yours`, world: dueling({ me: null }), ready: `.events-sign-in`, framed: true, viewports: duelViewports },
    {
        name: `duel-list-rows`,
        path: `/games/duels`,
        world: dueling({ duels: structuredClone([duelFixtures.live, duelFixtures.testLive, ...[`a`, `b`].map((tag) => ({ ...duelFixtures.live, id: `d_devbotlive0${tag}` }))]) }),
        ready: `#live-duels ~ .duel-rows .duel-row`,
        framed: true,
        viewports: duelViewports,
    },
    duelPage(`duel-live`, `/duels/${duelFixtures.live.id}`, dueling({ me: brunoMe }), `.duel-head .score-hex`),
    duelPage(`duel-finished`, `/duels/${duelFixtures.rated.id}`, dueling(), `.duel-head .score-hex`),
    duelPage(`duel-test`, `/duels/${duelFixtures.test.id}`, dueling(), `.estimate`),
    duelPage(`duel-test-live`, `/duels/${duelFixtures.testLive.id}`, dueling({ duels: [structuredClone(duelFixtures.testLive)] }), `.estimate`),
    duelPage(`duel-cut-short`, `/duels/${duelFixtures.cutShort.id}`, dueling(), `.duel-head .score-hex`),
    {
        name: `duel-stopping`,
        path: `/duels/${duelFixtures.live.id}`,
        world: dueling({ me: brunoMe }),
        ready: `.duel-head`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Stop duel` }).click();
            await page.getByRole(`button`, { name: `Keep playing` }).waitFor();
        },
    },
    { name: `duel-missing`, path: `/duels/d_nothingthere`, world: dueling(), ready: `.empty`, framed: true, viewports: duelViewports },
    { name: `home-duel`, path: `/`, world: dueling({ live: liveGames.slice(1, 2) }), ready: `.home-duel`, framed: true, viewports: duelViewports },
    { name: `home-tournament`, path: `/`, world: world({ live: liveGames.slice(1, 2) }), ready: `.home-block-foot`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `bot-page-duels`, path: `/bots/Pistol1`, world: dueling(), ready: `.bot-duels`, framed: true, viewports: duelViewports },
    {
        name: `games-duels`,
        path: `/games`,
        world: dueling({ finished: [...duelGameRows, ...tournamentGameRows, ...keptNames] }),
        ready: `.game-row-event`,
        framed: true,
        viewports: duelViewports,
        storage: { 'hexo-arena.tests.v1': `on` },
    },
    { name: `profile-duels`, path: `/profile`, world: dueling(), ready: `.your-duels .duel-row`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `bot-page-tournaments`, path: `/bots/hextide`, world: world(), ready: `.place-row`, framed: true, viewports: duelViewports, fullPage: true },
    ...([
        [`game-drawer-duel`, `duel-game`],
        [`game-drawer-test`, `test-game`],
    ] as const).map(([name, id]): Shot => ({
        name,
        path: `/game/${id}`,
        world: dueling({ games: { ...structuredClone(gameFixtures), ...structuredClone(duelGameSnapshots) }, duels: structuredClone(Object.values(duelFixtures)) }),
        ready: `svg polygon.cell`,
        framed: false,
        viewports: laptopOnly,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
            await page.getByRole(`tab`, { name: `Game` }).click();
            await page.locator(`.facts a[href^="/duels/"]`).waitFor();
        },
    })),
    { name: `bot-page-duels-owner`, path: `/bots/Pistol1`, world: dueling({ me: brunoMe }), ready: `#duels-by-others`, framed: true, viewports: duelViewports, fullPage: true },

    { name: `home`, path: `/`, world: world({ live: liveGames, finished: keptNames }), ready: `.featured`, framed: true, board: true },
    { name: `home-few`, path: `/`, world: world({ live: liveGames.slice(1, 2), leaderboard: [] }), ready: `.featured`, framed: true, board: true },
    { name: `home-quiet`, path: `/`, world: world({ live: [] }), ready: `.featured`, framed: true, board: true },
    { name: `home-day-one`, path: `/`, world: world({ live: [], leaderboard: [], bots: [], finished: [] }), ready: `.build-band.wide`, framed: true },
    {
        name: `home-your-games`,
        path: `/`,
        world: world({ live: liveGames, me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: liveGames.filter((game) => game.players.x.name === `quinn`), analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } }),
        ready: `.your-game`,
        framed: true,
    },
    { name: `home-loading`, path: `/`, world: world({ stall: true }), ready: `.featured-skeleton`, framed: true },
    { name: `home-error`, path: `/`, world: world({ broken: true }), ready: `.build-band.wide`, framed: true },
    { name: `ladder`, path: `/ladder`, world: world(), ready: `.podium-plate`, framed: true, board: true, viewports: withLaptop },
    { name: `ladder-all-time`, path: `/ladder?active=all`, world: world(), ready: `.podium-plate`, framed: true },
    { name: `tournaments`, path: `/games/tournaments`, world: world({ tournaments: tournaments() }), ready: `.tournament-row-enter`, framed: true, viewports: duelViewports },
    { name: `tournaments-signed-out`, path: `/games/tournaments`, world: world({ me: null, tournaments: tournaments() }), ready: `.tournament-row`, framed: true, viewports: duelViewports },
    { name: `tournaments-none`, path: `/games/tournaments`, world: world({ tournaments: [] }), ready: `#tournaments-past + .note`, framed: true, viewports: duelViewports },
    { name: `play-tournament`, path: `/play/tournament`, world: world({ tournaments: tournaments() }), ready: `.next-tournament .entry-pick`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `play-tournament-signed-out`, path: `/play/tournament`, world: world({ me: null, tournaments: tournaments() }), ready: `.next-tournament .entry-sign-in`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `play-tournament-none`, path: `/play/tournament`, world: world({ tournaments: tournaments().filter((entry) => entry.status !== `scheduled`) }), ready: `.weekly-block p.note`, framed: true, viewports: duelViewports },
    {
        name: `games-one-duel`,
        path: `/games?event=duel&duel=${duelFixtures.live.id}`,
        world: dueling({ finished: [...duelGameRows, ...tournamentGameRows, ...keptNames] }),
        ready: `.chip`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Remove duel devbot-b vs devbot-c` }).waitFor();
            await page.getByRole(`button`, { name: /^Filters/u }).click();
            await page.locator(`#games-duel option:checked`).waitFor({ state: `attached` });
        },
    },
    {
        name: `games-one-round`,
        path: `/games?event=tournament&tournament=t_autumnrobin1&round=2`,
        world: world({ tournaments: tournaments(), finished: [...tournamentGameRows, ...keptNames] }),
        ready: `.game-row`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Remove round 2` }).waitFor();
            await page.getByRole(`button`, { name: `Remove Autumn round robin` }).waitFor();
        },
    },
    { name: `rr-setup-empty`, path: `/play/tournament`, world: robins(), ready: `.rr-card .slot-empty`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `rr-setup-signed-out`, path: `/play/tournament`, world: robins({ me: null }), ready: `.rr-card .discord-sign-in`, framed: true, viewports: duelViewports, fullPage: true },
    {
        name: `rr-setup-picker`,
        path: `/play/tournament`,
        world: robins(),
        ready: `.rr-card .slot-empty`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Add bots to the round robin` }).click();
            const dialog = page.locator(`dialog.rr-picker[open]`);
            for (const name of [`hextide`, `Pistol1`, `devbot-a`]) await dialog.getByRole(`button`, { name: new RegExp(`^${name}\\b`, `u`) }).click();
        },
    },
    {
        name: `rr-setup-ready`,
        path: `/play/tournament`,
        world: robins(),
        ready: `.rr-card .slot-empty`,
        framed: true,
        viewports: duelViewports,
        fullPage: true,
        after: async (page) => {
            await pickBots(page, [`hextide`, `Pistol1`, `devbot-b`, `devbot-a`, `quietlake`]);
        },
    },
    {
        name: `rr-setup-few`,
        path: `/play/tournament`,
        world: robins(),
        ready: `.rr-card .slot-empty`,
        framed: true,
        viewports: duelViewports,
        after: async (page) => {
            await pickBots(page, [`devbot-a`, `devbot-b`]);
        },
    },
    {
        name: `rr-setup-test`,
        path: `/play/tournament`,
        world: robins(),
        ready: `.rr-card .slot-empty`,
        framed: true,
        viewports: duelViewports,
        fullPage: true,
        after: async (page) => {
            await pickBots(page, [`hextide`, `cinder`, `pebble`]);
        },
    },
    { name: `rr-live`, path: `/tournaments/t_brunorobin01`, world: robins(), ready: `.rr-wait`, framed: true, board: laptopOnly, viewports: duelViewports, fullPage: true },
    { name: `rr-finished`, path: `/tournaments/t_brunorobin02`, world: robins(), ready: `.podium-plate`, framed: true, board: laptopOnly, viewports: duelViewports, fullPage: true },
    { name: `rr-stopped`, path: `/tournaments/t_brunorobin03`, world: robins(), ready: `.tournament-status`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `rr-test`, path: `/tournaments/t_anatest00001`, world: robins(), ready: `.rr-estimates`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `rr-tournaments`, path: `/games/tournaments`, world: robins(), ready: `.tournament-row`, framed: true, viewports: duelViewports, fullPage: true },
    { name: `rr-tournaments-tests`, path: `/games/tournaments?list=tests`, world: robins(), ready: `.tournament-row`, framed: true, viewports: duelViewports },
    { name: `tournament-waiting`, path: `/tournaments/t_wintercup202`, world: world(), ready: `.entry-pick`, framed: true, viewports: withLaptop },
    { name: `tournament-waiting-signed-out`, path: `/tournaments/t_wintercup202`, world: signedOut, ready: `.entry-sign-in`, framed: true, viewports: withLaptop },
    { name: `tournament-running`, path: `/tournaments/t_autumnrobin1`, world: world({ live: liveGames, tournaments: tournaments() }), ready: `.xt`, framed: true, board: true, viewports: withLaptop },
    { name: `tournament-finished`, path: `/tournaments/t_summercup202`, world: world(), ready: `.podium-plate`, framed: true, board: true, viewports: withLaptop },
    { name: `tournament-called-off`, path: `/tournaments/t_raincup20261`, world: world(), ready: `.tournament-status`, framed: true, viewports: withLaptop },
    { name: `ladder-two`, path: `/ladder`, world: world({ leaderboard: leaderboard.slice(0, 2) }), ready: `.podium-plate`, framed: true },
    { name: `ladder-one`, path: `/ladder`, world: world({ leaderboard: leaderboard.slice(0, 1) }), ready: `.podium-plate`, framed: true },
    {
        name: `ladder-found`,
        path: `/ladder`,
        world: world(),
        ready: `.podium-plate`,
        framed: true,
        after: async (page) => {
            await page.getByLabel(`Find a name`).fill(`hextide`);
            await page.locator(`tr.found`).waitFor();
        },
    },
    {
        name: `ladder-settling`,
        path: `/ladder`,
        world: world({ me: { kind: `user`, name: `newcomer`, rating: 1000, provisional: true, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } }),
        ready: `.ladder-you`,
        framed: true,
    },
    { name: `ladder-quiet`, path: `/ladder`, world: world({ leaderboard: leaderboard.slice(-1) }), ready: `.empty`, framed: true },
    { name: `ladder-empty`, path: `/ladder`, world: world({ leaderboard: [], live: [] }), ready: `.empty`, framed: true },
    { name: `settings`, path: `/`, world: world(), ready: `.featured`, framed: true, after: openSettings, board: true },
    {
        name: `settings-aids`,
        path: `/bots/sealbot`,
        world: guest,
        ready: `h1`,
        framed: true,
        after: openSettings,
        storage: { 'hexo-arena.board-rendering.v1': `{"numbers":true}` },
        board: true,
    },
    { name: `settings-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true, after: openSettings, board: true },
    { name: `menu-settings`, path: `/bots`, world: world(), ready: `table`, framed: true, after: openSettings, viewports: panelViewports },
    { name: `menu-identity`, path: `/bots`, world: world(), ready: `table`, framed: true, after: openIdentity, viewports: panelViewports },
    {
        name: `menu-identity-provisional`,
        path: `/profile`,
        world: world({ me: { kind: `user`, name: `quietowner`, rating: 1420, provisional: true, discord: null, liveGames: [], analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } }),
        ready: `h1`,
        framed: true,
        after: openIdentity,
        viewports: panelViewports,
    },
    { name: `menu-guest`, path: `/connect`, world: guest, ready: `h1`, framed: true, after: openIdentity, viewports: panelViewports },
    { name: `signin-expired`, path: `/?signin=expired`, world: signedOut, ready: `.featured`, framed: true },
    { name: `signin-banned`, path: `/?signin=banned`, world: signedOut, ready: `.featured`, framed: true },
    { name: `signin-cancelled`, path: `/connect?signin=cancelled`, world: signedOut, ready: `.site-banner`, framed: true },
    { name: `signin-rejected`, path: `/bots?signin=rejected`, world: signedOut, ready: `table`, framed: true },
    { name: `signin-busy`, path: `/play?signin=busy`, world: playing({ me: null }), ready: `.site-banner`, framed: true },
    { name: `ladder-loading`, path: `/ladder`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `ladder-error`, path: `/ladder`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `ladder-rate-limited`, path: `/ladder`, world: world({ limited: `reads` }), ready: `.empty .note`, framed: true },
    { name: `bots`, path: `/bots`, world: world(), ready: `table`, framed: true },
    { name: `bot-owner`, path: `/bots/sealbot`, world: world(), ready: `.bot-live`, framed: true, board: true },
    {
        name: `bot-playing-many`,
        path: `/bots/sealbot`,
        world: world({ live: liveGames }),
        ready: `.bot-live`,
        framed: true,
        board: true,
        after: async (page) => {
            await page.locator(`.bot-live`).scrollIntoViewIfNeeded();
        },
    },
    { name: `games`, path: `/games`, world: world(), ready: `.game-row`, framed: true },
    { name: `games-h2h`, path: `/games?player=hextide&vs=quietlake`, world: world({ finished: rivalry(230) }), ready: `.games-h2h`, framed: true },
    { name: `games-cap`, path: `/games?player=hextide&page=10`, world: world({ finished: rivalry(230) }), ready: `.games-cap`, framed: true },
    { name: `games-day-one`, path: `/games`, world: world({ finished: [] }), ready: `.empty`, framed: true },
    { name: `games-no-match`, path: `/games?player=hextide&reason=terminated&clock=match`, world: world(), ready: `.empty`, framed: true },
    { name: `games-unknown`, path: `/games?player=nobody`, world: world(), ready: `.empty`, framed: true },
    { name: `games-loading`, path: `/games`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `games-error`, path: `/games`, world: world({ broken: true }), ready: `.empty`, framed: true },
    {
        name: `games-filters`,
        path: `/games?player=hextide&clock=turn`,
        world: world({ finished: rivalry(40) }),
        ready: `.game-row`,
        framed: true,
        viewports: [
            { name: `desktop`, width: 1440, height: 900 },
            { name: `tablet`, width: 768, height: 1024 },
        ],
        after: async (page) => {
            await page.getByRole(`button`, { name: `Filters (1)` }).click();
            await page.locator(`dialog.games-panel[open]`).waitFor();
        },
    },
    {
        name: `games-filters-alone`,
        path: `/games`,
        world: world({ finished: rivalry(40) }),
        ready: `.game-row`,
        framed: true,
        viewports: [{ name: `desktop`, width: 1440, height: 900 }],
        after: async (page) => {
            await page.getByRole(`button`, { name: `Filters`, exact: true }).click();
            await page.locator(`dialog.games-panel[open]`).waitFor();
        },
    },
    {
        name: `games-sheet`,
        path: `/games?player=hextide&clock=turn`,
        world: world({ finished: rivalry(40) }),
        ready: `.game-row`,
        framed: true,
        viewports: phones,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Filters (1)` }).click();
            await page.locator(`dialog.games-panel[open]`).waitFor();
        },
    },
    { name: `games-pages`, path: `/games?page=4`, world: world({ finished: rivalry(150) }), ready: `.games-page-numbers`, framed: true },
    { name: `live-games`, path: `/games/live`, world: world({ live: liveGames }), ready: `.live-card`, framed: true, board: true },
    { name: `live-games-few`, path: `/games/live`, world: world({ live: liveGames.slice(0, 3) }), ready: `.live-card`, framed: true, board: true },
    { name: `live-games-empty`, path: `/games/live`, world: world({ live: [] }), ready: `.empty`, framed: true, board: true },
    { name: `live-games-loading`, path: `/games/live`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `live-games-error`, path: `/games/live`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `bot-live-none`, path: `/bots/sealbot`, world: world({ live: [] }), ready: `.rating-chart-plot`, framed: true },
    {
        name: `bot-visitor`,
        path: `/bots/sealbot`,
        world: world({ me: visitingAna }),
        ready: `h1`,
        framed: true,
    },
    {
        name: `bot-busy`,
        path: `/bots/sealbot`,
        world: playing(),
        ready: `.play-reason`,
        framed: true,
    },
    { name: `bots-play`, path: `/bots`, world: playing(), ready: `tbody tr`, framed: true },
    { name: `build`, path: `/connect`, world: world(), ready: `h1`, framed: true, viewports: guideViewports, fullPage: true },
    { name: `build-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true, viewports: guideViewports, fullPage: true },
    {
        name: `build-created`,
        path: `/connect`,
        world: world(),
        ready: `h1`,
        framed: true,
        viewports: guideViewports,
        after: async (page) => {
            await page.getByRole(`textbox`, { name: `Bot name` }).fill(`sealbot-two`);
            await page.getByRole(`button`, { name: `Create bot` }).click();
            await page.locator(`.token-box`).waitFor();
            await page.locator(`.steps`).scrollIntoViewIfNeeded();
        },
    },
    {
        name: `build-rate-limited`,
        path: `/connect`,
        world: world({ limited: `writes` }),
        ready: `h1`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`textbox`, { name: `Bot name` }).fill(`sealbot-two`);
            await page.getByRole(`button`, { name: `Create bot` }).click();
            await page.locator(`.field-error`).waitFor();
            await page.locator(`.field-error`).scrollIntoViewIfNeeded();
        },
    },
    {
        name: `bot-owner-rate-limited`,
        path: `/bots/sealbot`,
        world: world({ limited: `writes` }),
        ready: `.owner-panel`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Rotate token` }).click();
            await page.getByRole(`button`, { name: `Rotate; the old token stops now` }).click();
            await page.locator(`.owner-row .field-error`).waitFor();
            await page.locator(`.owner-panel`).scrollIntoViewIfNeeded();
        },
    },
    { name: `profile`, path: `/profile`, world: world(), ready: `.rating-chart-plot`, framed: true },
    { name: `player`, path: `/players/ana`, world: world(), ready: `.rating-chart-plot`, framed: true },
    { name: `player-missing`, path: `/players/nobody`, world: world(), ready: `.empty`, framed: true },
    { name: `player-loading`, path: `/players/ana`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `player-error`, path: `/players/ana`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `profile-guest`, path: `/profile`, world: guest, ready: `h1`, framed: true },
    { name: `profile-bots-0`, path: `/profile`, world: holding([]), ready: `.rating-chart-plot`, framed: true, after: showBots, viewports: botListViewports },
    { name: `profile-bots-1`, path: `/profile`, world: holding([`sealbot`]), ready: `.rating-chart-plot`, framed: true, after: showBots, viewports: botListViewports },
    {
        name: `profile-bots-4`,
        path: `/profile`,
        world: holding([`marsh`, `quietlake`, `sealbot`, `tidewater-alphabeta-v2`]),
        ready: `.rating-chart-plot`,
        framed: true,
        after: showBots,
        viewports: botListViewports,
    },
    { name: `profile-bots-5`, path: `/profile`, world: holding(heldBots.map((bot) => bot.name)), ready: `.rating-chart-plot`, framed: true, after: showBots, viewports: botListViewports },
    {
        name: `profile-long-names`,
        path: `/profile`,
        world: world({ me: longNamed }),
        ready: `.identity-discord`,
        framed: true,
    },
    { name: `menu-identity-long-names`, path: `/bots`, world: world({ me: longNamed }), ready: `table`, framed: true, after: openIdentity, viewports: panelViewports },
    { name: `profile-signed-out`, path: `/profile`, world: signedOut, ready: `h1`, framed: true },
    {
        name: `profile-delete-typed`,
        path: `/profile`,
        world: world(),
        ready: `.rating-chart-plot`,
        framed: true,
        after: async (page) => {
            await page.getByLabel(`Type quinn to confirm`).fill(`quinn`);
            await page.locator(`.owner-panel`).scrollIntoViewIfNeeded();
        },
    },
    {
        name: `profile-delete-refused`,
        path: `/profile`,
        world: world({ live: liveGames, me: { kind: `user`, name: `quinn`, rating: 1503, provisional: false, discord: null, liveGames: liveGames.filter((game) => game.players.x.name === `quinn`), analysisOptOut: false, analysisLeft: { positions: 300, games: 10 } } }),
        ready: `.rating-chart-plot`,
        framed: true,
        after: async (page) => {
            await page.getByLabel(`Type quinn to confirm`).fill(`quinn`);
            await page.getByRole(`button`, { name: `Delete account` }).click();
            await page.locator(`.owner-panel .field-error`).waitFor();
            await page.locator(`.owner-panel`).scrollIntoViewIfNeeded();
        },
    },
    {
        name: `profile-deleted`,
        path: `/profile`,
        world: world(),
        ready: `.rating-chart-plot`,
        framed: true,
        after: async (page) => {
            await page.getByLabel(`Type quinn to confirm`).fill(`quinn`);
            await page.getByRole(`button`, { name: `Delete account` }).click();
            await page.getByRole(`heading`, { name: `Your account is deleted` }).waitFor();
        },
    },
    { name: `analysis`, path: `/analysis`, world: signedOut, ready: `.an-intro`, framed: true, board: true },
    {
        name: `analysis-game`,
        path: `/analysis?game=long-finished&turn=12`,
        world: world(),
        ready: `.an-tree .an-row`,
        framed: true,
        board: true,
        after: async (page) => {
            for (const [x, y] of [[-3, 0], [-2, -1]] as const) await page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`).click();
            await page.locator(`.an-band`).waitFor();
        },
    },
    {
        name: `analysis-setup`,
        path: `/analysis?game=long-finished&turn=8`,
        world: world(),
        ready: `.an-tree .an-row`,
        framed: true,
        board: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Set up` }).click();
            await page.locator(`.an-tools`).waitFor();
        },
    },
    {
        name: `analysis-import`,
        path: `/analysis`,
        world: world(),
        ready: `.an-intro`,
        framed: true,
        board: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Import` }).click();
            await page.getByRole(`dialog`).getByRole(`textbox`).fill(`version[1];\n1. [1,0][1,-2];\n2. [-1,1][0,2];\n3. [-1,-1][2,1];\n4. [0,1][-1,0];\n`);
            await page.locator(`.an-preview .board-svg`).waitFor();
        },
    },
    {
        name: `analysis-import-refused`,
        path: `/analysis`,
        world: world(),
        ready: `.an-intro`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Import` }).click();
            await page.getByRole(`dialog`).getByRole(`textbox`).fill(`version[1];\n1. [1,0][1,-2];\n2. [1,0][0,2];\n`);
            await page.locator(`.an-dialog .an-error`).waitFor();
        },
    },
    {
        name: `analysis-export`,
        path: `/analysis#t=1.[1,0][1,-2];2.[-1,1][0,2];3.[-1,-1][2,1];4.[0,1][-1,0];`,
        world: world(),
        ready: `.an-tree .an-row`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Export` }).click();
            await page.locator(`.an-dialog`).waitFor();
        },
    },
    { name: `analysis-live`, path: `/analysis?game=running`, world: world(), ready: `.empty`, framed: true },
    {
        name: `analysis-game-reading`,
        path: `/analysis?game=long-finished&turn=17`,
        world: analysedLong,
        ready: `.an-win-graph .graph`,
        framed: true,
        board: true,
    },
    // A game read whole at quietlake's blunder on turn 13, a six left untaken, with a three-turn variation from turn 6 that holds a one-turn alternative at turn 7.
    {
        name: `analysis-review`,
        path: `/analysis?game=long-finished&turn=5`,
        world: analysedLong,
        ready: `.an-win-graph .graph`,
        framed: true,
        board: true,
        viewports: panelViewports,
        after: async (page) => {
            const cell = (x: number, y: number) => page.locator(`.board-camera polygon.cell[data-x="${String(x)}"][data-y="${String(y)}"]`);
            for (const [x, y] of [[3, 3], [3, 4], [4, 3], [4, 4], [5, 3], [5, 4]] as const) await cell(x, y).click({ force: true });
            await page.keyboard.press(`ArrowLeft`);
            await page.keyboard.press(`ArrowLeft`);
            for (const [x, y] of [[-3, 5], [-3, 6]] as const) await cell(x, y).click({ force: true });
            await page.keyboard.press(`ArrowUp`);
            await page.keyboard.press(`ArrowLeft`);
            await page.keyboard.press(`ArrowUp`);
            for (let turn = 6; turn < 13; turn += 1) await page.keyboard.press(`ArrowRight`);
            await page.locator(`.an-bubble-blunder`).waitFor();
        },
    },
    {
        name: `analysis-own-view`,
        path: `/analysis?game=long-finished&turn=17`,
        world: analysedLong,
        ready: `.an-win-graph .graph`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`group`, { name: `Readings` }).getByRole(`button`, { name: `Own view` }).click();
            await page.locator(`.an-win-graph .graph-trace-x`).waitFor();
        },
    },
    {
        name: `bots-analyzers`,
        path: `/bots`,
        world: world({ bots: [...bots, ...analyzerBots] }),
        ready: `table`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`checkbox`, { name: `Analyzers only` }).check();
            await page.locator(`.tag-analyzer`).first().waitFor();
        },
    },
    { name: `bot-analyzer`, path: `/bots/kestrel`, world: world({ bots: [...bots, ...analyzerBots] }), ready: `#analyzer-title`, framed: true },
    { name: `bot-page-full`, path: `/bots/sealbot`, world: world({ me: visitingAna }), ready: `.level-go`, framed: true, viewports: botPageViewports },
    { name: `bot-page-plain`, path: `/bots/hextide`, world: world(), ready: `#source-title`, framed: true, viewports: botPageViewports },
    { name: `bot-page-analyzer`, path: `/bots/driftwood`, world: world({ bots: [...bots, ...analyzerBots] }), ready: `#analyzer-title`, framed: true, viewports: botPageViewports },
    { name: `bot-page-offline`, path: `/bots/slowpoke`, world: world({ bots: [...bots, ...analyzerBots] }), ready: `.play-reason`, framed: true, viewports: botPageViewports },
    { name: `bot-page-owner`, path: `/bots/quietlake`, world: world(), ready: `.owner-panel`, framed: true, viewports: botPageViewports },
    {
        name: `analysis-reading`,
        path: `/analysis?game=long-finished&turn=12`,
        world: world(),
        ready: `.an-tree .an-row`,
        framed: true,
        board: true,
        after: async (page) => {
            await page.getByRole(`switch`, { name: `Analyze` }).check();
            await page.getByRole(`button`, { name: `Lines B, C` }).click();
            await page.locator(`button.an-line`).nth(2).waitFor();
            await page.locator(`button.an-line`).nth(1).hover();
        },
    },
    {
        name: `analysis-settings`,
        path: `/analysis?game=long-finished&turn=12`,
        world: world(),
        ready: `.an-tree .an-row`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Analysis settings` }).click();
            await page.locator(`.an-analyzer`).first().waitFor();
        },
    },
    {
        name: `analysis-refused`,
        path: `/analysis?game=long-finished&turn=12`,
        world: world({ positions: { kind: `refused`, status: 409, code: `live_position` } }),
        ready: `.an-tree .an-row`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`switch`, { name: `Analyze` }).check();
            await page.locator(`.an-trouble`).waitFor();
        },
    },
    { name: `analysis-missing`, path: `/analysis?game=nope`, world: world(), ready: `.empty`, framed: true },
    { name: `analysis-loading`, path: `/analysis?game=long-finished`, world: world({ stall: true }), ready: `.an-message[aria-busy]`, framed: true },
    { name: `analysis-error`, path: `/analysis?game=long-finished`, world: world({ broken: true }), ready: `.empty`, framed: true },
    { name: `game-your-move`, path: `/game/running`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-waiting`, path: `/game/waiting`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-rundown`, path: `/game/fresh`, world: world(), ready: `.hud-rundown .rundown-expected`, framed: false, board: true },
    ...[`practice`, `practice-long`].map(
        (game): Shot => ({
            name: `game-${game}`,
            path: `/game/${game}`,
            world: world(),
            ready: `.hud-rundown .rundown-form`,
            framed: false,
            viewports: levelChipViewports,
        }),
    ),
    { name: `game-unrated`, path: `/game/unrated`, world: world(), ready: `.hud-rundown .rundown-form`, framed: false },
    {
        name: `game-rundown-drawer`,
        path: `/game/waiting`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        viewports: [{ name: `desktop`, width: 1440, height: 900 }],
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.getByRole(`tab`, { name: `Game` }).click();
            await page.locator(`#drawer-panel-game .rundown-expected`).first().waitFor();
        },
    },
    { name: `game-low-clock`, path: `/game/hurry`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-finished`, path: `/game/finished`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    {
        name: `game-finished-numbers`,
        path: `/game/finished`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexo-arena.board-rendering.v1': `{"numbers":true}` },
        board: true,
    },
    { name: `game-rate-limited`, path: `/game/running`, world: world({ limited: `reads` }), ready: `.stage-message .note`, framed: false },
    {
        name: `game-turn-rate-limited`,
        path: `/game/running`,
        world: world({ limited: `writes` }),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.getByRole(`application`).focus();
            await page.keyboard.press(`ArrowRight`);
            await page.keyboard.press(`Enter`);
            await page.keyboard.press(`ArrowRight`);
            await page.keyboard.press(`Enter`);
            await page.getByText(/Too many tries/u).first().waitFor();
        },
    },
    {
        name: `game-resign-rate-limited`,
        path: `/game/running`,
        world: world({ limited: `writes` }),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
            await page.getByRole(`tab`, { name: `Game` }).click();
            await page.getByRole(`button`, { name: `Resign` }).click();
            await page.getByRole(`button`, { name: `Resign and lose` }).click();
            await page.locator(`.hud-note[role="alert"]`).waitFor();
        },
    },
    {
        name: `game-drawer`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
        board: true,
    },
    ...(
        [
            [`game-drawer-origin`, `/game/origin`],
            [`game-drawer-nine`, `/game/nine`],
            [`game-drawer-finished`, `/game/finished`],
            [`game-drawer-five-finished`, `/game/five-finished`],
            [`game-drawer-nine-finished`, `/game/nine-finished`],
        ] as const
    ).map(([name, path]) => ({
        name,
        path,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        board: true as const,
        after: async (page: Page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
    })),
    {
        name: `game-facts`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.getByRole(`tab`, { name: `Game` }).click();
        },
        board: true,
    },
    {
        name: `game-pending`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.getByRole(`application`).focus();
            await page.keyboard.press(`ArrowRight`);
            await page.keyboard.press(`Enter`);
        },
        board: true,
    },
    { name: `game-loading`, path: `/game/running`, world: world({ stall: true }), ready: `.hud-skeleton`, framed: false },
    {
        name: `game-pinned`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexo-arena.drawer-pinned.v1': `1` },
        board: true,
    },
    {
        name: `game-drawer-aids`,
        path: `/game/running`,
        world: world(),
        ready: `svg polygon.cell`,
        framed: false,
        storage: { 'hexo-arena.board-rendering.v1': `{"numbers":true}` },
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
        board: true,
    },
    { name: `watch-running`, path: `/game/running`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-replay`, path: `/game/finished?turn=2`, world: signedOut, ready: `.scrub-count:visible`, framed: false, board: true },
    {
        name: `watch-running-back`,
        path: `/game/running`,
        world: signedOut,
        ready: `.scrub-count:visible`,
        framed: false,
        board: true,
        after: async (page) => {
            await page.locator(`.scrub-count:visible`).press(`ArrowLeft`);
        },
    },
    { name: `watch-guest`, path: `/game/guest`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    { name: `games-kept-names`, path: `/games`, world: world({ finished: keptNames }), ready: `.game-row`, framed: true },
    { name: `report`, path: `/report?subject=%2Fbots%2Fsealbot`, world: signedOut, ready: `.report-form`, framed: true },
    {
        name: `report-missing`,
        path: `/report`,
        world: signedOut,
        ready: `.report-form`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Send report` }).click();
            await page.locator(`.report-form .field-error`).first().waitFor();
        },
    },
    {
        name: `report-sent`,
        path: `/report?subject=%2Fbots%2Fsealbot`,
        world: world(),
        ready: `.report-form`,
        framed: true,
        after: async (page) => {
            await page.getByLabel(`Reason`).selectOption(`name`);
            await page.getByLabel(`What is wrong`).fill(`The about text insults another player.`);
            await page.getByLabel(`This report is accurate, and I send it in good faith`).check();
            await page.getByRole(`button`, { name: `Send report` }).click();
            await page.getByRole(`heading`, { name: `Report 12 received` }).waitFor();
        },
    },
    { name: `watch-deleted`, path: `/game/gone`, world: signedOut, ready: `.hud-result`, framed: false, board: true },
    { name: `watch-finished`, path: `/game/finished`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
    // A finished game read by two analyzers, at x's blunder: its line A and mark on the board, the head and the feed open.
    {
        name: `game-analysis`,
        path: `/game/long-finished?turn=22`,
        world: analysedLong,
        ready: `svg polygon.cell`,
        framed: false,
        board: true,
        viewports: panelViewports,
        after: async (page) => {
            if ((page.viewportSize()?.width ?? 0) > 640) await page.keyboard.press(`m`);
            else await page.getByRole(`button`, { name: `Open the game panel` }).click();
            await page.locator(`.dr-marks`).waitFor();
        },
    },
    { name: `game-analysis-peek`, path: `/game/long-finished?turn=22`, world: analysedLong, ready: `.peek-graph .graph`, framed: false, board: true, viewports: phones },
    ...(
        [
            [`watch-drawer`, `/game/running`],
            [`watch-drawer-long`, `/game/long`],
            [`watch-drawer-finished`, `/game/finished`],
        ] as const
    ).map(([name, path]) => ({
        name,
        path,
        world: signedOut,
        ready: `svg polygon.cell`,
        framed: false,
        board: true as const,
        after: async (page: Page) => {
            await page.keyboard.press(`m`);
            await page.locator(`#drawer-body:not([hidden])`).waitFor();
        },
    })),
    {
        name: `watch-facts`,
        path: `/game/guest`,
        world: signedOut,
        ready: `svg polygon.cell`,
        framed: false,
        after: async (page) => {
            await page.keyboard.press(`m`);
            await page.getByRole(`tab`, { name: `Game` }).click();
        },
        board: true,
    },
    { name: `game-missing`, path: `/game/nope`, world: world(), ready: `h1`, framed: true },
    {
        name: `route-error`,
        path: `/bots`,
        world: world({ unloadable: `/src/screens/BotsScreen.tsx` }),
        ready: `.empty`,
        framed: true,
    },
    {
        name: `game-route-error`,
        path: `/game/running`,
        world: world({ unloadable: `/src/screens/GameScreen.tsx` }),
        ready: `.stage-message`,
        framed: false,
    },
    { name: `not-found`, path: `/nowhere`, world: world(), ready: `h1`, framed: true },
    { name: `play`, path: `/play`, world: playing(), ready: `.play-setup`, framed: true },
    { name: `play-signed-out`, path: `/play`, world: playing({ me: null }), ready: `.play-setup`, framed: true },
    { name: `play-guest`, path: `/play`, world: playing({ me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } }), ready: `.play-setup`, framed: true },
    { name: `play-named`, path: `/play?bot=devbot-c`, world: playing(), ready: `.play-setup`, framed: true },
    { name: `play-named-closed`, path: `/play?bot=pebble`, world: playing(), ready: `.play-setup`, framed: true },
    { name: `play-named-busy`, path: `/play?bot=sealbot`, world: playing(), ready: `.play-setup`, framed: true },
    { name: `play-limited`, path: `/play?bot=quietlake`, world: playing(), ready: `.play-setup`, framed: true },
    { name: `play-strength`, path: `/play?bot=hextide&level=deep`, world: playing(), ready: `.strength-chips`, framed: true },
    {
        name: `play-custom-turn`,
        path: `/play?bot=devbot-c`,
        world: playing(),
        ready: `.play-setup`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Custom clock` }).click();
            await page.locator(`.stepper`).first().waitFor();
        },
    },
    { name: `play-custom-match`, path: `/play?bot=devbot-c&clock=match-7-4`, world: playing(), ready: `.stepper`, framed: true },
    {
        name: `play-opening`,
        path: `/play?bot=devbot-c`,
        world: playing(),
        ready: `.play-setup`,
        framed: true,
        board: true,
        after: async (page) => {
            await page.locator(`.opening summary`).click();
            await page.locator(`.opening-preview`).waitFor();
        },
    },
    {
        name: `play-sheet`,
        path: `/play?bot=quietlake`,
        world: playing(),
        ready: `.play-setup`,
        framed: true,
        viewports: phones,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Change opponent` }).click();
            await page.locator(`dialog.play-sheet[open]`).waitFor();
        },
    },
    {
        name: `play-none`,
        path: `/play`,
        world: playing({ bots: playBots.map((bot) => ({ ...bot, openForChallenges: false })) }),
        ready: `.empty`,
        framed: true,
    },
    { name: `play-empty`, path: `/play`, world: playing({ bots: [] }), ready: `.empty`, framed: true },
    { name: `play-error`, path: `/play`, world: playing({ broken: true }), ready: `.empty`, framed: true },
    { name: `play-loading`, path: `/play`, world: playing({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `play-paused`, path: `/play?bot=devbot-c`, world: playing({ paused: true }), ready: `.play-setup`, framed: true },
    { name: `play-paused-signed-out`, path: `/play?bot=devbot-c`, world: playing({ paused: true, me: null }), ready: `.play-setup`, framed: true },
    refusedStart(`play-cooldown`, 429, `game_cooldown`, `/play?bot=devbot-c`, 42),
    refusedStart(`play-rate-limited`, 429, `rate_limited`, `/play?bot=devbot-c`, 42),
    {
        name: `play-guest-rate-limited`,
        path: `/play?bot=devbot-c`,
        world: playing({ me: null, limited: `writes` }),
        ready: `.play-setup`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Play as guest` }).click();
            await page.locator(`.start-lines p`).first().waitFor();
        },
    },
    refusedStart(`play-human-busy`, 400, `human_busy`),
    refusedStart(`play-bot-busy`, 400, `bot_busy`),
    refusedStart(`play-clock-not-accepted`, 400, `clock_not_accepted`),
    refusedStart(`play-not-open`, 400, `not_open`),
    refusedStart(`play-delisted`, 403, `delisted`),
    refusedStart(`play-not-found`, 404, `not_found`),
    refusedStart(`play-failed`, 500, `internal`),
    {
        name: `play-stale`,
        path: `/play?bot=devbot-c`,
        world: playing({ start: { status: 401, code: `unauthorized` } }),
        ready: `.play-setup`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Start game` }).click();
            await page.locator(`.start-area .warn`).waitFor();
        },
    },
    {
        name: `play-guest-limit`,
        path: `/play?bot=devbot-c`,
        world: playing({ me: null, guestLimit: true }),
        ready: `.play-setup`,
        framed: true,
        after: async (page) => {
            await page.getByRole(`button`, { name: `Play as guest` }).click();
            await page.locator(`.start-lines p`).first().waitFor();
        },
    },
    { name: `credits`, path: `/credits`, world: world(), ready: `h1`, framed: true, board: true },
    { name: `welcome`, path: `/welcome`, world: welcoming(), ready: `.field-ok`, framed: true },
    {
        name: `welcome-no-display-name`,
        path: `/welcome`,
        world: welcoming({ signup: { ...signup, discord: { username: `mira.hex`, displayName: null } } }),
        ready: `.field-ok`,
        framed: true,
    },
    {
        name: `welcome-guest`,
        path: `/welcome`,
        world: welcoming({ me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } }),
        ready: `.field-ok`,
        framed: true,
    },
    {
        name: `welcome-invalid`,
        path: `/welcome`,
        world: welcoming(),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await typeName(page, `mira.hex`);
        },
    },
    {
        name: `welcome-reserved`,
        path: `/welcome`,
        world: welcoming(),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await typeName(page, `admin`);
        },
    },
    {
        name: `welcome-taken`,
        path: `/welcome`,
        world: welcoming({ create: `name_taken` }),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await createAccount(page);
            await page.getByText(`That name is taken`).waitFor();
        },
    },
    {
        name: `welcome-rate-limited`,
        path: `/welcome`,
        world: welcoming({ limited: `writes` }),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await createAccount(page);
            await page.getByText(/Too many tries/u).first().waitFor();
        },
    },
    {
        name: `welcome-failed`,
        path: `/welcome`,
        world: welcoming({ create: `failed` }),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await createAccount(page);
            await page.getByText(`The account was not created; try again`).waitFor();
        },
    },
    { name: `welcome-expired`, path: `/welcome`, world: welcoming({ signup: null }), ready: `.welcome-ended`, framed: true },
    { name: `welcome-signed-in`, path: `/welcome`, world: world({ signup: null }), ready: `.identity-plate`, framed: true },
    {
        name: `welcome-limit`,
        path: `/welcome`,
        world: welcoming({ create: `signup_limit` }),
        ready: `.field-ok`,
        framed: true,
        after: async (page) => {
            await createAccount(page);
            await page.locator(`.welcome-ended`).waitFor();
        },
    },
    { name: `legal-imprint`, path: `/legal/imprint`, world: signedOut, ready: `section`, framed: true },
    { name: `legal-privacy`, path: `/legal/privacy`, world: signedOut, ready: `section`, framed: true },
    { name: `legal-terms`, path: `/legal/terms`, world: guest, ready: `section`, framed: true },
    { name: `legal-loading`, path: `/legal/privacy`, world: world({ stall: true }), ready: `.skeleton`, framed: true },
    { name: `legal-missing`, path: `/legal/privacy`, world: world({ legalMissing: [`privacy`] }), ready: `h1`, framed: true },
];

/** Seed the look's storage before any app script runs. */
export async function wear(page: Page, look: Look): Promise<void> {
    await page.addInitScript((entries: Record<string, string>) => {
        for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    }, look.storage);
}
