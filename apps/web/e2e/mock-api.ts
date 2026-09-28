import type { Page, Route } from '@playwright/test';
import {
    botListingSchema,
    gameSnapshotSchema,
    leaderboardEntrySchema,
    legalDetailsSchema,
    liveGameEntrySchema,
    meSchema,
    type BotListing,
    type GameSnapshot,
    type LeaderboardEntry,
    type LegalDetails,
    type LiveGameEntry,
    type Me,
    type Side,
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
    paused: boolean;
    // Hold every data answer back, for loading-state captures.
    stall: boolean;
    // Answer every data read with a 500, for error-state captures.
    broken: boolean;
    // A module path whose download fails, as a missing page chunk does.
    unloadable: string | null;
    // The deployment's legal details; null answers not found.
    legal: LegalDetails | null;
}

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
).map(([x, o], index) => ({
    gameId: index === 0 ? `guest` : `live-${String(index)}`,
    players: { x, o },
    timeControl: clocks[index % clocks.length] ?? { mode: `unlimited` },
    toMove: index % 2 === 0 ? `o` : `x`,
    rated: x.kind !== `guest` && o.kind !== `guest`,
    plies: 5 + 2 * index,
}));

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
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    running: {
        gameId: `running`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    waiting: {
        gameId: `waiting`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells.slice(0, 9) },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    hurry: {
        gameId: `hurry`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 8_000 },
    },
    finished: {
        gameId: `finished`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
    },
    origin: {
        gameId: `origin`,
        players: facing(`hextide`, 1690),
        openingPlies: 1,
        board: { cells: originCells.slice(0, 7) },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 21_000 },
    },
    nine: {
        gameId: `nine`,
        players: facing(`sealbot`, 1712),
        openingPlies: 9,
        board: { cells: midCells },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    'five-finished': {
        gameId: `five-finished`,
        players: facing(`sealbot`, 1712),
        openingPlies: 5,
        board: { cells: midCells },
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
        status: `finished`,
        winner: `x`,
        reason: `timeout`,
    },
};

export function world(overrides: Partial<World> = {}): World {
    return {
        me: { kind: `user`, name: `tom`, rating: 1503, provisional: false },
        leaderboard,
        bots,
        games: structuredClone(games),
        live: liveGames.slice(0, 1),
        paused: false,
        stall: false,
        broken: false,
        unloadable: null,
        legal: legalDetails,
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
            state.me = { kind: `guest`, name: `Guest k3f9` };
            await json(route, 201, state.me);
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
        await json(route, 404, { error: `unmocked ${method} ${path}`, code: `not_found` });
    });
}
