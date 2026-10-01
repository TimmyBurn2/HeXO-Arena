import type { Page, Route } from '@playwright/test';
import {
    botListingSchema,
    devAccountSchema,
    gameSnapshotSchema,
    leaderboardEntrySchema,
    legalDetailsSchema,
    finishedGamesPageSchema,
    liveGameEntrySchema,
    meSchema,
    signupSchema,
    type BotListing,
    type DevAccount,
    type GameSnapshot,
    type LeaderboardEntry,
    type LegalDetails,
    type FinishedGameEntry,
    type LiveGameEntry,
    type Me,
    type Side,
    type Signup,
} from '@hexo-arena/contract';

/**
 * The world one browser test sees; every answer is parsed with the
 * contract schemas, so a fixture that drifts from the contract fails
 * loudly instead of rendering something the server could never send.
 */
export interface World {
    me: Me;
    leaderboard: LeaderboardEntry[];
    bots: BotListing[];
    games: Record<string, GameSnapshot>;
    live: LiveGameEntry[];
    // The finished games, newest first, as the history's first page holds them.
    finished: FinishedGameEntry[];
    paused: boolean;
    // Hold every data answer back, for loading-state captures.
    stall: boolean;
    // Answer every data read with a 500, for error-state captures.
    broken: boolean;
    // A module path whose download fails, as a missing page chunk does.
    unloadable: string | null;
    // The deployment's legal details; null answers not found.
    legal: LegalDetails | null;
    // The first sign-in waiting for its name; null answers it as expired.
    signup: Signup | null;
    // How Create account answers: the account, or a refusal by its code.
    create: `created` | `name_taken` | `signup_limit` | `failed`;
    // How a game start answers: the running game, or a refusal.
    start: `created` | { status: number; code: string; retryAfter?: number };
    // Whether minting a guest session finds the guest limit full.
    guestLimit: boolean;
    // Every data read, or every write, refused as rate-limited, with the wait its limit names.
    limited: `reads` | `writes` | null;
    // The dev server's seeded personas; null answers as every other server does, not found.
    devAccounts: DevAccount[] | null;
}

// Every state a bot in the Play roster can be in:
// ready at several ratings and clocks, busy at its game cap,
// one taking turn clocks of 10 to 60 s only, one closed, one offline.
const full = { turnMs: [5000, 300000], match: true, unlimited: true };
export const playBots: BotListing[] = [
    { name: `sealbot`, ownerName: `bruno`, online: true, openForChallenges: true, rating: 1712, provisional: false, liveGames: 4, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `hextide`, ownerName: `ana`, online: true, openForChallenges: true, rating: 1690, provisional: false, liveGames: 1, accepts: { turnMs: [5000, 60000], match: true, unlimited: false } },
    { name: `devbot-b`, ownerName: `devowner-b`, online: true, openForChallenges: true, rating: 1538, provisional: false, liveGames: 0, accepts: full },
    { name: `devbot-a`, ownerName: `devowner-a`, online: true, openForChallenges: true, rating: 1520, provisional: false, liveGames: 2, accepts: full },
    { name: `devbot-c`, ownerName: `devowner-c`, online: true, openForChallenges: true, rating: 1514, provisional: false, liveGames: 0, accepts: full },
    { name: `quietlake`, ownerName: `dmitri`, online: true, openForChallenges: true, rating: 1420, provisional: true, liveGames: 0, accepts: { turnMs: [10000, 60000], match: false, unlimited: false } },
    { name: `pebble`, ownerName: `ana`, online: true, openForChallenges: false, rating: 1388, provisional: true, liveGames: 0, accepts: { turnMs: [5000, 30000], match: false, unlimited: true } },
    { name: `lantern`, ownerName: `ana`, online: false, openForChallenges: false, rating: 1500, provisional: true, liveGames: 0 },
];

export const signup: Signup = { discord: { username: `mira.hex`, displayName: `Mira` }, suggestedName: `mira-hex`, next: `/connect` };

// Invented values: no real operator, host, or authority belongs in a fixture.
export const legalDetails: LegalDetails = {
    operator: { name: `Ada Beispiel`, addressLines: [`Musterweg 7`, `12345 Beispielstadt`, `Germany`], email: `contact@arena.example`, discord: `ada_b` },
    host: { name: `Example Hosting GmbH`, addressLines: [`Serverstrasse 1`, `54321 Rechenburg`, `Germany`], serverLocation: `Rechenburg, Germany` },
    supervisoryAuthority: {
        name: `Example State Data Protection Authority`,
        addressLines: [`Aufsichtsplatz 2`, `11111 Landeshausen`, `Germany`],
        url: `https://authority.example/`,
    },
    mailProvider: { name: `Example Mail AG`, addressLines: [`Postfach 3`, `22222 Briefstadt`, `Germany`] },
};

