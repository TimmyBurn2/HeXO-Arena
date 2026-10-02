import {
    accountExportSchema,
    analysisListSchema,
    analysisPositionsPath,
    botAccountPath,
    botAccountSchema,
    botListingSchema,
    communityAnalysisSchema,
    finishedGamesPageSchema,
    gameSnapshotSchema,
    internalToWire,
    meSchema,
    positionReadingSchema,
    streamEventSchema,
    wireToInternal,
    type GameCell,
    type HtttxCell,
} from '@hexo-arena/contract';
import WebSocket, { type RawData } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { findBot } from '../src/bots';
import { insertBotGame, insertGame, insertMove, recordFinish } from '../src/game-store';
import { createTestApp, FakeStreamSocket, loginAs, mintBot, type TestApp } from './helpers';

let world: TestApp;
let port = 0;
const open: WebSocket[] = [];

beforeEach(async () => {
    world = await createTestApp();
    await world.app.listen({ host: `127.0.0.1`, port: 0 });
    const address = world.app.server.address();
    port = typeof address === `object` && address !== null ? address.port : 0;
});

afterEach(async () => {
    for (const socket of open.splice(0)) socket.terminate();
    world.app.server.closeAllConnections();
    await world.app.close();
    world.sqlite.close();
});

function frameText(data: RawData): string {
    return (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data)).toString();
}

async function until(predicate: () => boolean): Promise<void> {
    for (let spin = 0; spin < 5_000; spin += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
    throw new Error(`condition not reached in time`);
}

function botIdOf(name: string): string {
    const row = findBot(createQuery(world.sqlite), name.toLowerCase());
    if (row === undefined) throw new Error(`no bot ${name}`);
    return row.id;
}

async function declare(token: string, declaration: object) {
    const response = await world.app.inject({ method: `PATCH`, url: botAccountPath, headers: { authorization: `Bearer ${token}` }, payload: declaration });
    expect(response.statusCode).toBe(200);
    return botAccountSchema.parse(response.json());
}

// A bot whose stream is a recording socket: what it was sent, line by line.
function stream(name: string): FakeStreamSocket {
    const socket = new FakeStreamSocket();
    world.presence.attach(botIdOf(name), socket, true);
    return socket;
}

function offerIn(socket: FakeStreamSocket): string | undefined {
    const lines = socket.writes.filter((line) => line.trim() !== ``).map((line) => streamEventSchema.parse(JSON.parse(line)));
    const offer = lines.filter((line) => line.type === `analysisSession`).at(-1);
    return offer?.type === `analysisSession` ? offer.engine.token : undefined;
}

// An analyzer that answers each position with two empty cells beside its rightmost stone, valued as given.
async function reader(token: string, evaluation: object = { heuristic: 0.2 }): Promise<{ socket: WebSocket; requests: unknown[] }> {
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/api/bot/analysis/socket?token=${token}`);
    open.push(socket);
    // Teardown cuts the connection, which surfaces as a late error.
    socket.on(`error`, () => undefined);
    const requests: unknown[] = [];
    let cells: HtttxCell[] = [];
    socket.on(`message`, (data) => {
        const packet = JSON.parse(frameText(data)) as { type: string; board?: { cells: HtttxCell[] }; request_id?: number };
        if (packet.type === `setup`) cells = packet.board?.cells ?? [];
        if (packet.type !== `move_request`) return;
        requests.push(packet);
        const right = cells.map((cell) => wireToInternal(cell)).reduce((best, stone) => (stone.x > best.x ? stone : best), { x: -99, y: 0 });
        const pieces = [internalToWire({ x: right.x + 2, y: right.y }), internalToWire({ x: right.x + 2, y: right.y + 4 })];
        socket.send(JSON.stringify({ type: `move_response`, move: { pieces, evaluation }, request_id: packet.request_id }));
    });
    await until(() => socket.readyState === WebSocket.OPEN);
    return { socket, requests };
}

function dialStatus(token: string): Promise<number> {
    return new Promise((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/api/bot/analysis/socket?token=${token}`);
        open.push(socket);
        socket.on(`error`, () => undefined);
        socket.on(`unexpected-response`, (_request, response) => {
            resolve(response.statusCode ?? 0);
        });
        socket.on(`open`, () => {
            resolve(101);
        });
    });
}

