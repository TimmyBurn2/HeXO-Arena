import {
    gameEventSchema,
    gameTurnCap,
    internalToWire,
    orphanForfeitMs,
    sessionHeartbeatMs,
    sessionTokenTtlMs,
    sideOf,
    streamBacklogLimitBytes,
    unlimitedWallCapMs,
    wireToInternal,
    type BwsHeartbeatPacket,
    type BwsMoveRequestPacket,
    type BwsSetupPacket,
    type HtttxCoord,
    type HtttxPlayedMove,
    type OpeningPlies,
    type Side,
    type StreamEvent,
} from '@hexo-arena/contract';
import { hexDistance, openingRegion, type Coord } from '@hexo-arena/rules';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuery, openDatabase, runMigrations, type Sqlite } from '../src/db';
import { moves } from '../src/db/schema';
import { createBot, findBot } from '../src/bots';
import { createUserWithExactName } from '../src/users';
import { abortUnfinishedGames, findGame } from '../src/game-store';
import {
    finishedBoardMemoCap,
    GameRegistry,
    wirePresence,
    type EngineSocket,
} from '../src/game-registry';
import { deleteUser } from '../src/moderation';
import { PresenceRegistry } from '../src/presence';
import { readRating } from '../src/rating-store';
import { randomFloat } from '../src/random';
import { beginGeneration, retireGeneration } from '../src/site-state';
import { GameWatchers } from '../src/watchers';
import { FakeStreamSocket } from './helpers';

const user = { kind: `user` as const, id: `user-1`, name: `humanplayer` };
const bot = { id: `bot-1`, name: `opponentbot` };
const turnControl = { mode: `turn` as const, turnTimeMs: 5_000 };
const matchControl = { mode: `match` as const, mainTimeMs: 60_000, incrementMs: 2_000 };
const unlimitedControl = { mode: `unlimited` as const };

// The foreign keys need real rows, so every harness seeds the pair once.
function seedPair(query: ReturnType<typeof createQuery>): void {
    const owner = createUserWithExactName(query, `dev:user-1`, `humanplayer`);
    if (owner === `name_taken`) throw new Error(`seed name taken`);
    const created = createBot(query, owner.id, `opponentbot`);
    if (created.kind !== `created`) throw new Error(`seed failed`);
    const row = findBot(query, `opponentbot`);
    if (row === undefined) throw new Error(`seed lookup failed`);
    user.id = owner.id;
    bot.id = row.id;
}

// A random draw of 0.9 makes the human circles: after the origin alone the
// human moves first, and after a three-ply opening the bot does.
const humanCircles = () => 0.9;

class FakeEngineSocket implements EngineSocket {
    readonly sent: string[] = [];
    closed = false;
    closedWith: { code: number | undefined; reason: string | undefined } | null = null;
    // Nothing is ever flushed, so a test sets the backlog it wants.
    bufferedAmount = 0;
    #closeListeners: (() => void)[] = [];

    send(text: string): void {
        this.sent.push(text);
    }

    close(code?: number, reason?: string): void {
        this.closed = true;
        this.closedWith = { code, reason };
    }

    onceClose(listener: () => void): void {
        this.#closeListeners.push(listener);
    }

    emitClose(): void {
        const listeners = this.#closeListeners;
        this.#closeListeners = [];
        for (const listener of listeners) listener();
    }

    packets(): unknown[] {
        return this.sent.map((text) => JSON.parse(text) as unknown);
    }

    moveRequests(): BwsMoveRequestPacket[] {
        return this.packets().filter(
            // The server sends only packet objects, each tagged by type.
            (packet): packet is BwsMoveRequestPacket => (packet as { type?: unknown }).type === `move_request`,
        );
    }

    history(): HtttxPlayedMove[] {
        return this.moveRequests().flatMap((request) => request.previous);
    }

    lastHeartbeat(): BwsHeartbeatPacket | undefined {
        return this.packets()
            // The server sends only packet objects, each tagged by type.
            .filter((packet): packet is BwsHeartbeatPacket => (packet as { type?: unknown }).type === `heartbeat`)
            .at(-1);
    }
}

interface ScriptedTurn {
    readonly side: Side;
    readonly pieces: [HtttxCoord, HtttxCoord];
}

// Scripted turns clear of the opening radius: circles leave gaps along
// r = 4 and never win, crosses fill r = -4 and complete six on their third
// turn.
function circleTurn(index: number): ScriptedTurn {
    return { side: `o`, pieces: [{ q: 4 * index, r: 4 }, { q: 4 * index + 2, r: 4 }] };
}

function crossTurn(index: number): ScriptedTurn {
    return { side: `x`, pieces: [{ q: 2 * index, r: -4 }, { q: 2 * index + 1, r: -4 }] };
}

// An index source that places the given cells in order: each resolves to
// its index among the region cells still empty, and a bound of 18 marks a
// draw restarting from ply 1.
function scriptedCells(cells: readonly Coord[]): (bound: number) => number {
    let taken = new Set<string>();
    let next = 0;
    return (bound) => {
        if (bound === openingRegion.length) taken = new Set<string>();
        const cell = cells[next];
        if (cell === undefined) throw new Error(`the script ran out of cells`);
        next += 1;
        const key = (candidate: Coord) => `${String(candidate.x)},${String(candidate.y)}`;
        const empty = openingRegion.filter((candidate) => !taken.has(key(candidate)));
        const index = empty.findIndex((candidate) => key(candidate) === key(cell));
        if (index < 0) throw new Error(`scripted cell ${key(cell)} is not an empty region cell`);
        taken.add(key(cell));
        return index;
    };
}

interface Harness {
    sqlite: Sqlite;
    presence: PresenceRegistry;
    watchers: GameWatchers;
    games: GameRegistry;
    stream: FakeStreamSocket;
    events: () => StreamEvent[];
    dispose(): void;
}

// The stream socket records every line the bot would receive; presence and
// the registry are wired exactly the way the app wires them.
function harness(random: () => number = randomFloat, randomIndex?: (bound: number) => number): Harness {
    const sqlite = openDatabase(`:memory:`);
    runMigrations(sqlite);
    const query = createQuery(sqlite);
    seedPair(query);
    const presence = new PresenceRegistry();
    const watchers = new GameWatchers();
    const games = new GameRegistry({
        query,
        presence,
        watchers,
        generation: beginGeneration(query),
        random,
        ...(randomIndex !== undefined && { randomIndex }),
    });
    wirePresence(presence, games);
    const stream = new FakeStreamSocket();
    presence.attach(bot.id, stream, true);
    return {
        sqlite,
        presence,
        watchers,
        games,
        stream,
        events: () =>
            stream.writes
                .splice(0)
                .filter((line) => line.trim() !== ``)
                .map((line) => JSON.parse(line) as StreamEvent),
        dispose: () => sqlite.close(),
    };
}