export const leaderboard: LeaderboardEntry[] = [
    { rank: 1, name: `sealbot`, kind: `bot`, rating: 1712 },
    { rank: 2, name: `hextide`, kind: `bot`, rating: 1690 },
    { rank: 3, name: `tom`, kind: `human`, rating: 1503 },
    { rank: 4, name: `quietlake`, kind: `bot`, rating: 1461 },
    { rank: 5, name: `ana`, kind: `human`, rating: 1402 },
    { rank: 6, name: `driftwood`, kind: `bot`, rating: 1388 },
];

export const bots: BotListing[] = [
    {
        name: `sealbot`,
        ownerName: `tom`,
        online: true,
        openForChallenges: true,
        rating: 1712,
        provisional: false,
        liveGames: 0,
        about: `A clean-room HeXO engine with a rotation opener.`,
        version: `0.3.1`,
        repoUrl: `https://github.com/tom/sealbot`,
        accepts: { turnMs: [5000, 60000], match: true, unlimited: true },
    },
    {
        name: `hextide`,
        ownerName: `ana`,
        online: true,
        openForChallenges: false,
        rating: 1690,
        provisional: false,
        liveGames: 0,
        version: `2.0.0`,
        accepts: { turnMs: null, match: true, unlimited: true },
    },
    {
        name: `quietlake`,
        ownerName: `tom`,
        online: false,
        openForChallenges: false,
        rating: 1461,
        provisional: true,
        liveGames: 0,
    },
];

const seat = {
    sealbot: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
    hextide: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
    quietlake: { name: `quietlake`, rating: 1461, provisional: true, kind: `bot` },
    driftwood: { name: `driftwood`, rating: 1388, provisional: false, kind: `bot` },
    ember: { name: `ember`, rating: 1320, provisional: true, kind: `bot` },
    tom: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
    ana: { name: `ana`, rating: 1402, provisional: false, kind: `user` },
    guest: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
} as const;

const clocks = [
    { mode: `turn`, turnTimeMs: 30_000 },
    { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
    { mode: `unlimited` },
] as const;

// The side of each ply: x holds the origin, then the sides alternate in pairs.
function sideOfPly(ply: number): Side {
    return ply === 0 || Math.floor((ply - 1) / 2) % 2 === 1 ? `x` : `o`;
}

const nearSteps = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: 2, y: -1 },
    { x: -2, y: 1 },
    { x: 1, y: 1 },
    { x: -1, y: -1 },
];

/**
 * A game's stones as play leaves them, clustered near the stones before;
 * the same seed always draws the same board.
 */
export function playedCells(count: number, seed: number): LiveGameEntry[`cells`] {
    let state = seed * 7919 + 17;
    const next = () => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
    };
    const cells: LiveGameEntry[`cells`] = [{ x: 0, y: 0, side: `x` }];
    const taken = new Set([`0,0`]);
    while (cells.length < count) {
        const from = cells[Math.floor(next() * cells.length)] ?? { x: 0, y: 0 };
        const step = nearSteps[Math.floor(next() * nearSteps.length)] ?? { x: 1, y: 0 };
        const cell = { x: from.x + step.x, y: from.y + step.y };
        const key = `${String(cell.x)},${String(cell.y)}`;
        if (taken.has(key)) continue;
        taken.add(key);
        cells.push({ ...cell, side: sideOfPly(cells.length) });
    }
    return cells;
}

// The clock a live game shows for its time control, part spent.
function runningClock(timeControl: (typeof clocks)[number], index: number): LiveGameEntry[`clock`] {
    if (timeControl.mode === `turn`) return { mode: `turn`, remainingTurnMs: 24_000 - 1_000 * index };
    if (timeControl.mode === `match`) return { mode: `match`, remainingMainMs: { x: 241_000 - 3_000 * index, o: 263_000 - 2_000 * index } };
    return { mode: `unlimited` };
}