const quiet: GameCell[] = [
    { x: 0, y: 0, side: `x` },
    { x: 3, y: 0, side: `o` },
    { x: 0, y: 3, side: `o` },
];

async function analyzerOnline(): Promise<{ token: string; requests: unknown[] }> {
    const token = await mintBot(world.app, await loginAs(world.app, `kestrelowner`), `kestrel`);
    await declare(token, { analyzer: { lines: 2, maxSeconds: 5 } });
    const offer = offerIn(stream(`kestrel`));
    if (offer === undefined) throw new Error(`no offer`);
    const { requests } = await reader(offer);
    return { token, requests };
}

function finishedGame(): string {
    const query = createQuery(world.sqlite);
    const gameId = insertBotGame(query, { challengerBotId: botIdOf(`alpha`), destBotId: botIdOf(`beta`), challengerSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] });
    insertMove(query, { gameId, seq: 1, side: `o`, cells: [{ x: 3, y: 0 }, { x: 0, y: 3 }] });
    insertMove(query, { gameId, seq: 2, side: `x`, cells: [{ x: -3, y: 0 }, { x: 0, y: -3 }] });
    recordFinish(query, gameId, { winner: `x`, reason: `surrender` });
    return gameId;
}

describe('the analyzer declaration', () => {
    it('stores maxSeconds and whilePlaying at their defaults, shows it in the directory, and withdraws with null', async () => {
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `kestrel`);
        expect((await declare(token, { analyzer: { lines: 3 } })).analyzer).toEqual({ maxSeconds: 2, lines: 3, whilePlaying: false, ready: false });
        const listed = async (query = ``) => botListingSchema.array().parse((await world.app.inject({ method: `GET`, url: `/api/bots${query}` })).json());
        expect((await listed(`?analyzer=1`)).map((bot) => bot.name)).toEqual([`kestrel`]);
        await mintBot(world.app, await loginAs(world.app, `other`), `plain`);
        expect((await listed()).find((bot) => bot.name === `plain`)?.analyzer).toBeNull();
        expect((await declare(token, { analyzer: null })).analyzer).toBeNull();
        expect(await listed(`?analyzer=1`)).toEqual([]);
        const refused = await world.app.inject({ method: `PATCH`, url: botAccountPath, headers: { authorization: `Bearer ${token}` }, payload: { analyzer: { lines: 4 } } });
        expect(refused.statusCode).toBe(400);
    });

    it('offers a session down the stream of a bot that declared, and nothing new to one that never did', async () => {
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `kestrel`);
        const plain = stream(`kestrel`);
        expect(plain.writes.join(``)).not.toContain(`analysisSession`);
        await declare(token, { analyzer: { lines: 1 } });
        const offer = offerIn(plain);
        expect(offer).toMatch(/^has_/);
        expect(offerIn(stream(`kestrel`))).not.toBe(offer);
    });

    it('opens the session for a fresh token, refusing an unknown one and a bot that withdrew', async () => {
        const token = await mintBot(world.app, await loginAs(world.app, `owner`), `kestrel`);
        await declare(token, { analyzer: { lines: 1 } });
        const offer = offerIn(stream(`kestrel`)) ?? ``;
        expect(await dialStatus(`has_unknown`)).toBe(401);
        await reader(offer);
        expect((await declare(token, {})).analyzer?.ready).toBe(true);
        await declare(token, { analyzer: null });
        expect(await dialStatus(offer)).toBe(404);
    });
});

