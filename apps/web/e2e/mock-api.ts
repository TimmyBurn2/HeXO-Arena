import type { Page, Route } from '@playwright/test';
import {
    botListingSchema,
    gameSnapshotSchema,
    leaderboardEntrySchema,
    meSchema,
    type BotListing,
    type GameSnapshot,
    type LeaderboardEntry,
    type Me,
} from '@hexarena/contract';

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
    paused: boolean;
    // Hold every data answer back, for loading-state captures.
    stall: boolean;
    // Answer every data read with a 500, for error-state captures.
    broken: boolean;
}

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

export const games: Record<string, GameSnapshot> = {
    running: {
        gameId: `running`,
        you: `x`,
        opponent: { name: `sealbot`, rating: 1712, provisional: false },
        openingTurns: 1,
        board: { cells: midCells },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    waiting: {
        gameId: `waiting`,
        you: `x`,
        opponent: { name: `sealbot`, rating: 1712, provisional: false },
        openingTurns: 1,
        board: { cells: midCells.slice(0, 9) },
        status: `in-progress`,
        toMove: `o`,
        clock: { mode: `match`, remainingMainMs: { x: 227_000, o: 252_000 } },
    },
    hurry: {
        gameId: `hurry`,
        you: `x`,
        opponent: { name: `sealbot`, rating: 1712, provisional: false },
        openingTurns: 1,
        board: { cells: midCells },
        status: `in-progress`,
        toMove: `x`,
        clock: { mode: `turn`, remainingTurnMs: 8_000 },
    },
    finished: {
        gameId: `finished`,
        you: `x`,
        opponent: { name: `hextide`, rating: 1690, provisional: false },
        openingTurns: 0,
        board: {
            cells: [
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
            ],
        },
        status: `finished`,
        winner: `x`,
        reason: `six-in-a-row`,
    },
};

export function world(overrides: Partial<World> = {}): World {
    return {
        me: { kind: `user`, name: `tom` },
        leaderboard,
        bots,
        games: structuredClone(games),
        paused: false,
        stall: false,
        broken: false,
        ...overrides,
    };
}

function json(route: Route, status: number, body: unknown): Promise<void> {
    return route.fulfill({ status, contentType: `application/json`, body: JSON.stringify(body) });
}

/** Serve the world at the network layer for every API call the page makes. */
export async function serve(page: Page, state: World): Promise<void> {
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
                    you: snapshot.you,
                    opponent: snapshot.opponent,
                    openingTurns: snapshot.openingTurns,
                    board: snapshot.board,
                    status: `finished`,
                    winner: snapshot.you === `x` ? `o` : `x`,
                    reason: `surrender`,
                };
            }
            await json(route, 200, gameSnapshotSchema.parse(state.games[id]));
            return;
        }
        if (path === `/api/games` && method === `POST`) {
            await json(route, 201, gameSnapshotSchema.parse(state.games.running));
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