// A full list: the cap's worth of games, mixing bot pairs, users, and
// guests, with no bot past its four live games.
export const liveGames: LiveGameEntry[] = (
    [
        [seat.sealbot, seat.guest],
        [seat.hextide, seat.sealbot],
        [seat.tom, seat.quietlake],
        [seat.driftwood, seat.hextide],
        [seat.guest, seat.driftwood],
        [seat.quietlake, seat.sealbot],
        [seat.ana, seat.hextide],
        [seat.sealbot, seat.driftwood],
        [seat.guest, seat.ember],
        [seat.quietlake, seat.driftwood],
        [seat.tom, seat.ember],
        [seat.hextide, seat.quietlake],
    ] as const
).map(([x, o], index) => {
    const timeControl = clocks[index % clocks.length] ?? clocks[2];
    const cells = playedCells(9 + 4 * index, index + 1);
    return {
        gameId: index === 0 ? `guest` : `live-${String(index)}`,
        players: { x, o },
        timeControl,
        toMove: sideOfPly(cells.length),
        rated: x.kind !== `guest` && o.kind !== `guest`,
        cells,
        clock: runningClock(timeControl, index),
    };
});

const midCells: GameSnapshot[`board`][`cells`] = [
    { x: 0, y: 0, side: `x` },
    { x: 1, y: -1, side: `o` },
    { x: -1, y: 1, side: `o` },
    { x: 1, y: 0, side: `x` },
    { x: 2, y: -1, side: `x` },
    { x: 0, y: 1, side: `o` },
    { x: -1, y: 2, side: `o` },
    { x: -1, y: 0, side: `x` },
    { x: 0, y: -1, side: `x` },
    { x: 1, y: 1, side: `o` },
    { x: 2, y: 0, side: `o` },
];

// A game from the origin alone, won by x with six along y = 0.
const originCells: GameSnapshot[`board`][`cells`] = [
    { x: 0, y: 0, side: `x` },
    { x: 0, y: 1, side: `o` },
    { x: 1, y: 1, side: `o` },
    { x: 1, y: 0, side: `x` },
    { x: 2, y: 0, side: `x` },
    { x: 0, y: 2, side: `o` },
    { x: 1, y: 2, side: `o` },
    { x: 3, y: 0, side: `x` },
    { x: 4, y: 0, side: `x` },
    { x: 2, y: 2, side: `o` },
    { x: -1, y: 2, side: `o` },
    { x: 5, y: 0, side: `x` },
];

// The default signed-in user sits on x, facing a bot on o; whoever else
// opens the game watches it.
function facing(bot: string, rating: number): GameSnapshot[`players`] {
    return {
        x: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
        o: { name: bot, rating, provisional: false, kind: `bot` },
    };
}