function latestEvent(world: Harness, type: string): StreamEvent | undefined {
    return world
        .events()
        .reverse()
        .find((event) => event.type === type);
}

// The stored opening is the origin and then the server-placed stones in
// placement order, two per turn.
function openingMovesOf(world: Harness, gameId: string): HtttxPlayedMove[] {
    const record = findGame(createQuery(world.sqlite), gameId);
    if (record === undefined) throw new Error(`no record for ${gameId}`);
    const stones = record.opening.slice(1);
    const turns: HtttxPlayedMove[] = [];
    for (let index = 0; index < stones.length; index += 2) {
        const first = stones[index];
        const second = stones[index + 1];
        if (first === undefined || second === undefined) throw new Error(`odd opening in ${gameId}`);
        turns.push({ side: sideOf(first.player), pieces: [internalToWire(first), internalToWire(second)] });
    }
    return turns;
}

describe('game creation', () => {
    let world: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        world = harness();
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    it('places every opening ply from the origin and reports the length on gameStart and the snapshot', () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 5,
        });
        const start = latestEvent(world, `gameStart`);
        expect(created.snapshot.openingPlies).toBe(5);
        expect(created.snapshot.board.cells).toHaveLength(5);
        expect(created.snapshot.board.cells[0]).toEqual({ x: 0, y: 0, side: `x` });
        expect(created.snapshot.board.cells.map((cell) => cell.side)).toEqual([`x`, `o`, `o`, `x`, `x`]);
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        expect(start.openingPlies).toBe(5);
        for (const cell of created.snapshot.board.cells) {
            expect(hexDistance(cell, { x: 0, y: 0 })).toBeLessThanOrEqual(2);
        }
    });

    it('carries the opening length on gameStart and its replay for the origin alone and for nine plies', () => {
        for (const openingPlies of [1, 9] as const) {
            const scripted = harness(humanCircles);
            scripted.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies });
            const start = latestEvent(scripted, `gameStart`);
            const replayed = scripted.games.replayForBot(bot.id).find((event) => event.type === `gameStart`);
            scripted.dispose();
            if (start?.type !== `gameStart` || replayed?.type !== `gameStart`) throw new Error(`no gameStart`);
            expect(start.openingPlies).toBe(openingPlies);
            expect(replayed.openingPlies).toBe(openingPlies);
        }
    });

    it('draws each opening stone as an index over the empty cells within distance 2 of the origin', () => {
        const bounds: number[] = [];
        const scripted = harness(humanCircles, (bound) => {
            bounds.push(bound);
            return bound - 1;
        });
        const created = scripted.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 5,
        });
        scripted.dispose();
        expect(bounds).toEqual([18, 17, 16, 15]);
        const cells = created.snapshot.board.cells.map((cell) => `${String(cell.x)},${String(cell.y)}`);
        expect(new Set(cells).size).toBe(5);
    });

    it('redraws an opening that leaves four circles in a six-cell window without a cross', () => {
        // Circles own plies 1, 2, 5, and 6; the first draw puts all four on
        // the row y = 1, the second lets a cross block it.
        const threat = [
            { x: -2, y: 1 },
            { x: -1, y: 1 },
            { x: 1, y: -1 },
            { x: 2, y: -1 },
            { x: 0, y: 1 },
            { x: 1, y: 1 },
        ];
        const clean = [
            { x: -2, y: 1 },
            { x: -1, y: 1 },
            { x: 0, y: 1 },
            { x: 2, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
        ];
        const scripted = harness(humanCircles, scriptedCells([...threat, ...clean]));
        const created = scripted.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 7,
        });
        scripted.dispose();
        const cells = created.snapshot.board.cells;
        expect(cells.slice(1).map(({ x, y }) => ({ x, y }))).toEqual(clean);
        expect(cells.map((cell) => cell.side)).toEqual([`x`, `o`, `o`, `x`, `x`, `o`, `o`]);
    });

    it('assigns colors by lot and hands the first turn to the bot when it is drawn x', () => {
        const world = harness(() => 0.1);
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        expect(created.snapshot.you).toBe(`x`);
        const replay = world.games.replayForBot(bot.id);
        expect(replay).toHaveLength(2);
        expect(replay[0]?.type).toBe(`gameStart`);
        expect(replay[1]?.type).toBe(`moveRequest`);
    });

    it('carries a short-lived engine session token that every replay rotates', () => {
        world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        const start = latestEvent(world, `gameStart`);
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        expect(start.engine.socketUrl).toBe(`/api/bot/game/${start.gameId}/socket`);
        expect(start.engine.token).toMatch(/^hgs_/);
        const replayed = world.games.replayForBot(bot.id)[0];
        if (replayed?.type !== `gameStart`) throw new Error(`no replay`);
        expect(replayed.engine.token).not.toBe(start.engine.token);
        vi.advanceTimersByTime(sessionTokenTtlMs);
        expect(world.games.claimSession(start.gameId, start.engine.token)).toBeNull();
    });

    it('names each side to the other with the rating it holds now', () => {
        const insert = world.sqlite.prepare(
            `insert into ratings (user_id, bot_id, rating, deviation, volatility) values (?, ?, ?, ?, 0.06)`,
        );
        insert.run(user.id, null, 1234.4, 60);
        insert.run(null, bot.id, 1777.6, 200);
        const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        const start = latestEvent(world, `gameStart`);
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        expect(start.opponent).toEqual({ name: `humanplayer`, rating: 1234, provisional: false });
        const botSide = start.side;
        const humanSide = botSide === `x` ? `o` : `x`;
        expect(created.snapshot.you).toBe(humanSide);
        expect(created.snapshot.players[botSide]).toEqual({ name: `opponentbot`, rating: 1778, provisional: true, kind: `bot` });
        expect(created.snapshot.players[humanSide]).toEqual({ name: `humanplayer`, rating: 1234, provisional: false, kind: `user` });
    });

    it('shows a watcher both seats and no side of its own', () => {
        const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        const stranger = { kind: `user` as const, id: `someone-else` };
        for (const viewer of [null, stranger]) {
            const snapshot = world.games.snapshotFor(created.gameId, viewer);
            expect(snapshot?.status).toBe(`in-progress`);
            expect(snapshot?.you).toBeUndefined();
            expect([snapshot?.players.x.kind, snapshot?.players.o.kind].sort()).toEqual([`bot`, `user`]);
        }
        expect(world.games.snapshotFor(created.gameId, user)?.you).toBe(created.snapshot.you);
    });

    it('shows a guest seat without a rating to watchers, and its side to the guest alone, after the finish too', () => {
        const guest = { kind: `guest` as const, id: `guest-1`, name: `Guest a1b2`, since: Math.floor(Date.now() / 1000) };
        const created = world.games.createGame({ person: guest, bot, timeControl: unlimitedControl, openingPlies: 1 });
        const side = created.snapshot.you;
        if (side === undefined) throw new Error(`the guest holds no seat`);
        const watched = world.games.snapshotFor(created.gameId, null);
        expect(watched?.you).toBeUndefined();
        expect(watched?.players[side]).toEqual({ name: `Guest a1b2`, rating: null, provisional: false, kind: `guest` });
        world.games.humanResign(created.gameId, guest);
        const finished = world.games.snapshotFor(created.gameId, null);
        expect(finished?.status).toBe(`finished`);
        expect(finished?.you).toBeUndefined();
        expect(finished?.players[side]).toEqual({ name: `Guest a1b2`, rating: null, provisional: false, kind: `guest` });
        expect(world.games.snapshotFor(created.gameId, guest)?.you).toBe(side);
        world.games.endGuest(guest.id);
        expect(world.games.snapshotFor(created.gameId, null)?.status).toBe(`finished`);
    });

    it('tells a later holder of the same label from the guest who played, by when each session began', () => {
        const since = Math.floor(Date.now() / 1000);
        const guest = { kind: `guest` as const, id: `guest-1`, name: `Guest a1b2`, since };
        const created = world.games.createGame({ person: guest, bot, timeControl: unlimitedControl, openingPlies: 1 });
        world.games.humanResign(created.gameId, guest);
        const later = { kind: `guest` as const, id: `guest-2`, name: `Guest a1b2`, since: since + 60 };
        expect(world.games.snapshotFor(created.gameId, later)?.you).toBeUndefined();
        expect(world.games.snapshotFor(created.gameId, { kind: `guest`, id: `guest-3`, name: `Guest zzzz`, since })?.you).toBeUndefined();
        expect(world.games.humanResign(created.gameId, later)).toEqual({ kind: `unknown` });
        expect(world.games.humanResign(created.gameId, guest)).toEqual({ kind: `rejected`, code: `game_over` });
    });

    it('answers an unknown game id with nothing', () => {
        expect(world.games.snapshotFor(`g_unknown`, null)).toBeNull();
    });

    it('counts active games per bot for the concurrent cap', () => {
        for (let i = 0; i < 4; i += 1) {
            world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        }
        expect(world.games.activeGameCount(bot.id)).toBe(4);
    });
});

