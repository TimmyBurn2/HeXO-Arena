import type { Page } from '@playwright/test';
import { themes } from '../src/theme/themes';
import { leaderboard, liveGames, playBots, rivalry, signup, tournaments, world, type World } from './mock-api';

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
    board?: true;
    // Widths other than the matrix's own.
    viewports?: readonly Viewport[];
}

const signedOut = world({ me: null });
const playing = (overrides: Partial<World> = {}) => world({ bots: playBots, ...overrides });
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
};
const welcoming = (overrides: Partial<World> = {}) => world({ me: null, signup, ...overrides });

async function typeName(page: Page, name: string): Promise<void> {
    await page.getByRole(`textbox`, { name: `Public name` }).fill(name);
}

async function createAccount(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Create account` }).click();
}
const guest = world({ me: { kind: `guest`, name: `Guest k3f9`, liveGames: [] } });

async function openSettings(page: Page): Promise<void> {
    await page.getByRole(`button`, { name: `Settings`, exact: true }).click();
    await page.locator(`dialog.settings[open]`).waitFor();
}

async function openIdentity(page: Page): Promise<void> {
    await page.locator(`header button.identity`).click();
    await page.locator(`dialog.identity-panel[open]`).waitFor();
}

export const shots: readonly Shot[] = [
    { name: `home`, path: `/`, world: world({ live: liveGames }), ready: `.featured`, framed: true, board: true },
    { name: `home-few`, path: `/`, world: world({ live: liveGames.slice(1, 2), leaderboard: [] }), ready: `.featured`, framed: true, board: true },
    { name: `home-quiet`, path: `/`, world: world({ live: [] }), ready: `.featured`, framed: true, board: true },
    { name: `home-day-one`, path: `/`, world: world({ live: [], leaderboard: [], bots: [], finished: [] }), ready: `.build-band.wide`, framed: true },
    {
        name: `home-your-games`,
        path: `/`,
        world: world({ live: liveGames, me: { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: null, liveGames: liveGames.filter((game) => game.players.x.name === `tom`) } }),
        ready: `.your-game`,
        framed: true,
    },
    { name: `home-loading`, path: `/`, world: world({ stall: true }), ready: `.featured-skeleton`, framed: true },
    { name: `home-error`, path: `/`, world: world({ broken: true }), ready: `.build-band.wide`, framed: true },
    { name: `ladder`, path: `/ladder`, world: world(), ready: `.podium-plate`, framed: true, board: true },
    { name: `ladder-all-time`, path: `/ladder?active=all`, world: world(), ready: `.podium-plate`, framed: true },
    { name: `tournaments`, path: `/tournaments`, world: world({ tournaments }), ready: `.tournament-row`, framed: true },
    { name: `tournaments-none`, path: `/tournaments`, world: world({ tournaments: [] }), ready: `.empty`, framed: true },
    { name: `tournament-waiting`, path: `/tournaments/t_wintercup202`, world: world(), ready: `.entry-pick`, framed: true },
    { name: `tournament-waiting-signed-out`, path: `/tournaments/t_wintercup202`, world: signedOut, ready: `.entry-sign-in`, framed: true },
    { name: `tournament-running`, path: `/tournaments/t_autumnrobin1`, world: world({ live: liveGames, tournaments }), ready: `.xt`, framed: true, board: true },
    { name: `tournament-finished`, path: `/tournaments/t_summercup202`, world: world(), ready: `.podium-plate`, framed: true, board: true },
    { name: `tournament-called-off`, path: `/tournaments/t_raincup20261`, world: world(), ready: `.tournament-status`, framed: true },
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
        world: world({ me: { kind: `user`, name: `newcomer`, rating: 1000, provisional: true, discord: null, liveGames: [] } }),
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
        world: world({ me: { kind: `user`, name: `quietowner`, rating: 1420, provisional: true, discord: null, liveGames: [] } }),
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
        world: world({ me: { kind: `user`, name: `ana`, rating: 1402, provisional: false, discord: null, liveGames: [] } }),
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
    { name: `build`, path: `/connect`, world: world(), ready: `h1`, framed: true },
    { name: `build-signed-out`, path: `/connect`, world: signedOut, ready: `h1`, framed: true },
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
    {
        name: `profile-long-names`,
        path: `/profile`,
        world: world({ me: longNamed }),
        ready: `.identity-discord`,
        framed: true,
    },
    { name: `menu-identity-long-names`, path: `/bots`, world: world({ me: longNamed }), ready: `table`, framed: true, after: openIdentity, viewports: panelViewports },
    { name: `profile-signed-out`, path: `/profile`, world: signedOut, ready: `h1`, framed: true },
    { name: `game-your-move`, path: `/game/running`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-waiting`, path: `/game/waiting`, world: world(), ready: `svg polygon.cell`, framed: false, board: true },
    { name: `game-rundown`, path: `/game/fresh`, world: world(), ready: `.hud-rundown .rundown-expected`, framed: false, board: true },
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
    { name: `watch-finished`, path: `/game/finished`, world: signedOut, ready: `svg polygon.cell`, framed: false, board: true },
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