// Sixty turns and more, ring by ring around the origin: a feed longer than
// any viewport, which the drawer must scroll instead of growing the stage.
const longCells: GameSnapshot[`board`][`cells`] = (() => {
    const steps = [
        { x: -1, y: 1 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
    ];
    const cells: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    for (let ring = 1; cells.length < 121; ring += 1) {
        let cell = { x: ring, y: 0 };
        for (const step of steps) {
            for (let walk = 0; walk < ring; walk += 1) {
                cells.push(cell);
                cell = { x: cell.x + step.x, y: cell.y + step.y };
            }
        }
    }
    return cells.slice(0, 121).map((cell, ply) => ({
        ...cell,
        side: ply === 0 || Math.floor((ply - 1) / 2) % 2 === 1 ? (`x` as const) : (`o` as const),
    }));
})();

export const games: Record<string, GameSnapshot> = {
    long: {
        gameId: `long`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: longCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    running: {
        gameId: `running`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    waiting: {
        gameId: `waiting`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells.slice(0, 9) },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    hurry: {
        gameId: `hurry`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 8_000 },
    },
    finished: {
        gameId: `finished`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
    },
    // The newest result, apart from the finished game the game screen's
    // tests use, so a path never names both.
    won: {
        gameId: `won`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
    },
    origin: {
        gameId: `origin`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells.slice(0, 7) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    nine: {
        gameId: `nine`,
        players: facing(`sealbot`, 1712),
        openingPlies: 9,
        board: { cells: midCells },
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    'five-finished': {
        gameId: `five-finished`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `o`,
        reason: `surrender`,
    },
    guest: {
        gameId: `guest`,
        players: {
            x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
            o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
        },
        openingPlies: 5,
        board: { cells: midCells.slice(0, 9) },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `turn`, remainingTurnMs: 38_000 },
    },
    'nine-finished': {
        gameId: `nine-finished`,
        players: facing(`sealbot`, 1712),
        openingPlies: 9,
        board: {
            cells: [
                ...midCells,
                { x: 3, y: -2, side: `x` },
                { x: 3, y: -1, side: `x` },
            ],
        },
        timeControl: { mode: `turn`, turnTimeMs: 30_000 },
        status: `finished`,
        winner: `x`,
        reason: `timeout`,
    },
};

// The latest results, newest first; the first three have snapshots, so a
// frozen board can show the newest.
const finishedAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
export const recentGames: FinishedGameEntry[] = [
    { gameId: `won`, players: facing(`hextide`, 1690), winner: `x`, reason: `six-in-a-row`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 1, turns: 12, finishedAt: finishedAt(3), rated: true },
    { gameId: `five-finished`, players: facing(`sealbot`, 1712), winner: `o`, reason: `surrender`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 5, turns: 5, finishedAt: finishedAt(41), rated: true },
    { gameId: `nine-finished`, players: facing(`sealbot`, 1712), winner: `x`, reason: `timeout`, timeControl: { mode: `turn`, turnTimeMs: 30_000 }, openingPlies: 9, turns: 6, finishedAt: finishedAt(95), rated: true },
    ...(
        [
            [seat.hextide, seat.sealbot, `o`, `six-in-a-row`],
            [seat.quietlake, seat.driftwood, `x`, `timeout`],
            [seat.ember, seat.hextide, null, `aborted`],
            [seat.sealbot, seat.quietlake, `x`, `six-in-a-row`],
            [seat.driftwood, seat.ember, `o`, `disconnect`],
        ] as const
    ).map(([x, o, winner, reason], index): FinishedGameEntry => ({
        gameId: `past-${String(index)}`,
        players: { x, o },
        winner,
        reason,
        timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 2_000 },
        openingPlies: 1,
        turns: 20 + index,
        finishedAt: finishedAt(180 + 600 * index),
        rated: winner !== null,
    })),
];

export function world(overrides: Partial<World> = {}): World {
    return {
        me: { kind: `user`, name: `tom`, rating: 1503, provisional: false, discord: { username: `tom.hex`, displayName: `Tom` }, liveGames: [] },
        leaderboard,
        bots,
        games: structuredClone(games),
        live: liveGames.slice(0, 1),
        finished: recentGames,
        paused: false,
        stall: false,
        broken: false,
        unloadable: null,
        legal: legalDetails,
        signup: null,
        create: `created`,
        start: `created`,
        guestLimit: false,
        limited: null,
        devAccounts: null,
        ...overrides,
    };
}

// The server's rule: the caller's side is present exactly when the
// session holds a seat, which the mock reads as a name match.
function seatOf(snapshot: GameSnapshot, me: Me): Side | undefined {
    if (me === null) return undefined;
    for (const side of [`x`, `o`] as const) {
        const player = snapshot.players[side];
        if (player.kind !== `bot` && player.name === me.name) return side;
    }
    return undefined;
}

function viewOf(snapshot: GameSnapshot, me: Me): GameSnapshot {
    const you = seatOf(snapshot, me);
    return gameSnapshotSchema.parse(you === undefined ? snapshot : { ...snapshot, you });
}

// Playwright fulfills a route with one whole body, so a stream cannot stay
// open: the page gets an EventSource that fetches the mocked stream, hands
// on its events, and then holds, as a quiet live stream would.
function installHeldEventSource(): void {
    class HeldEventSource extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;
        readyState = HeldEventSource.CONNECTING;
        onerror: ((event: Event) => void) | null = null;

        constructor(readonly url: string) {
            super();
            void fetch(url, { headers: { accept: `text/event-stream` } }).then(
                async (response) => {
                    if (this.readyState === HeldEventSource.CLOSED) return;
                    if (!response.ok) {
                        this.fail();
                        return;
                    }
                    this.readyState = HeldEventSource.OPEN;
                    for (const frame of (await response.text()).split(`\n\n`)) {
                        const lines = frame.split(`\n`);
                        const type = lines.find((line) => line.startsWith(`event: `))?.slice(7);
                        const data = lines.find((line) => line.startsWith(`data: `))?.slice(6);
                        if (type === undefined || data === undefined || this.readyState === HeldEventSource.CLOSED) continue;
                        this.dispatchEvent(new MessageEvent(type, { data }));
                    }
                },
                () => {
                    this.fail();
                },
            );
        }

        close(): void {
            this.readyState = HeldEventSource.CLOSED;
        }

        fail(): void {
            this.readyState = HeldEventSource.CLOSED;
            this.onerror?.(new Event(`error`));
        }
    }
    Object.defineProperty(window, `EventSource`, { value: HeldEventSource, configurable: true, writable: true });
}

function json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, contentType: `application/json`, body: JSON.stringify(body) });
}