describe('engine session', () => {
    let world: Harness;
    let socket: FakeEngineSocket;
    let gameId: string;
    let token: string;

    beforeEach(() => {
        vi.useFakeTimers();
        // Circles for the human, three opening plies: the bot plays crosses and
        // holds the first turn, so a session attaches straight into a
        // pending request.
        world = harness(humanCircles);
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 3,
        });
        gameId = created.gameId;
        const start = latestEvent(world, `gameStart`);
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        token = start.engine.token;
        socket = new FakeEngineSocket();
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    function connect(): void {
        const attached = world.games.attachSession(gameId, token, socket);
        if (attached === null) throw new Error(`attach failed`);
    }

    function answerBot(turn: ScriptedTurn, via: FakeEngineSocket = socket): void {
        const request = via.moveRequests().at(-1);
        if (request === undefined) throw new Error(`no move_request`);
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(
            claimed.side,
            claimed.game,
            JSON.stringify({ type: `move_response`, move: { pieces: turn.pieces }, request_id: request.request_id }),
        );
    }

    function moveHuman(turn: ScriptedTurn): void {
        const moved = world.games.humanMove(gameId, user, [wireToInternal(turn.pieces[0]), wireToInternal(turn.pieces[1])]);
        if (moved.kind !== `moved`) throw new Error(`human move rejected`);
    }

    it('sends the origin-only setup and the outstanding move request on attach', () => {
        connect();
        const packets = socket.packets();
        const setup = packets[0] as BwsSetupPacket;
        expect(setup.type).toBe(`setup`);
        expect(setup.board.cells).toEqual([{ q: 0, r: 0, p: `x` }]);
        const request = packets[1] as BwsMoveRequestPacket;
        expect(request.type).toBe(`move_request`);
        expect(request.side).toBe(`x`);
        // The opening turn the server placed travels as the first entry of
        // previous, so a standard bot rebuilds the position from the origin.
        expect(request.previous).toHaveLength(1);
        expect(request.previous[0]?.side).toBe(`o`);
        expect(request.move_time_limit).toBeUndefined();
        expect(request.request_id).toBe(1);
    });

    it('drops answers that do not match the outstanding request', () => {
        connect();
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(
            claimed.side,
            claimed.game,
            JSON.stringify({
                type: `move_response`,
                move: { pieces: [{ q: 1, r: 0 }, { q: 2, r: 0 }] },
                request_id: 99,
            }),
        );
        const snapshot = world.games.snapshotFor(gameId, user);
        expect(snapshot?.status).toBe(`in-progress`);
        expect(snapshot?.board.cells).toHaveLength(3);
    });

    it('applies a matching answer and persists the whole game', () => {
        connect();
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(
            claimed.side,
            claimed.game,
            JSON.stringify({
                type: `move_response`,
                move: { pieces: [{ q: 3, r: 0 }, { q: 4, r: 0 }] },
                request_id: 1,
            }),
        );
        const snapshot = world.games.snapshotFor(gameId, user);
        if (snapshot?.status !== `in-progress`) throw new Error(`not in progress`);
        expect(snapshot.board.cells).toHaveLength(5);
        expect(snapshot.toMove).toBe(`o`);
        const finish = world.games.humanResign(gameId, user);
        expect(finish).toMatchObject({ kind: `resigned` });
        const after = world.games.snapshotFor(gameId, user);
        if (after?.status !== `finished`) throw new Error(`not finished`);
        expect(after.board.cells).toHaveLength(5);
        expect(after.reason).toBe(`surrender`);
        expect(after.winner).toBe(`x`);
        expect(after.clock).toBeUndefined();
        expect(after.you).toBe(`o`);
        const watched = world.games.snapshotFor(gameId, null);
        expect(watched).toEqual({ ...after, you: undefined });
        expect(watched && `you` in watched).toBe(false);
        expect(watched?.players.o).toMatchObject({ name: `humanplayer`, kind: `user` });
        expect(watched?.players.x).toMatchObject({ name: `opponentbot`, kind: `bot` });
    });

    it('forfeits an illegal engine move as a termination', () => {
        connect();
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(
            claimed.side,
            claimed.game,
            JSON.stringify({
                type: `move_response`,
                move: { pieces: [{ q: 0, r: 0 }, { q: 1, r: 0 }] },
                request_id: 1,
            }),
        );
        expect(latestEvent(world, `gameFinish`)).toEqual({
            type: `gameFinish`,
            gameId,
            winner: `o`,
            reason: `terminated`,
        });
        expect(socket.closed).toBe(true);
        expect(world.games.activeGameCount(bot.id)).toBe(0);
    });

    it('closes the session on a frame that is not a move response', () => {
        connect();
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(claimed.side, claimed.game, `{not json`);
        expect(socket.closed).toBe(true);
        expect(world.games.snapshotFor(gameId, user)?.status).toBe(`in-progress`);
    });

    it('closes a session that stopped reading with 1008 once its unsent frames pass the backlog limit, forfeiting nothing', () => {
        connect();
        socket.bufferedAmount = streamBacklogLimitBytes;
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(socket.closed).toBe(false);
        socket.bufferedAmount = streamBacklogLimitBytes + 1;
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(socket.closedWith).toEqual({ code: 1008, reason: `not reading` });
        expect(world.games.snapshotFor(gameId, user)?.status).toBe(`in-progress`);
    });

    // This many games or turns take seconds on a loaded machine.
    it(`ends the game at turn ${String(gameTurnCap)} with no winner and rates nobody`, () => {
        connect();
        const ratings = () => {
            const query = createQuery(world.sqlite);
            return [readRating(query, { kind: `human`, id: user.id }), readRating(query, { kind: `bot`, id: bot.id })];
        };
        const before = ratings();
        // Colored by floor((x + 2y) / 2) mod 2,
        // each axis runs in pairs or alternates,
        // so neither side ever holds six in a row;
        // rows swept outward from x = 0, starting clear of the opening,
        // keep every cell within reach of a stone already placed.
        const cells: [Coord[], Coord[]] = [[], []];
        for (let y = 5; y < 45; y += 1) {
            for (let step = 0; step < 30; step += 1) {
                const x = step % 2 === 0 ? step / 2 : -(step + 1) / 2;
                cells[Math.floor((x + 2 * y) / 2) & 1]?.push({ x, y });
            }
        }
        const take = (side: Side): [Coord, Coord] => {
            const own = cells[side === `x` ? 0 : 1];
            const first = own.shift();
            const second = own.shift();
            if (first === undefined || second === undefined) throw new Error(`out of cells`);
            return [first, second];
        };
        const play = () => {
            const snapshot = world.games.snapshotFor(gameId, user);
            if (snapshot?.status !== `in-progress`) throw new Error(`the game is over`);
            const pieces = take(snapshot.toMove);
            if (snapshot.toMove === snapshot.you) {
                const moved = world.games.humanMove(gameId, user, pieces);
                if (moved.kind !== `moved`) throw new Error(`human move rejected`);
            } else {
                answerBot({ side: snapshot.toMove, pieces: [internalToWire(pieces[0]), internalToWire(pieces[1])] });
            }
        };
        for (let turn = 2; turn < gameTurnCap; turn += 1) play();
        expect(world.games.snapshotFor(gameId, user)?.status).toBe(`in-progress`);
        play();
        expect(latestEvent(world, `gameFinish`)).toEqual({ type: `gameFinish`, gameId, winner: null, reason: `terminated` });
        expect(ratings()).toEqual(before);
    }, 30_000);

    it('replaces a stale session when a fresh connection dials in', () => {
        connect();
        const stale = socket;
        const fresh = new FakeEngineSocket();
        world.games.attachSession(gameId, token, fresh);
        expect(stale.closed).toBe(true);
        expect(fresh.packets()[0]).toMatchObject({ type: `setup` });
    });

    it('carries only the turns since the last request, the bot turn first and the human reply second', () => {
        connect();
        answerBot(crossTurn(0));
        moveHuman(circleTurn(0));
        answerBot(crossTurn(1));
        moveHuman(circleTurn(1));
        const requests = socket.moveRequests();
        expect(requests).toHaveLength(3);
        expect(requests[1]?.previous).toEqual([crossTurn(0), circleTurn(0)]);
        expect(requests[2]?.previous).toEqual([crossTurn(1), circleTurn(1)]);
    });

    it('carries the whole log once to a mid-game reattach, then only new turns', () => {
        connect();
        answerBot(crossTurn(0));
        moveHuman(circleTurn(0));
        const fresh = new FakeEngineSocket();
        world.games.attachSession(gameId, token, fresh);
        answerBot(crossTurn(1), fresh);
        moveHuman(circleTurn(1));
        const requests = fresh.moveRequests();
        expect(requests).toHaveLength(2);
        expect(requests[0]?.previous).toEqual([...openingMovesOf(world, gameId), crossTurn(0), circleTurn(0)]);
        expect(requests[1]?.previous).toEqual([crossTurn(1), circleTurn(1)]);
    });

    it('tells a bot facing a human that nothing waits on it while the human moves', () => {
        connect();
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(socket.lastHeartbeat()?.waiting).toBe(true);
        answerBot(crossTurn(0));
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(socket.lastHeartbeat()?.waiting).toBe(false);
    });
});