describe('position readings', () => {
    it('reads a position for a signed-in user on the analyzer session and answers its lines', async () => {
        const { requests } = await analyzerOnline();
        const session = await loginAs(world.app, `asker`);
        const response = await world.app.inject({ method: `POST`, url: analysisPositionsPath, cookies: { hexo_arena_session: session }, payload: { cells: quiet, toMove: `x`, analyzer: null, lines: 2, seconds: 5 } });
        expect(response.statusCode).toBe(200);
        expect(positionReadingSchema.parse(response.json())).toMatchObject({ status: `done`, analyzer: { name: `kestrel`, ownerName: `kestrelowner` }, seconds: 5, cached: false, lines: [{ cells: [{ x: 5, y: 0 }, { x: 5, y: 4 }], heuristic: 0.2 }], left: 299 });
        expect(requests).toEqual([{ type: `move_request`, side: `x`, previous: [], move_time_limit: 5, request_id: 1 }]);
        const me = meSchema.parse((await world.app.inject({ method: `GET`, url: `/api/me`, cookies: { hexo_arena_session: session } })).json());
        expect(me?.kind === `user` && me.analysisLeft).toEqual({ positions: 299, games: 10 });
    });

    it('asks a guest or a stranger to sign in, and refuses a position that cannot be played from', async () => {
        await analyzerOnline();
        const body = { cells: quiet, toMove: `x`, analyzer: null, lines: 1, seconds: 2 };
        expect((await world.app.inject({ method: `POST`, url: analysisPositionsPath, payload: body })).statusCode).toBe(401);
        const guest = await world.app.inject({ method: `POST`, url: `/api/auth/guest` });
        const guestCookie = guest.cookies.find((cookie) => cookie.name === `hexo_arena_session`)?.value ?? ``;
        expect((await world.app.inject({ method: `POST`, url: analysisPositionsPath, cookies: { hexo_arena_session: guestCookie }, payload: body })).statusCode).toBe(401);
        const session = await loginAs(world.app, `asker`);
        const six = Array.from({ length: 6 }, (_, x): GameCell => ({ x, y: 0, side: `x` }));
        for (const cells of [six, [...quiet, { x: 0, y: 0, side: `o` } as const]]) {
            const refused = await world.app.inject({ method: `POST`, url: analysisPositionsPath, cookies: { hexo_arena_session: session }, payload: { ...body, cells } });
            expect(refused.json()).toMatchObject({ code: `bad_request` });
        }
    });

    it('refuses any position to a user seated in a live game, and to anyone a live game\'s position, however turned', async () => {
        await analyzerOnline();
        const opponent = await mintBot(world.app, await loginAs(world.app, `opponentowner`), `opponent`);
        await declare(opponent, { accepts: { turnMs: null, match: false, unlimited: true } });
        stream(`opponent`);
        const seated = await loginAs(world.app, `seated`);
        const created = await world.app.inject({ method: `POST`, url: `/api/games`, cookies: { hexo_arena_session: seated }, payload: { bot: `opponent`, timeControl: { mode: `unlimited` }, openingPlies: 9 } });
        expect(created.statusCode).toBe(201);
        const cells = gameSnapshotSchema.parse(created.json()).board.cells;
        const body = { cells: quiet, toMove: `x`, analyzer: null, lines: 1, seconds: 2 };
        expect((await world.app.inject({ method: `POST`, url: analysisPositionsPath, cookies: { hexo_arena_session: seated }, payload: body })).json()).toMatchObject({ code: `seated` });
        const turned = cells.map((cell): GameCell => ({ x: cell.x + cell.y + 20, y: -cell.x - 7, side: cell.side === `x` ? `o` : `x` }));
        const asker = await loginAs(world.app, `asker`);
        const refused = await world.app.inject({ method: `POST`, url: analysisPositionsPath, cookies: { hexo_arena_session: asker }, payload: { ...body, cells: turned, toMove: `x` } });
        expect(refused.statusCode).toBe(409);
        expect(refused.json()).toMatchObject({ code: `live_position` });
    });
});