/** Serve the world at the network layer for every API call the page makes. */
export async function serve(page: Page, state: World): Promise<void> {
    await page.addInitScript(installHeldEventSource);
    await page.route((url) => url.pathname === state.unloadable, (route) => route.abort());
    await page.route((url) => url.pathname === `/healthz`, (route) =>
        route.fulfill({ status: state.paused ? 503 : 200, contentType: `application/json`, body: `{"ok":true}` }),
    );
    // A pathname match, not a glob: the app's own src/api modules would
    // match `**/api/**`.
    await page.route((url) => url.pathname.startsWith(`/api/`), async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();

        if (state.stall && method === `GET` && path !== `/api/me`) return;
        if (state.broken && method === `GET` && path !== `/api/me`) {
            await json(route, 500, { error: `boom`, code: `internal` });
            return;
        }

        if (state.limited !== null && (method === `GET`) === (state.limited === `reads`) && path !== `/api/me`) {
            await route.fulfill({
                status: 429,
                contentType: `application/json`,
                // A guest session refills one every twenty minutes, the rest within a minute.
                headers: { 'retry-after': path === `/api/auth/guest` ? `1140` : `42` },
                body: JSON.stringify({ error: `rate limit exceeded`, code: `rate_limited` }),
            });
            return;
        }

        if (path === `/api/me` && method === `GET`) {
            await json(route, 200, meSchema.parse(state.me));
            return;
        }
        if (path === `/api/auth/logout` && method === `POST`) {
            state.me = null;
            await route.fulfill({ status: 204 });
            return;
        }
        if (path === `/api/auth/guest` && method === `POST`) {
            if (state.guestLimit) {
                await route.fulfill({
                    status: 429,
                    contentType: `application/json`,
                    headers: { 'retry-after': `60` },
                    body: JSON.stringify({ error: `the guest cap is full`, code: `guest_limit` }),
                });
                return;
            }
            state.me = { kind: `guest`, name: `Guest k3f9`, liveGames: [] };
            await json(route, 201, state.me);
            return;
        }
        if (path === `/api/signup`) {
            const held = state.signup;
            if (method === `DELETE`) {
                state.signup = null;
                await route.fulfill({ status: 204 });
            } else if (held === null) {
                await json(route, 410, { error: `no sign-up waits for this cookie`, code: `signup_expired` });
            } else if (method === `GET`) {
                await json(route, 200, signupSchema.parse(held));
            } else if (state.create === `created`) {
                const body = request.postDataJSON() as { name: string };
                state.signup = null;
                state.me = { kind: `user`, name: body.name, rating: 1000, provisional: true, discord: held.discord, liveGames: [] };
                await json(route, 201, { name: body.name });
            } else if (state.create === `failed`) {
                await json(route, 500, { error: `boom`, code: `internal` });
            } else {
                await json(route, state.create === `name_taken` ? 409 : 410, { error: `no`, code: state.create });
            }
            return;
        }
        if (path === `/api/legal` && method === `GET`) {
            if (state.legal === null) await json(route, 404, { error: `no legal details on this server`, code: `not_found` });
            else await json(route, 200, legalDetailsSchema.parse(state.legal));
            return;
        }
        if (path === `/api/leaderboard` && method === `GET`) {
            const kind = url.searchParams.get(`kind`) ?? `all`;
            const rows = state.leaderboard
                .filter((entry) => kind === `all` || (kind === `bots`) === (entry.kind === `bot`))
                .map((entry, index) => ({ ...entry, rank: index + 1 }));
            await json(route, 200, leaderboardEntrySchema.array().parse(rows));
            return;
        }
        if (path === `/api/bots` && method === `GET`) {
            const online = url.searchParams.get(`online`) === `1`;
            const rows = state.bots.filter((bot) => !online || bot.online);
            await json(route, 200, botListingSchema.array().parse(rows));
            return;
        }
        const events = /^\/api\/games\/([^/]+)\/events$/.exec(path);
        if (events !== null) {
            const snapshot = state.games[decodeURIComponent(events[1] ?? ``)];
            if (snapshot === undefined) {
                await json(route, 404, { error: `no such game`, code: `not_found` });
                return;
            }
            const data = JSON.stringify(viewOf(snapshot, state.me));
            await route.fulfill({ status: 200, contentType: `text/event-stream`, body: `event: snapshot\ndata: ${data}\n\n` });
            return;
        }
        if (path === `/api/games/finished` && method === `GET`) {
            await json(route, 200, finishedGamesPageSchema.parse({ games: state.finished.slice(0, 20), next: null, page: 1 }));
            return;
        }
        const game = /^\/api\/games\/([^/]+)(\/move|\/resign)?$/.exec(path);
        if (game !== null) {
            const id = decodeURIComponent(game[1] ?? ``);
            const snapshot = state.games[id];
            if (snapshot === undefined) {
                await json(route, 404, { error: `no such game`, code: `not_found` });
                return;
            }
            if (game[2] === `/move` && snapshot.status === `in-progress`) {
                const body = request.postDataJSON() as { cells: { x: number; y: number }[] };
                const side = snapshot.toMove;
                snapshot.board.cells.push(...body.cells.map((cell) => ({ ...cell, side })));
                snapshot.toMove = side === `x` ? `o` : `x`;
            }
            if (game[2] === `/resign` && snapshot.status === `in-progress`) {
                state.games[id] = {
                    gameId: snapshot.gameId,
                    players: snapshot.players,
                    openingPlies: snapshot.openingPlies,
                    board: snapshot.board,
                    timeControl: snapshot.timeControl,
                    status: `finished`,
                    winner: seatOf(snapshot, state.me) === `x` ? `o` : `x`,
                    reason: `surrender`,
                };
            }
            const answered = state.games[id];
            if (answered !== undefined) await json(route, 200, viewOf(answered, state.me));
            return;
        }
        if (path === `/api/games` && method === `GET`) {
            await json(route, 200, liveGameEntrySchema.array().parse(state.live));
            return;
        }
        if (path === `/api/games` && method === `POST`) {
            const start = state.start;
            if (start !== `created`) {
                // A refused session reads as signed out from then on.
                if (start.status === 401) state.me = null;
                await route.fulfill({
                    status: start.status,
                    contentType: `application/json`,
                    headers: start.retryAfter === undefined ? {} : { 'retry-after': String(start.retryAfter) },
                    body: JSON.stringify({ error: `refused`, code: start.code }),
                });
                return;
            }
            if (state.games.running !== undefined) await json(route, 201, viewOf(state.games.running, state.me));
            return;
        }
        const token = /^\/api\/bots\/([^/]+)\/token$/.exec(path);
        if (token !== null && method === `POST`) {
            await json(route, 200, { name: decodeURIComponent(token[1] ?? ``), token: `hxo_${`a`.repeat(43)}` });
            return;
        }
        const bot = /^\/api\/bots\/([^/]+)$/.exec(path);
        if (bot !== null && method === `DELETE`) {
            const name = decodeURIComponent(bot[1] ?? ``);
            state.bots = state.bots.filter((entry) => entry.name !== name);
            await route.fulfill({ status: 204 });
            return;
        }
        if (path === `/api/bots` && method === `POST`) {
            const body = request.postDataJSON() as { name: string };
            await json(route, 201, { name: body.name, token: `hxo_${`b`.repeat(43)}` });
            return;
        }
        if (path === `/api/dev/accounts` && method === `GET`) {
            if (state.devAccounts === null) await json(route, 404, { error: `route not found`, code: `not_found` });
            else await json(route, 200, devAccountSchema.array().parse(state.devAccounts));
            return;
        }
        if (path === `/api/dev/login` && method === `POST` && state.devAccounts !== null) {
            const body = request.postDataJSON() as { name?: string };
            // Given a Discord account instead of a name, the server holds a first sign-in.
            if (body.name === undefined) {
                state.signup = signup;
                await route.fulfill({ status: 302, headers: { location: `/welcome` } });
                return;
            }
            const persona = state.devAccounts.find((account) => account.name === body.name);
            if (persona?.banned === true) {
                await json(route, 403, { error: `the account is banned`, code: `banned` });
                return;
            }
            state.me = { kind: `user`, name: body.name, rating: persona?.rating ?? 1000, provisional: persona?.provisional ?? true, discord: null, liveGames: [] };
            await json(route, 200, { name: body.name });
            return;
        }
        await json(route, 404, { error: `unmocked ${method} ${path}`, code: `not_found` });
    });
}
