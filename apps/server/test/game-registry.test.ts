import type { BwsMoveRequestPacket, BwsSetupPacket, Side, StreamEvent } from '@hexarena/contract';
import { hexDistance } from '@hexarena/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQuery, openDatabase, runMigrations, type Sqlite } from '../src/db';
import { createBot, findBot } from '../src/bots';
import { createUserWithExactName } from '../src/users';
import { abortUnfinishedGames, findGame } from '../src/game-store';
import {
    GameRegistry,
    orphanForfeitMs,
    sessionTokenTtlMs,
    unlimitedWallCapMs,
    wirePresence,
    type EngineSocket,
} from '../src/game-registry';
import { PresenceRegistry } from '../src/presence';
import { randomFloat } from '../src/random';
import { FakeStreamSocket } from './helpers';

const user = { id: `user-1`, name: `humanplayer` };
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

// A random draw of 0.9 makes the human circles: with no opening stones the
// human moves first, and with one opening pair the bot does.
const humanCircles = () => 0.9;

class FakeEngineSocket implements EngineSocket {
    readonly sent: string[] = [];
    closed = false;
    #closeListeners: (() => void)[] = [];

    send(text: string): void {
        this.sent.push(text);
    }

    close(): void {
        this.closed = true;
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
}

interface Harness {
    sqlite: Sqlite;
    presence: PresenceRegistry;
    games: GameRegistry;
    stream: FakeStreamSocket;
    events: () => StreamEvent[];
    dispose(): void;
}

// The stream socket records every line the bot would receive; presence and
// the registry are wired exactly the way the app wires them.
function harness(random: () => number = randomFloat): Harness {
    const sqlite = openDatabase(`:memory:`);
    runMigrations(sqlite);
    const query = createQuery(sqlite);
    seedPair(query);
    const presence = new PresenceRegistry();
    const games = new GameRegistry({ query, presence, random });
    wirePresence(presence, games);
    const stream = new FakeStreamSocket();
    presence.attach(bot.id, stream, true);
    return {
        sqlite,
        presence,
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

    it('places the origin and the opening stones and reports them as turns', () => {
        const created = world.games.createGame({
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 4,
        });
        const start = latestEvent(world, `gameStart`);
        expect(created.snapshot.board.cells).toHaveLength(5);
        expect(created.snapshot.board.cells[0]).toEqual({ x: 0, y: 0, side: `x` });
        if (start?.type !== `gameStart`) throw new Error(`no gameStart`);
        expect(start.opening).toEqual({ randomTurns: 2 });
        for (const cell of created.snapshot.board.cells) {
            expect(hexDistance(cell, { x: 0, y: 0 })).toBeLessThanOrEqual(2);
        }
    });

    it('assigns colors by lot and hands the first turn to the bot when it is drawn x', () => {
        const world = harness(() => 0.1);
        const created = world.games.createGame({
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 0,
        });
        expect(created.snapshot.you).toBe(`x`);
        const replay = world.games.replayForBot(bot.id);
        expect(replay).toHaveLength(2);
        expect(replay[0]?.type).toBe(`gameStart`);
        expect(replay[1]?.type).toBe(`moveRequest`);
    });

    it('carries a short-lived engine session token that every replay rotates', () => {
        world.games.createGame({ user, bot, timeControl: unlimitedControl, openingStones: 0 });
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

    it('counts active games per bot for the concurrent cap', () => {
        for (let i = 0; i < 4; i += 1) {
            world.games.createGame({ user, bot, timeControl: unlimitedControl, openingStones: 0 });
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
        // Circles for the human, one opening pair: the bot plays crosses and
        // holds the first turn, so a session attaches straight into a
        // pending request.
        world = harness(humanCircles);
        const created = world.games.createGame({
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 2,
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

    it('sends the origin-only setup and the outstanding move request on attach', () => {
        connect();
        const packets = socket.packets();
        const setup = packets[0] as BwsSetupPacket;
        expect(setup.type).toBe(`setup`);
        expect(setup.board.cells).toEqual([{ q: 0, r: 0, p: `x` }]);
        const request = packets[1] as BwsMoveRequestPacket;
        expect(request.type).toBe(`move_request`);
        expect(request.side).toBe(`x`);
        // The opening pair the server placed travels as the first entry of
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
        const snapshot = world.games.snapshotFor(gameId)?.snapshot;
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
        const snapshot = world.games.snapshotFor(gameId)?.snapshot;
        if (snapshot?.status !== `in-progress`) throw new Error(`not in progress`);
        expect(snapshot.board.cells).toHaveLength(5);
        expect(snapshot.toMove).toBe(`o`);
        const finish = world.games.humanResign(gameId, user.id);
        expect(finish).toMatchObject({ kind: `resigned` });
        const after = world.games.snapshotFor(gameId)?.snapshot;
        if (after?.status !== `finished`) throw new Error(`not finished`);
        expect(after.board.cells).toHaveLength(5);
        expect(after.reason).toBe(`surrender`);
        expect(after.winner).toBe(`x`);
        expect(after.clock).toBeUndefined();
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
        expect(world.games.snapshotFor(gameId)?.snapshot.status).toBe(`in-progress`);
    });

    it('replaces a stale session when a fresh connection dials in', () => {
        connect();
        const stale = socket;
        const fresh = new FakeEngineSocket();
        world.games.attachSession(gameId, token, fresh);
        expect(stale.closed).toBe(true);
        expect(fresh.packets()[0]).toMatchObject({ type: `setup` });
    });
});

describe('clocks', () => {
    let world: Harness;

    beforeEach(() => {
        vi.useFakeTimers();
        // Circles for the human and no opening stones: the human holds the
        // first turn, so its clock is the one under test.
        world = harness(humanCircles);
    });

    afterEach(() => {
        world.dispose();
        vi.useRealTimers();
    });

    it('forfeits the side to move when a turn clock runs out', async () => {
        const { gameId } = world.games.createGame({
            user,
            bot,
            timeControl: turnControl,
            openingStones: 0,
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
            user,
            bot,
            timeControl: turnControl,
            openingStones: 0,
        });
        const moved = world.games.humanMove(created.gameId, user.id, [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
        ]);
        expect(moved.kind).toBe(`moved`);
        const request = world.games.replayForBot(bot.id).find((event) => event.type === `moveRequest`);
        if (request?.type !== `moveRequest`) throw new Error(`no moveRequest`);
        expect(request.request.time_limit).toBe(5);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(world.games.snapshotFor(created.gameId)?.snapshot.status).toBe(`in-progress`);
        await vi.advanceTimersByTimeAsync(1);
        expect(latestEvent(world, `gameFinish`)).toMatchObject({ reason: `timeout`, winner: `o` });
    });

    it('deducts main time, adds the increment, and reports both sides', async () => {
        const created = world.games.createGame({
            user,
            bot,
            timeControl: matchControl,
            openingStones: 0,
        });
        await vi.advanceTimersByTimeAsync(10_000);
        const moved = world.games.humanMove(created.gameId, user.id, [
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
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 0,
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
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 0,
        });
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs - 1);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        // The stream is gone, so the forfeit is read back from the record.
        expect(world.games.activeGameCount(bot.id)).toBe(0);
        const snapshot = world.games.snapshotFor(created.gameId)?.snapshot;
        if (snapshot?.status !== `finished`) throw new Error(`not finished`);
        expect(snapshot.winner).toBe(`o`);
        expect(snapshot.reason).toBe(`disconnect`);
    });

    it('spares the games of a bot that reconnects inside the window', async () => {
        const created = world.games.createGame({ user, bot, timeControl: unlimitedControl, openingStones: 0 });
        world.stream.emitClose();
        await vi.advanceTimersByTimeAsync(orphanForfeitMs - 1);
        const fresh = new FakeStreamSocket();
        world.presence.attach(bot.id, fresh, true);
        await vi.advanceTimersByTimeAsync(orphanForfeitMs * 2);
        expect(world.games.activeGameCount(bot.id)).toBe(1);
        const still = world.games.snapshotFor(created.gameId)?.snapshot;
        expect(still?.status).toBe(`in-progress`);
    });

    it('drops every timer on stop, so a late close event arms nothing', async () => {
        world.games.createGame({ user, bot, timeControl: unlimitedControl, openingStones: 0 });
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
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 0,
        });
        const moved = world.games.humanMove(created.gameId, user.id, [
            { x: 3, y: 0 },
            { x: 4, y: 0 },
        ]);
        expect(moved.kind).toBe(`moved`);
        const resigned = world.games.humanResign(created.gameId, user.id);
        expect(resigned.kind).toBe(`resigned`);
        const replay = world.games.humanMove(created.gameId, user.id, [
            { x: 5, y: 0 },
            { x: 6, y: 0 },
        ]);
        expect(replay).toMatchObject({ kind: `rejected`, code: `game_over` });
    });

    it('aborts whatever an earlier process left unfinished', () => {
        const created = world.games.createGame({
            user,
            bot,
            timeControl: unlimitedControl,
            openingStones: 0,
        });
        abortUnfinishedGames(createQuery(world.sqlite));
        // The sweep is a boot step: the next process reads with an empty
        // registry, so the record answers on its own.
        const restarted = new GameRegistry({
            query: createQuery(world.sqlite),
            presence: new PresenceRegistry(),
        });
        const snapshot = restarted.snapshotFor(created.gameId)?.snapshot;
        if (snapshot?.status !== `finished`) throw new Error(`not finished`);
        expect(snapshot.winner).toBeNull();
        expect(snapshot.reason).toBe(`aborted`);
    });
});
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

    function create(firstPlayer: `challenger` | `challenged` | `random`, openingStones = 0): string {
        return world.games.createBotGame({
            challenger,
            dest: { id: bot.id, name: bot.name },
            timeControl: unlimitedControl,
            openingStones,
            firstPlayer,
        }).gameId;
    }

    function gameStartFor(botId: string): { gameId: string; side: Side; token: string } {
        const found = world.games.replayForBot(botId).find((event) => event.type === `gameStart`);
        if (found?.type !== `gameStart`) throw new Error(`no gameStart for ${botId}`);
        return { gameId: found.gameId, side: found.side, token: found.engine.token };
    }

    function moveRequestFrom(socket: FakeEngineSocket): BwsMoveRequestPacket {
        const request = socket
            .packets()
            .find((packet): packet is BwsMoveRequestPacket => (packet as { type?: unknown }).type === `move_request`);
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

    it('seats both bots with their own handoff and drives turns across two sessions', () => {
        const gameId = create(`challenger`);
        // Only the side to move carries an outstanding request.
        expect(world.games.replayForBot(challenger.id)).toHaveLength(2);
        expect(world.games.replayForBot(bot.id)).toHaveLength(1);
        // With no opening stones o holds the first turn, and the challenger
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
        expect(world.games.activeHumanGameCount(user.id)).toBe(0);
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
        create(`challenger`, 2);
        expect(gameStartFor(challenger.id).side).toBe(`x`);
        create(`challenged`, 0);
        expect(gameStartFor(bot.id).side).toBe(`o`);
    });

    it('draws a random first player through the lottery seam', () => {
        create(`random`, 0);
        // The draw is 0.9, past the halfway flip, so the challenger takes
        // the side that does not move first.
        expect(gameStartFor(challenger.id).side).toBe(`x`);
    });
});