describe('whole-game readings', () => {
    it('queues a finished game, reads it, counts it in the games list, and filters on it', async () => {
        await mintBot(world.app, await loginAs(world.app, `alphaowner`), `alpha`);
        await mintBot(world.app, await loginAs(world.app, `betaowner`), `beta`);
        const { requests } = await analyzerOnline();
        const gameId = finishedGame();
        const asker = await loginAs(world.app, `asker`);
        const requested = await world.app.inject({ method: `POST`, url: `/api/games/${gameId}/analyses`, cookies: { hexo_arena_session: asker } });
        expect(requested.statusCode).toBe(202);
        expect(communityAnalysisSchema.parse(requested.json())).toMatchObject({ status: `queued`, progress: { done: 0, of: 3 } });
        await until(() => requests.length === 3);
        await new Promise((resolve) => setTimeout(resolve, 1_100));
        const listed = analysisListSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/${gameId}/analyses` })).json());
        expect(listed).toMatchObject({ optedOut: false, analyses: [{ kind: `community`, status: `done`, analyzer: { name: `kestrel` }, progress: { done: 3, of: 3 } }] });
        const page = finishedGamesPageSchema.parse((await world.app.inject({ method: `GET`, url: `/api/games/finished?analyzed=1` })).json());
        expect(page.games.map((game) => [game.gameId, game.analyses])).toEqual([[gameId, 1]]);
        const exported = accountExportSchema.parse((await world.app.inject({ method: `GET`, url: `/api/me/export`, cookies: { hexo_arena_session: asker } })).json());
        expect(exported.analyses).toMatchObject([{ gameId, status: `done` }]);
        expect(exported.account.analysisOptOut).toBe(false);
    });

    it('keeps a reading when the account that asked for it goes, and forgets who asked', async () => {
        await mintBot(world.app, await loginAs(world.app, `alphaowner`), `alpha`);
        await mintBot(world.app, await loginAs(world.app, `betaowner`), `beta`);
        await analyzerOnline();
        const gameId = finishedGame();
        const asker = await loginAs(world.app, `asker`);
        // A game the account played keeps its row, under a placeholder, past the deletion.
        const query = createQuery(world.sqlite);
        const askerId = (world.sqlite.prepare(`select id from users where name = 'asker'`).get() as { id: string }).id;
        recordFinish(query, insertGame(query, { userId: askerId, botId: botIdOf(`alpha`), userSide: `x`, timeControl: { mode: `unlimited` }, opening: [{ x: 0, y: 0, player: 0 }] }), { winner: `x`, reason: `surrender` });
        expect((await world.app.inject({ method: `POST`, url: `/api/games/${gameId}/analyses`, cookies: { hexo_arena_session: asker } })).statusCode).toBe(202);
        expect((await world.app.inject({ method: `DELETE`, url: `/api/me`, cookies: { hexo_arena_session: asker }, payload: { name: `asker` } })).statusCode).toBe(204);
        expect(world.sqlite.prepare(`select deleted_at is not null as kept from users where id = ?`).get(askerId)).toEqual({ kept: 1 });
        expect(world.sqlite.prepare(`select requested_by as asker from analyses`).all()).toEqual([{ asker: null }]);
    });

    it('answers not_found for an unknown game, and lets the operator delete a reading', async () => {
        await mintBot(world.app, await loginAs(world.app, `alphaowner`), `alpha`);
        await mintBot(world.app, await loginAs(world.app, `betaowner`), `beta`);
        await analyzerOnline();
        const asker = await loginAs(world.app, `asker`);
        expect((await world.app.inject({ method: `GET`, url: `/api/games/g_nowhere/analyses` })).statusCode).toBe(404);
        expect((await world.app.inject({ method: `POST`, url: `/api/games/g_nowhere/analyses`, cookies: { hexo_arena_session: asker } })).statusCode).toBe(404);
        const gameId = finishedGame();
        const requested = communityAnalysisSchema.parse((await world.app.inject({ method: `POST`, url: `/api/games/${gameId}/analyses`, cookies: { hexo_arena_session: asker }, payload: { analyzer: `kestrel` } })).json());
        expect(world.admin({ op: `delete-analysis`, id: requested.analysisId, reason: `misread` })).toMatchObject({ kind: `done` });
        expect(world.admin({ op: `delete-analysis`, id: requested.analysisId, reason: `misread` })).toMatchObject({ kind: `error`, code: `not_found` });
    });

    it('lets a user opt out of public analysis and back in through their account', async () => {
        const session = await loginAs(world.app, `player`);
        const changed = await world.app.inject({ method: `PATCH`, url: `/api/me`, cookies: { hexo_arena_session: session }, payload: { analysisOptOut: true } });
        expect(changed.statusCode).toBe(200);
        expect(meSchema.parse(changed.json())).toMatchObject({ kind: `user`, analysisOptOut: true });
        expect((await world.app.inject({ method: `PATCH`, url: `/api/me`, cookies: { hexo_arena_session: session }, payload: { name: `x` } })).statusCode).toBe(400);
        expect((await world.app.inject({ method: `PATCH`, url: `/api/me`, payload: { analysisOptOut: true } })).statusCode).toBe(401);
    });
});