describe('clocks', () => {
    let world: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        // Circles for the human and the origin alone: the human holds the
        // first turn, so its clock is the one under test.
        world = harness(humanCircles);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    it('forfeits the side to move when a turn clock runs out', async () => {
        const { gameId } = world.games.createGame({
            person: user,
            bot,
            timeControl: turnControl,
            openingPlies: 1,
        });
        await vi.advanceTimersByTimeAsync(5_000);
        expect(latestEvent(world, `gameFinish`)).toEqual({
            type: `gameFinish`,
            gameId,
            winner: `x`,
            reason: `timeout`,
        });
    });

    it('resets the turn budget after every move', async () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: turnControl,
            openingPlies: 1,
        });
        const moved = world.games.humanMove(created.gameId, user, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(moved.kind).toBe(`moved`);
        const request = world.games.replayForBot(bot.id).find((event) => event.type === `moveRequest`);
        if (request?.type !== `moveRequest`) throw new Error(`no moveRequest`);
        expect(request.request.time_limit).toBe(5);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(world.games.snapshotFor(created.gameId, user)?.status).toBe(`in-progress`);
        await vi.advanceTimersByTimeAsync(1);
        expect(latestEvent(world, `gameFinish`)).toMatchObject({ reason: `timeout`, winner: `o` });
    });

    it('deducts main time, adds the increment, and reports both sides', async () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: matchControl,
            openingPlies: 1,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        const moved = world.games.humanMove(created.gameId, user, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        if (moved.kind !== `moved`) throw new Error(`move rejected`);
        expect(moved.snapshot.clock).toEqual({
            mode: `match`,
            remainingMainMs: { x: 60_000, o: 52_000 },
        });
        const request = world.games.replayForBot(bot.id).find((event) => event.type === `moveRequest`);
        if (request?.type !== `moveRequest`) throw new Error(`no moveRequest`);
        expect(request.request.time_limit).toBe(60);
    });

    it('ends an unlimited game at the wall cap with no winner', async () => {
        const { gameId } = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        await vi.advanceTimersByTimeAsync(unlimitedWallCapMs - 1);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(latestEvent(world, `gameFinish`)).toEqual({
            type: `gameFinish`,
            gameId,
            winner: null,
            reason: `terminated`,
        });
        expect(world.games.activeGameCount(bot.id)).toBe(0);
    });
});

describe('orphan rule', () => {
    let world: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        world = harness(humanCircles);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    it('forfeits the games of a bot whose stream stays gone for 30 s', async () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs - 1);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        // The stream is gone, so the forfeit is read back from the record.
        expect(world.games.activeGameCount(bot.id)).toBe(0);
        const snapshot = world.games.snapshotFor(created.gameId, user);
        if (snapshot?.status !== `finished`) throw new Error(`not finished`);
        expect(snapshot.winner).toBe(`o`);
        expect(snapshot.reason).toBe(`disconnect`);
    });

    it('spares the games of a bot that reconnects inside the window', async () => {
        const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs - 1);
        const fresh = new FakeStreamSocket();
        world.presence.attach(bot.id, fresh, true);
        await vi.advanceTimersByTimeAsync(orphanForfeitMs * 2);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        const still = world.games.snapshotFor(created.gameId, user);
        expect(still?.status).toBe(`in-progress`);
    });

    it('aborts unrated instead once the generation of the process is retired', async () => {
        const query = createQuery(world.sqlite);
        const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        const before = readRating(query, { kind: `bot`, id: bot.id });
        retireGeneration(query, 1);
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs);
        const snapshot = world.games.snapshotFor(created.gameId, user);
        if (snapshot?.status !== `finished`) throw new Error(`not finished`);
        expect(snapshot.winner).toBeNull();
        expect(snapshot.reason).toBe(`aborted`);
        expect(readRating(query, { kind: `bot`, id: bot.id })).toEqual(before);
    });

    it('drops every timer on stop, so a late close event arms nothing', async () => {
        world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        world.games.stop();
        expect(world.games.activeGameCount(bot.id)).toBe(0);
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs * 2);
        expect(latestEvent(world, `gameFinish`)).toBeUndefined();
        expect(world.games.replayForBot(bot.id)).toEqual([]);
    });
});

describe('persistence', () => {
    let world: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        world = harness(humanCircles);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    it('answers finished games from the stored log and rejects further moves', () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        const moved = world.games.humanMove(created.gameId, user, [
            { x: 3, y: 0 },
            { x: 4, y: 0 },
        ]);
        expect(moved.kind).toBe(`moved`);
        const resigned = world.games.humanResign(created.gameId, user);
        expect(resigned.kind).toBe(`resigned`);
        const replay = world.games.humanMove(created.gameId, user, [
            { x: 5, y: 0 },
            { x: 6, y: 0 },
        ]);
        expect(replay).toMatchObject({ kind: `rejected`, code: `game_over` });
    });

    // This many games or turns take seconds on a loaded machine.
    it(`keeps the boards of the last ${String(finishedBoardMemoCap)} finished games read, replaying older ones`, () => {
        const finished = (move: boolean) => {
            const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
            if (move) world.games.humanMove(created.gameId, user, [{ x: 3, y: 0 }, { x: 4, y: 0 }]);
            world.games.humanResign(created.gameId, user);
            return created.gameId;
        };
        const stones = (gameId: string) => world.games.snapshotFor(gameId, null)?.board.cells.length;
        const kept = finished(true);
        expect(stones(kept)).toBe(3);
        // Deleting the stored turns tells a remembered board from a replayed one.
        createQuery(world.sqlite).delete(moves).where(eq(moves.gameId, kept)).run();
        expect(stones(kept)).toBe(3);
        for (let index = 0; index < finishedBoardMemoCap; index += 1) stones(finished(false));
        expect(stones(kept)).toBe(1);
    }, 30_000);

    it('stores a guest game whole under the label, and rates nobody, the bot included', () => {
        const guest = { kind: `guest` as const, id: `guest-1`, name: `Guest a1b2`, since: Math.floor(Date.now() / 1000) };
        const created = world.games.createGame({ person: guest, bot, timeControl: unlimitedControl, openingPlies: 1 });
        world.games.humanMove(created.gameId, guest, [
            { x: 3, y: 0 },
            { x: 4, y: 0 },
        ]);
        world.games.humanResign(created.gameId, guest);
        const row = world.sqlite.prepare(`select user_id as userId, guest_name as guest, winner, finish_reason as reason from games where id = ?`).get(created.gameId);
        expect(row).toEqual({ userId: null, guest: `Guest a1b2`, winner: expect.stringMatching(/^[xo]$/u) as string, reason: `surrender` });
        expect(world.sqlite.prepare(`select count(*) as n from moves where game_id = ?`).get(created.gameId)).toEqual({ n: 1 });
        expect(world.sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 0 });
        expect(readRating(createQuery(world.sqlite), { kind: `bot`, id: bot.id }).rating).toBe(1500);
        expect(world.games.headline(created.gameId)).toMatchObject({ status: `finished`, reason: `surrender` });
        expect(Object.values(world.games.headline(created.gameId)?.names ?? {})).toContain(`Guest a1b2`);
    });

    it('names a deleted person and their deleted bot in a stored game by the labels and the mark', () => {
        const created = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 1 });
        world.games.humanResign(created.gameId, user);
        deleteUser(createQuery(world.sqlite), user.id);
        const snapshot = world.games.snapshotFor(created.gameId, null);
        expect(JSON.stringify(snapshot)).not.toMatch(/deleted-[0-9]/u);
        expect([snapshot?.players.x, snapshot?.players.o]).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ name: `deleted player`, kind: `user`, deleted: true }),
                expect.objectContaining({ name: `deleted bot`, kind: `bot`, deleted: true }),
            ]),
        );
        expect(Object.values(world.games.headline(created.gameId)?.names ?? {}).sort()).toEqual([`deleted bot`, `deleted player`]);
    });

    it('rates the person alone when a game against a bot ends with a winner', () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        world.games.humanResign(created.gameId, user);
        const query = createQuery(world.sqlite);
        expect(readRating(query, { kind: `human`, id: user.id }).rating).toBeLessThan(1000);
        expect(readRating(query, { kind: `bot`, id: bot.id }).rating).toBe(1500);
    });

    it('aborts whatever an earlier process left unfinished', () => {
        const created = world.games.createGame({
            person: user,
            bot,
            timeControl: unlimitedControl,
            openingPlies: 1,
        });
        abortUnfinishedGames(createQuery(world.sqlite));
        // The sweep is a boot step: the next process reads with an empty
        // registry, so the record answers on its own.
        const query = createQuery(world.sqlite);
        const restarted = new GameRegistry({
            query,
            presence: new PresenceRegistry(),
            watchers: new GameWatchers(),
            generation: beginGeneration(query),
        });
        const snapshot = restarted.snapshotFor(created.gameId, user);
        if (snapshot?.status !== `finished`) throw new Error(`not finished`);
        expect(snapshot.winner).toBeNull();
        expect(snapshot.reason).toBe(`aborted`);
    });
});

interface Handoff {
    readonly gameId: string;
    readonly side: Side;
    readonly token: string;
}

describe('bot-vs-bot games', () => {
    let world: Harness;
    let challenger: { id: string; name: string };
    let challengerStream: FakeStreamSocket;

    beforeEach(() => {
        vi.useFakeTimers();
        world = harness(humanCircles);
        const query = createQuery(world.sqlite);
        const owner = createUserWithExactName(query, `dev:user-2`, `secondplayer`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        const created = createBot(query, owner.id, `challengerbot`);
        if (created.kind !== `created`) throw new Error(`seed failed`);
        const row = findBot(query, `challengerbot`);
        if (row === undefined) throw new Error(`seed lookup failed`);
        challenger = { id: row.id, name: row.name };
        challengerStream = new FakeStreamSocket();
        world.presence.attach(challenger.id, challengerStream, true);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    function challengerLatest(type: string): StreamEvent | undefined {
        return challengerStream.writes
            .splice(0)
            .filter((line) => line.trim() !== ``)
            .map((line) => JSON.parse(line) as StreamEvent)
            .reverse()
            .find((event) => event.type === type);
    }

    function create(firstPlayer: `challenger` | `challenged` | `random`, openingPlies: OpeningPlies = 1): string {
        return world.games.createBotGame({
            challenger,
            dest: { id: bot.id, name: bot.name },
            timeControl: unlimitedControl,
            openingPlies,
            firstPlayer,
            sameOwner: false,
        }).gameId;
    }

    function gameStartFor(botId: string): Handoff {
        const found = world.games.replayForBot(botId).find((event) => event.type === `gameStart`);
        if (found?.type !== `gameStart`) throw new Error(`no gameStart for ${botId}`);
        return { gameId: found.gameId, side: found.side, token: found.engine.token };
    }

    function moveRequestFrom(socket: FakeEngineSocket): BwsMoveRequestPacket {
        const request = socket.moveRequests()[0];
        if (request === undefined) throw new Error(`no move_request`);
        return request;
    }

    function answer(side: Side, gameId: string, token: string, request: BwsMoveRequestPacket, cells: { q: number; r: number }[]): void {
        const claimed = world.games.claimSession(gameId, token);
        if (claimed === null) throw new Error(`claim failed`);
        world.games.sessionMessage(
            side,
            claimed.game,
            JSON.stringify({
                type: `move_response`,
                move: { pieces: cells },
                request_id: request.request_id,
            }),
        );
    }

    function answerLatest(socket: FakeEngineSocket, seat: Handoff, turn: ScriptedTurn): void {
        const request = socket.moveRequests().at(-1);
        if (request === undefined) throw new Error(`no move_request`);
        answer(seat.side, seat.gameId, seat.token, request, turn.pieces);
    }

    // The challenger takes the first player turn, so after an opening of 1,
    // 5, or 9 plies it sits on o and the other bot on x.
    function seatBoth(openingPlies: OpeningPlies): {
        gameId: string;
        circles: Handoff;
        crosses: Handoff;
        circleSocket: FakeEngineSocket;
        crossSocket: FakeEngineSocket;
    } {
        const gameId = create(`challenger`, openingPlies);
        const crosses = gameStartFor(bot.id);
        const circles = gameStartFor(challenger.id);
        const circleSocket = new FakeEngineSocket();
        const crossSocket = new FakeEngineSocket();
        world.games.attachSession(gameId, circles.token, circleSocket);
        world.games.attachSession(gameId, crosses.token, crossSocket);
        return { gameId, circles, crosses, circleSocket, crossSocket };
    }

    it('lets anyone read a bot-vs-bot game, live and from the log, with both seats as bots', () => {
        const gameId = create(`challenger`);
        const live = world.games.snapshotFor(gameId, null);
        expect(live?.status).toBe(`in-progress`);
        expect(live?.you).toBeUndefined();
        expect([live?.players.x.name, live?.players.o.name].sort()).toEqual([`challengerbot`, `opponentbot`]);
        world.games.abort(gameId);
        const stored = world.games.snapshotFor(gameId, user);
        expect(stored).toMatchObject({ status: `finished`, winner: null, reason: `aborted`, players: live?.players });
        expect(stored?.you).toBeUndefined();
    });

    it('tells both bots a scheduled game started unrated is unrated, and one started rated is rated', () => {
        const [a, b] = [challenger.id, bot.id].sort();
        world.sqlite
            .prepare(
                `insert into duels (id, bot_a_id, bot_b_id, a_first, a_x, test, games, time_control, opening_plies, a_rating, b_rating, rated, created_at) values ('d_abcdefghjkmn', ?, ?, 1, 1, 0, 2, '{"mode":"turn","turnTimeMs":10000}', 5, 1500, 1500, 0, 1)`,
            )
            .run(a, b);
        const play = (game: number, unratedByChoice: boolean) =>
            world.games.createScheduledGame({
                x: challenger,
                o: { id: bot.id, name: bot.name },
                unratedByChoice,
                timeControl: turnControl,
                openingPlies: 1,
                opening: null,
                tag: { kind: `duel`, id: `d_abcdefghjkmn`, game },
            }).gameId;
        const unrated = play(1, true);
        const rated = play(2, false);
        const startOf = (gameId: string, botId: string) => world.games.replayForBot(botId).find((event) => event.type === `gameStart` && event.gameId === gameId);
        for (const botId of [challenger.id, bot.id]) {
            expect(startOf(unrated, botId)).toMatchObject({ type: `gameStart`, rated: false });
            expect(startOf(rated, botId)).toMatchObject({ type: `gameStart`, rated: true });
        }
        expect(world.games.liveEntriesOf([unrated, rated]).map((entry) => [entry.rated, entry.duel])).toEqual([
            [false, { id: `d_abcdefghjkmn`, game: 1, of: 2 }],
            [true, { id: `d_abcdefghjkmn`, game: 2, of: 2 }],
        ]);
        world.games.abort(unrated);
        expect(world.games.snapshotFor(unrated, null)).toMatchObject({ duel: { id: `d_abcdefghjkmn`, game: 1, of: 2 }, unratedByChoice: true });
    });

    it('publishes each turn to watchers, a first-stone win as that stone alone, then the finish', () => {
        const { gameId, circles, crosses, circleSocket, crossSocket } = seatBoth(1);
        const opened = world.games.snapshotFor(gameId, null);
        if (opened === null) throw new Error(`no snapshot`);
        const watcher = new FakeStreamSocket();
        world.watchers.attach(gameId, watcher, false, { event: `snapshot`, data: opened });
        // Crosses leave q = 4 open until their fourth turn, whose first
        // stone then completes q = 0 to 5.
        const crossPieces: [HtttxCoord, HtttxCoord][] = [
            [{ q: 0, r: -4 }, { q: 1, r: -4 }],
            [{ q: 2, r: -4 }, { q: 3, r: -4 }],
            [{ q: 5, r: -4 }, { q: 10, r: -4 }],
            [{ q: 4, r: -4 }, { q: 11, r: -4 }],
        ];
        crossPieces.forEach((pieces, index) => {
            answerLatest(circleSocket, circles, circleTurn(index));
            answerLatest(crossSocket, crosses, { side: `x`, pieces });
        });
        const events = watcher.writes.slice(1).map((frame) => {
            const [event, data] = frame.split(`\n`).map((line) => line.slice(line.indexOf(`: `) + 2));
            return gameEventSchema.parse({ event, data: JSON.parse(data ?? `null`) as unknown });
        });
        const turns = events.flatMap((event) => (event.event === `turn` ? [event.data] : []));
        expect(turns.map((turn) => turn.turn)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(turns.map((turn) => turn.cells.length)).toEqual([2, 2, 2, 2, 2, 2, 2, 1]);
        const board = world.games.snapshotFor(gameId, null)?.board.cells ?? [];
        expect(turns.at(-1)?.cells).toEqual(board.slice(-1).map((cell) => ({ x: cell.x, y: cell.y })));
        expect(events.at(-1)).toEqual({
            event: `finish`,
            data: { winner: `x`, reason: `six-in-a-row`, voided: false, clock: { mode: `unlimited` } },
        });
        expect(watcher.ended).toBe(true);
    });

    it('seats both bots with their own handoff and drives turns across two sessions', () => {
        const gameId = create(`challenger`);
        // Only the side to move carries an outstanding request.
        expect(world.games.replayForBot(challenger.id)).toHaveLength(2);
        expect(world.games.replayForBot(bot.id)).toHaveLength(1);
        // After the origin alone o holds the first turn, and the challenger
        // was named first player, so the challenger sits on o. The captures
        // come last: every replay mints a fresh token.
        const dest = gameStartFor(bot.id);
        expect(dest.side).toBe(`x`);
        const challengerStart = gameStartFor(challenger.id);
        expect(challengerStart.side).toBe(`o`);
        expect(challengerStart.token).not.toBe(dest.token);

        const challengerSocket = new FakeEngineSocket();
        world.games.attachSession(gameId, challengerStart.token, challengerSocket);
        const destSocket = new FakeEngineSocket();
        world.games.attachSession(gameId, dest.token, destSocket);
        const firstRequest = moveRequestFrom(challengerSocket);
        expect(firstRequest.side).toBe(`o`);
        answer(`o`, gameId, challengerStart.token, firstRequest, [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
        ]);
        const secondRequest = moveRequestFrom(destSocket);
        expect(secondRequest.side).toBe(`x`);
        expect(secondRequest.previous).toHaveLength(1);
        expect(world.games.activeGameCount(challenger.id)).toBe(1);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        expect(world.games.activeHumanGameCount(user)).toBe(0);
    });

    it('hands the win to the other side and tells both bots when a move is illegal', () => {
        const gameId = create(`challenger`);
        const challengerStart = gameStartFor(challenger.id);
        const socket = new FakeEngineSocket();
        world.games.attachSession(gameId, challengerStart.token, socket);
        answer(`o`, gameId, challengerStart.token, moveRequestFrom(socket), [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
        ]);
        expect(challengerLatest(`gameFinish`)).toMatchObject({
            gameId,
            winner: `x`,
            reason: `terminated`,
        });
        expect(latestEvent(world, `gameFinish`)).toMatchObject({ winner: `x`, reason: `terminated` });
        expect(socket.closed).toBe(true);
        expect(world.games.activeGameCount(challenger.id)).toBe(0);
        const record = findGame(createQuery(world.sqlite), gameId);
        expect(record).toMatchObject({
            kind: `bots`,
            challengerBotId: challenger.id,
            destBotId: bot.id,
            winner: `x`,
            finishReason: `terminated`,
        });
    });

    it('forfeits to the opponent when one bot vanishes', async () => {
        create(`challenger`);
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs);
        expect(challengerLatest(`gameFinish`)).toMatchObject({
            winner: `o`,
            reason: `disconnect`,
        });
    });

    it('seats the named first player regardless of opening parity', () => {
        create(`challenger`, 3);
        expect(gameStartFor(challenger.id).side).toBe(`x`);
        create(`challenged`, 1);
        expect(gameStartFor(bot.id).side).toBe(`o`);
    });

    it('draws a random first player through the lottery seam', () => {
        create(`random`, 1);
        // The draw is 0.9, past the halfway flip, so the challenger takes
        // the side that does not move first.
        expect(gameStartFor(challenger.id).side).toBe(`x`);
    });

    it('carries only the turns since the last request, the own turn first and the reply second', () => {
        const { circles, crosses, circleSocket, crossSocket } = seatBoth(1);
        answerLatest(circleSocket, circles, circleTurn(0));
        answerLatest(crossSocket, crosses, crossTurn(0));
        answerLatest(circleSocket, circles, circleTurn(1));
        answerLatest(crossSocket, crosses, crossTurn(1));
        answerLatest(circleSocket, circles, circleTurn(2));
        const circleRequests = circleSocket.moveRequests();
        expect(circleRequests).toHaveLength(3);
        expect(circleRequests[1]?.previous).toEqual([circleTurn(0), crossTurn(0)]);
        expect(circleRequests[2]?.previous).toEqual([circleTurn(1), crossTurn(1)]);
        const crossRequests = crossSocket.moveRequests();
        expect(crossRequests).toHaveLength(3);
        expect(crossRequests[1]?.previous).toEqual([crossTurn(0), circleTurn(1)]);
        expect(crossRequests[2]?.previous).toEqual([crossTurn(1), circleTurn(2)]);
    });

    it('delivers the opening turns to each bot exactly once, its own side included', () => {
        const { gameId, circles, crosses, circleSocket, crossSocket } = seatBoth(5);
        answerLatest(circleSocket, circles, circleTurn(0));
        answerLatest(crossSocket, crosses, crossTurn(0));
        answerLatest(circleSocket, circles, circleTurn(1));
        const opening = openingMovesOf(world, gameId);
        expect(opening.map((turn) => turn.side)).toEqual([`o`, `x`]);
        expect(circleSocket.history()).toEqual([...opening, circleTurn(0), crossTurn(0)]);
        expect(crossSocket.history()).toEqual([...opening, circleTurn(0), crossTurn(0), circleTurn(1)]);
    });

    it('concatenates the requests of every session into the turn log from the origin, with no turn twice', () => {
        const { gameId, circles, crosses, circleSocket, crossSocket } = seatBoth(1);
        answerLatest(circleSocket, circles, circleTurn(0));
        answerLatest(crossSocket, crosses, crossTurn(0));
        answerLatest(circleSocket, circles, circleTurn(1));
        const reattached = new FakeEngineSocket();
        world.games.attachSession(gameId, crosses.token, reattached);
        answerLatest(reattached, crosses, crossTurn(1));
        answerLatest(circleSocket, circles, circleTurn(2));
        answerLatest(reattached, crosses, crossTurn(2));
        expect(challengerLatest(`gameFinish`)).toMatchObject({ winner: `x`, reason: `six-in-a-row` });
        const log = [circleTurn(0), crossTurn(0), circleTurn(1), crossTurn(1), circleTurn(2), crossTurn(2)];
        expect(circleSocket.history()).toEqual(log.slice(0, 4));
        expect(crossSocket.history()).toEqual(log.slice(0, 3));
        expect(reattached.history()).toEqual(log.slice(0, 5));
    });

    it('waits on the bot whose turn it is and not on the other', () => {
        const { circleSocket, crossSocket } = seatBoth(1);
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(circleSocket.lastHeartbeat()?.waiting).toBe(true);
        expect(crossSocket.lastHeartbeat()?.waiting).toBe(false);
    });

    it('moves the wait to the other bot once a turn is played', () => {
        const { circles, circleSocket, crossSocket } = seatBoth(1);
        answerLatest(circleSocket, circles, circleTurn(0));
        vi.advanceTimersByTime(sessionHeartbeatMs);
        expect(circleSocket.lastHeartbeat()?.waiting).toBe(false);
        expect(crossSocket.lastHeartbeat()?.waiting).toBe(true);
    });
});

describe('a bot\'s own view', () => {
    let world: Harness;
    let socket: FakeEngineSocket;
    let gameId: string;
    let token: string;
    let live: Map<string, number>;

    beforeEach(() => {
        vi.useFakeTimers();
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const query = createQuery(sqlite);
        seedPair(query);
        const presence = new PresenceRegistry();
        const watchers = new GameWatchers();
        live = new Map();
        const games = new GameRegistry({
            query,
            presence,
            watchers,
            generation: beginGeneration(query),
            random: humanCircles,
            live: {
                update: (id, stones) => live.set(id, stones.length),
                remove: (id) => live.delete(id),
            },
        });
        wirePresence(presence, games);
        const stream = new FakeStreamSocket();
        presence.attach(bot.id, stream, true);
        world = { sqlite, presence, watchers, games, stream, events: () => stream.writes.splice(0).filter((line) => line.trim() !== ``).map((line) => JSON.parse(line) as StreamEvent), dispose: () => sqlite.close() };
        gameId = world.games.createGame({ person: user, bot, timeControl: unlimitedControl, openingPlies: 3 }).gameId;
        const start = latestEvent(world, `gameStart`);
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        token = start.engine.token;
        socket = new FakeEngineSocket();
        if (world.games.attachSession(gameId, token, socket) === null) throw new Error(`attach failed`);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    function answerBot(move: object, considerations?: object[]): void {
        const request = socket.moveRequests().at(-1);
        const claimed = world.games.claimSession(gameId, token);
        if (request === undefined || claimed === null) throw new Error(`no request`);
        world.games.sessionMessage(claimed.side, claimed.game, JSON.stringify({ type: `move_response`, move, ...(considerations === undefined ? {} : { considerations }), request_id: request.request_id }));
    }

    function ownRows(): unknown[] {
        return world.sqlite.prepare(`select seq, rank, heuristic, win_in as winIn from own_lines order by seq, rank`).all();
    }

    it('keeps the evaluation a bot sends with its move and up to two considerations, best first', () => {
        answerBot({ pieces: crossTurn(0).pieces, evaluation: { heuristic: 0.25 } }, [
            { pieces: crossTurn(1).pieces, evaluation: { heuristic: 0.2 } },
            { pieces: crossTurn(2).pieces },
            { pieces: [{ q: 2, r: 2 }, { q: 3, r: 2 }], evaluation: { heuristic: 0.1 } },
            { pieces: [{ q: 2, r: 3 }, { q: 3, r: 3 }], evaluation: { heuristic: 0 } },
        ]);
        expect(ownRows()).toEqual([
            { seq: 1, rank: 0, heuristic: 0.25, winIn: null },
            { seq: 1, rank: 1, heuristic: 0.2, winIn: null },
            { seq: 1, rank: 2, heuristic: 0.1, winIn: null },
        ]);
    });

    it('keeps how the bot\'s heuristic read at its first evaluation of the game, whatever it declares after', () => {
        const declare = world.sqlite.prepare(`update bots set analyzer_max_seconds = 2, analyzer_lines = 1, analyzer_while_playing = 0, analyzer_scale = ?, analyzer_cut_inaccuracy = ?, analyzer_cut_mistake = ?, analyzer_cut_blunder = ?, analyzer_meaning = ? where id = ?`);
        declare.run(1000, 0.1, 0.2, 0.3, `expected`, bot.id);
        answerBot({ pieces: crossTurn(0).pieces, evaluation: { heuristic: 250 } });
        declare.run(1, null, null, null, `raw`, bot.id);
        world.games.humanMove(gameId, user, [wireToInternal(circleTurn(0).pieces[0]), wireToInternal(circleTurn(0).pieces[1])]);
        answerBot({ pieces: crossTurn(1).pieces, evaluation: { heuristic: 300 } });
        expect(ownRows()).toHaveLength(2);
        expect(world.sqlite.prepare(`select game_id as gameId, side, scale, cut_inaccuracy as i, cut_mistake as m, cut_blunder as b, meaning from own_values`).all()).toEqual([
            { gameId, side: `x`, scale: 1000, i: 0.1, m: 0.2, b: 0.3, meaning: `expected` },
        ]);
    });

    it('notes a bot that declared nothing as declaring nothing, so a later declaration never rereads the game', () => {
        answerBot({ pieces: crossTurn(0).pieces, evaluation: { heuristic: 0.25 } });
        expect(world.sqlite.prepare(`select side, scale, cut_blunder as b, meaning from own_values`).all()).toEqual([{ side: `x`, scale: null, b: null, meaning: null }]);
    });

    it('drops a view whose move has no evaluation or a false one, and never forfeits for it', () => {
        answerBot({ pieces: crossTurn(0).pieces }, [{ pieces: crossTurn(1).pieces, evaluation: { heuristic: 0.2 } }]);
        expect(ownRows()).toEqual([]);
        world.games.humanMove(gameId, user, [wireToInternal(circleTurn(0).pieces[0]), wireToInternal(circleTurn(0).pieces[1])]);
        answerBot({ pieces: crossTurn(1).pieces, evaluation: { win_in: 0 } });
        expect(ownRows()).toEqual([]);
        expect(world.sqlite.prepare(`select count(*) as n from own_values`).get()).toEqual({ n: 0 });
        expect(world.games.isLive(gameId)).toBe(true);
    });

    it('keeps the live guard on each game\'s latest board, from its start to its finish', () => {
        expect(live.get(gameId)).toBe(3);
        answerBot({ pieces: crossTurn(0).pieces });
        expect(live.get(gameId)).toBe(5);
        world.games.abort(gameId);
        expect(live.has(gameId)).toBe(false);
    });
});
