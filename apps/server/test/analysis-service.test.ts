import {
    analysisQueueExpiryMs,
    internalToWire,
    positionHoldMs,
    positionReadingsPerUserDay,
    wireToInternal,
    type CommunityAnalysis,
    type HtttxCell,
} from '@hexo-arena/contract';
import type { Setup } from '@hexo-arena/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisService } from '../src/analysis-service';
import { AnalyzerSessions } from '../src/analyzers';
import { createQuery, type Query, type Sqlite } from '../src/db';
import type { EngineSocket } from '../src/game-registry';
import { insertOwnLines } from '../src/analysis-store';
import { insertBotGame, insertGame, insertMove, recordFinish } from '../src/game-store';
import { migratedDatabase } from './helpers';

class FakeSocket implements EngineSocket {
    readonly sent: Record<string, unknown>[] = [];
    bufferedAmount = 0;
    #listeners: (() => void)[] = [];

    send(text: string): void {
        // Every packet the sessions send is a JSON object.
        this.sent.push(JSON.parse(text) as Record<string, unknown>);
    }

    close(): void {
        const listeners = this.#listeners;
        this.#listeners = [];
        for (const listener of listeners) listener();
    }

    onceClose(listener: () => void): void {
        this.#listeners.push(listener);
    }

    last(type: string): Record<string, unknown> | undefined {
        return this.sent.filter((packet) => packet[`type`] === type).at(-1);
    }

    count(type: string): number {
        return this.sent.filter((packet) => packet[`type`] === type).length;
    }
}

// A quiet board, x to move: no window of four.
const board: Setup = {
    stones: [
        { x: 0, y: 0, player: 0 },
        { x: 3, y: 0, player: 1 },
        { x: 0, y: 3, player: 1 },
    ],
    toMove: 0,
};

const unlimited = { mode: `unlimited` } as const;

// Stones three cells apart, so no side ever holds a window to complete.
const quietMoves: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
    [
        [3, 0],
        [0, 3],
    ],
    [
        [-3, 0],
        [0, -3],
    ],
    [
        [3, 3],
        [-3, 3],
    ],
    [
        [6, 0],
        [-6, 0],
    ],
];

interface World {
    sqlite: Sqlite;
    query: Query;
    sessions: AnalyzerSessions;
    service: AnalysisService;
    sockets: Map<string, FakeSocket>;
    live: Set<string>;
}

let now = 0;
let world: World;

function seed(sqlite: Sqlite): void {
    sqlite.exec(`
        insert into name_reservations (name_key) values ('asker'), ('owner-a'), ('owner-b'), ('owner-c'), ('owner-d'), ('player'), ('alpha'), ('beta'), ('kestrel'), ('driftwood');
        insert into users (id, discord_id, name, name_key, created_at) values
            ('asker', 'd1', 'asker', 'asker', 1), ('owner-a', 'd2', 'owner-a', 'owner-a', 1), ('owner-b', 'd3', 'owner-b', 'owner-b', 1),
            ('owner-c', 'd4', 'owner-c', 'owner-c', 1), ('owner-d', 'd5', 'owner-d', 'owner-d', 1), ('player', 'd6', 'player', 'player', 1);
        insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, version, analyzer_max_seconds, analyzer_lines, analyzer_while_playing) values
            ('alpha', 'owner-a', 'alpha', 'alpha', 'h1', 'bot:play', 1, null, null, null, null),
            ('beta', 'owner-b', 'beta', 'beta', 'h2', 'bot:play', 1, null, null, null, null),
            ('kestrel', 'owner-c', 'kestrel', 'kestrel', 'h3', 'bot:play', 1, '0.9', 5, 2, 0),
            ('driftwood', 'owner-d', 'driftwood', 'driftwood', 'h4', 'bot:play', 1, null, 2, 1, 1);
    `);
}

function build(query: Query, sqlite: Sqlite, live = new Set<string>()): World {
    const sessions = new AnalyzerSessions({ online: () => false, mayAnalyze: () => true, send: () => undefined, now: () => now });
    const service = new AnalysisService({
        query,
        analyzers: sessions,
        games: { activeGameCount: (botId) => (live.has(botId) ? 1 : 0), isLive: () => false },
        now: () => now,
    });
    return { sqlite, query, sessions, service, sockets: new Map(), live };
}

function dial(botId: string): FakeSocket {
    const socket = new FakeSocket();
    world.sockets.set(botId, socket);
    world.sessions.attach(botId, socket);
    return socket;
}

// Answers the analyzer's outstanding request with two empty cells beside the board's rightmost stone.
function answer(botId: string, evaluation: object = { heuristic: 0.1 }, considered = false): void {
    const socket = world.sockets.get(botId);
    const setup = socket?.last(`setup`) as { board: { cells: HtttxCell[] } } | undefined;
    const request = socket?.last(`move_request`);
    if (socket === undefined || setup === undefined || request === undefined) throw new Error(`no request for ${botId}`);
    const stones = setup.board.cells.map((cell) => wireToInternal(cell));
    const right = stones.reduce((best, stone) => (stone.x > best.x ? stone : best));
    const cells = [
        { x: right.x + 2, y: right.y },
        { x: right.x + 2, y: right.y + 4 },
    ];
    const considerations = considered ? [{ pieces: [{ x: right.x + 2, y: right.y }, { x: right.x + 3, y: right.y }].map((cell) => internalToWire(cell)), evaluation: { heuristic: 0 } }] : [];
    world.sessions.message(botId, socket, JSON.stringify({ type: `move_response`, move: { pieces: cells.map((cell) => internalToWire(cell)), evaluation }, considerations, request_id: request[`request_id`] }));
}

function playedGame(query: Query, seats: { challenger: string; dest: string } | { user: string; bot: string }): string {
    const opening = [{ x: 0, y: 0, player: 0 as const }];
    const gameId =
        `user` in seats
            ? insertGame(query, { userId: seats.user, botId: seats.bot, userSide: `x`, timeControl: unlimited, opening })
            : insertBotGame(query, { challengerBotId: seats.challenger, destBotId: seats.dest, challengerSide: `x`, timeControl: unlimited, opening });
    quietMoves.forEach(([first, second], index) => {
        insertMove(query, { gameId, seq: index + 1, side: index % 2 === 0 ? `o` : `x`, cells: [{ x: first[0], y: first[1] }, { x: second[0], y: second[1] }] });
    });
    recordFinish(query, gameId, { winner: `x`, reason: `surrender` });
    return gameId;
}

const never = new AbortController().signal;

async function settled(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

beforeEach(() => {
    vi.useFakeTimers();
    now = Date.UTC(2026, 9, 2, 12);
    const sqlite = migratedDatabase();
    seed(sqlite);
    world = build(createQuery(sqlite), sqlite);
});

afterEach(() => {
    world.service.stop();
    world.sessions.stop();
    world.sqlite.close();
    vi.useRealTimers();
});

describe('position readings', () => {
    it('reads on an idle analyzer, then serves the same position from memory for nothing', async () => {
        dial(`kestrel`);
        const asked = world.service.requestPosition(`asker`, { setup: board, analyzer: null, lines: 2, seconds: 2 }, never);
        expect(world.sockets.get(`kestrel`)?.last(`move_request`)).toMatchObject({ side: `x`, previous: [], move_time_limit: 2 });
        now += 1_500;
        answer(`kestrel`);
        const first = await asked;
        expect(first).toMatchObject({ kind: `reading`, reading: { status: `done`, analyzer: { name: `kestrel`, version: `0.9`, ownerName: `owner-c` }, seconds: 2, elapsedMs: 1_500, cached: false, left: positionReadingsPerUserDay - 1 } });
        const again = await world.service.requestPosition(`asker`, { setup: board, analyzer: `kestrel`, lines: 2, seconds: 1 }, never);
        expect(again).toMatchObject({ kind: `reading`, reading: { status: `done`, cached: true, left: positionReadingsPerUserDay - 1 } });
        expect(world.sockets.get(`kestrel`)?.count(`move_request`)).toBe(1);
    });

    it('answers the lines asked for from a reading that holds more', async () => {
        dial(`kestrel`);
        const asked = world.service.requestPosition(`asker`, { setup: board, analyzer: null, lines: 1, seconds: 2 }, never);
        answer(`kestrel`, { heuristic: 0.1 }, true);
        expect(await asked).toMatchObject({ reading: { status: `done`, lines: [{ heuristic: 0.1 }] } });
        const more = await world.service.requestPosition(`asker`, { setup: board, analyzer: null, lines: 3, seconds: 2 }, never);
        expect(more).toMatchObject({ reading: { status: `done`, cached: true, lines: [{ heuristic: 0.1 }, { heuristic: 0 }] } });
    });

    it('answers queued once the hold runs out, and the same ask waits on the same request', async () => {
        dial(`kestrel`);
        const busy = world.service.requestPosition(`player`, { setup: board, analyzer: null, lines: 1, seconds: 5 }, never);
        const other: Setup = { ...board, toMove: 1 };
        const asked = world.service.requestPosition(`asker`, { setup: other, analyzer: null, lines: 1, seconds: 5 }, never);
        vi.advanceTimersByTime(7_000);
        answer(`kestrel`);
        await busy;
        await settled();
        vi.advanceTimersByTime(positionHoldMs - 7_000);
        const analyzer = { name: `kestrel`, version: `0.9`, ownerName: `owner-c`, values: { scale: 1, cuts: null, meaning: `raw` } };
        expect(await asked).toEqual({ kind: `reading`, reading: { status: `queued`, ahead: 0, analyzer, left: positionReadingsPerUserDay - 1 } });
        answer(`kestrel`);
        await settled();
        const again = await world.service.requestPosition(`asker`, { setup: other, analyzer: null, lines: 1, seconds: 5 }, never);
        expect(again).toMatchObject({ kind: `reading`, reading: { status: `done`, cached: false } });
        expect(world.sockets.get(`kestrel`)?.count(`move_request`)).toBe(2);
    });

    it('lets an unsent ask go free when its asker asks for another or hangs up, and calls off one in flight', async () => {
        const kestrel = dial(`kestrel`);
        const busy = world.service.requestPosition(`player`, { setup: board, analyzer: `kestrel`, lines: 1, seconds: 2 }, never);
        const other: Setup = { ...board, toMove: 1 };
        const first = world.service.requestPosition(`asker`, { setup: other, analyzer: `kestrel`, lines: 1, seconds: 2 }, never);
        const second = world.service.requestPosition(`asker`, { setup: board, analyzer: `kestrel`, lines: 1, seconds: 2 }, never);
        expect(await first).toEqual({ kind: `refused`, code: `superseded` });
        expect(world.service.positionsLeft(`asker`)).toBe(positionReadingsPerUserDay);
        const hangUp = new AbortController();
        const third = world.service.requestPosition(`asker`, { setup: { ...board, stones: [...board.stones, { x: 9, y: 0, player: 0 }] }, analyzer: `kestrel`, lines: 1, seconds: 2 }, hangUp.signal);
        expect(await second).toEqual({ kind: `refused`, code: `superseded` });
        hangUp.abort();
        await third;
        answer(`kestrel`);
        expect(await busy).toMatchObject({ reading: { status: `done` } });
        expect(kestrel.count(`move_request`)).toBe(1);
        const inFlight = new AbortController();
        void world.service.requestPosition(`asker`, { setup: other, analyzer: `kestrel`, lines: 1, seconds: 2 }, inFlight.signal);
        await settled();
        expect(kestrel.count(`move_request`)).toBe(2);
        inFlight.abort();
        expect(kestrel.last(`interrupt`)).toMatchObject({ request_id: 2 });
    });

    it('refuses when no analyzer may read, or the named one is unknown, benched, or in a game it does not read during', async () => {
        expect(await world.service.requestPosition(`asker`, { setup: board, analyzer: null, lines: 1, seconds: 2 }, never)).toEqual({ kind: `refused`, code: `no_analyzer` });
        dial(`kestrel`);
        expect(await world.service.requestPosition(`asker`, { setup: board, analyzer: `nobody`, lines: 1, seconds: 2 }, never)).toEqual({ kind: `refused`, code: `no_analyzer` });
        world.live.add(`kestrel`);
        expect(await world.service.requestPosition(`asker`, { setup: board, analyzer: `kestrel`, lines: 1, seconds: 2 }, never)).toEqual({ kind: `refused`, code: `no_analyzer` });
        world.live.delete(`kestrel`);
        for (let failure = 0; failure < 3; failure += 1) {
            const asked = world.service.requestPosition(`asker`, { setup: { ...board, stones: [...board.stones, { x: -9 - failure, y: 0, player: 0 }] }, analyzer: `kestrel`, lines: 1, seconds: 2 }, never);
            answer(`kestrel`, {});
            expect(await asked).toMatchObject({ reading: { status: `failed`, failure: `no_evaluation`, left: positionReadingsPerUserDay } });
        }
        expect(await world.service.requestPosition(`asker`, { setup: board, analyzer: `kestrel`, lines: 1, seconds: 2 }, never)).toEqual({ kind: `refused`, code: `no_analyzer` });
    });

    it('sends the ask back to the queue, free, when its analyzer starts a game it does not read during', async () => {
        const kestrel = dial(`kestrel`);
        const asked = world.service.requestPosition(`asker`, { setup: board, analyzer: null, lines: 1, seconds: 2 }, never);
        world.live.add(`kestrel`);
        world.service.gameStarted([`kestrel`]);
        await settled();
        expect(kestrel.last(`interrupt`)).toMatchObject({ request_id: 1 });
        expect(world.service.positionsLeft(`asker`)).toBe(positionReadingsPerUserDay);
        const driftwood = dial(`driftwood`);
        await settled();
        expect(driftwood.count(`move_request`)).toBe(1);
        answer(`driftwood`);
        expect(await asked).toMatchObject({ reading: { status: `done`, analyzer: { name: `driftwood` }, seconds: 2 } });
    });
});

describe('whole-game readings', () => {
    async function readAll(botId: string, evaluation?: object): Promise<void> {
        for (let position = 0; position < 5; position += 1) {
            await settled();
            answer(botId, evaluation);
        }
        await settled();
    }

    it('reads each position after the opening on one analyzer, then stores the reading and lists it', async () => {
        dial(`kestrel`);
        const gameId = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        const requested = world.service.requestGame(`asker`, gameId, null);
        expect(requested).toMatchObject({ kind: `queued`, analysis: { kind: `community`, status: `queued`, analyzer: null, progress: { done: 0, of: 5 }, seconds: 2 } });
        await settled();
        answer(`kestrel`);
        await settled();
        const running = world.service.list(gameId);
        now += 1_000;
        expect(running).toMatchObject({ kind: `list`, list: { analyses: [{ status: `running`, analyzer: { name: `kestrel` }, progress: { done: 1, of: 5 } }] } });
        await readAll(`kestrel`);
        now += 1_000;
        const listed = world.service.list(gameId);
        if (listed.kind !== `list`) throw new Error(`no list`);
        const [reading] = listed.list.analyses as CommunityAnalysis[];
        expect(reading).toMatchObject({ status: `done`, progress: { done: 5, of: 5 } });
        expect(reading?.turns.map((turn) => [turn.turn, turn.toMove])).toEqual([
            [1, `o`],
            [2, `x`],
            [3, `o`],
            [4, `x`],
            [5, `o`],
        ]);
        expect(world.service.requestGame(`asker`, gameId, `kestrel`)).toMatchObject({ kind: `refused`, code: `no_analyzer` });
    });

    it('lists a reading and its analyzer with the values the analyzer declared when it took the game, whatever it declares after', async () => {
        const declare = world.sqlite.prepare(`update bots set analyzer_scale = ?, analyzer_cut_inaccuracy = ?, analyzer_cut_mistake = ?, analyzer_cut_blunder = ?, analyzer_meaning = ? where id = 'kestrel'`);
        declare.run(1000, 0.1, 0.2, 0.3, `expected`);
        dial(`kestrel`);
        const gameId = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        world.service.requestGame(`asker`, gameId, null);
        await settled();
        declare.run(null, null, null, null, null);
        const declared = { scale: 1000, cuts: { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 }, meaning: `expected` };
        expect(world.service.list(gameId)).toMatchObject({ kind: `list`, list: { analyses: [{ status: `running`, analyzer: { name: `kestrel`, values: declared } }] } });
        await readAll(`kestrel`);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ kind: `list`, list: { analyses: [{ status: `done`, analyzer: { name: `kestrel`, values: declared } }] } });
        world.sqlite.exec(`update analyses set analyzer_scale = null, analyzer_cut_inaccuracy = null, analyzer_cut_mistake = null, analyzer_cut_blunder = null, analyzer_meaning = null`);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ kind: `list`, list: { analyses: [{ analyzer: { values: { scale: 1, cuts: null, meaning: `raw` } } }] } });
    });

    it('lists each bot seat\'s own view with the values its declaration held at the seat\'s first evaluation', () => {
        world.sqlite.exec(`update bots set analyzer_max_seconds = 2, analyzer_lines = 1, analyzer_while_playing = 0, analyzer_scale = 1000, analyzer_meaning = 'expected' where id = 'alpha'`);
        const gameId = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        const line = { cells: [{ x: 9, y: 9 }, { x: 9, y: 10 }], heuristic: 120 };
        insertOwnLines(world.query, { gameId, seq: 2, side: `x`, botId: `alpha` }, [line]);
        world.sqlite.exec(`update bots set analyzer_scale = 50, analyzer_meaning = 'raw' where id = 'alpha'`);
        insertOwnLines(world.query, { gameId, seq: 4, side: `x`, botId: `alpha` }, [line]);
        insertOwnLines(world.query, { gameId, seq: 1, side: `o`, botId: `beta` }, [{ ...line, heuristic: -0.2 }]);
        const listed = world.service.list(gameId);
        if (listed.kind !== `list`) throw new Error(`no list`);
        expect(listed.list.analyses.map((view) => (view.kind === `own` ? [view.side, view.values, view.turns.length] : null))).toEqual([
            [`x`, { scale: 1000, cuts: null, meaning: `expected` }, 2],
            [`o`, { scale: 1, cuts: null, meaning: `raw` }, 1],
        ]);
    });

    it('retries a timed-out position once, then moves to another analyzer, and fails when both did', async () => {
        dial(`kestrel`);
        dial(`driftwood`);
        world.live.add(`driftwood`);
        world.service.dispatch();
        const gameId = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        world.service.requestGame(`asker`, gameId, null);
        await settled();
        vi.advanceTimersByTime(5_000 + 3_000);
        await settled();
        expect(world.sockets.get(`kestrel`)?.count(`move_request`)).toBe(2);
        answer(`kestrel`, {});
        await settled();
        world.live.delete(`driftwood`);
        world.service.dispatch();
        await settled();
        expect(world.sockets.get(`driftwood`)?.count(`move_request`)).toBe(1);
        answer(`driftwood`, { heuristic: 7e6 });
        await settled();
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { analyses: [{ status: `failed`, failure: `inconsistent`, failedTurn: 1, analyzer: { name: `driftwood` } }] } });
    });

    it('lets an analyzer read a game its owner played, marks the reading involved as it takes it, and keeps that mark whatever changes after', async () => {
        const kestrel = dial(`kestrel`);
        const own = playedGame(world.query, { user: `owner-c`, bot: `alpha` });
        expect(world.service.requestGame(`asker`, own, null)).toMatchObject({ kind: `queued`, analysis: { analyzer: null, involved: false } });
        expect(world.service.requestGame(`player`, own, null)).toEqual({ kind: `refused`, code: `analysis_pending` });
        await settled();
        expect(kestrel.count(`move_request`)).toBe(1);
        expect(world.service.list(own)).toMatchObject({ list: { analyses: [{ status: `running`, analyzer: { name: `kestrel` }, involved: true }], independentOnline: false } });
        await readAll(`kestrel`);
        expect(world.sqlite.prepare(`select status, involved from analyses where game_id = ?`).get(own)).toEqual({ status: `done`, involved: 1 });
        world.sqlite.exec(`update bots set owner_id = 'owner-d' where id = 'kestrel'`);
        now += 1_000;
        expect(world.service.list(own)).toMatchObject({ list: { analyses: [{ status: `done`, analyzer: { name: `kestrel`, ownerName: `owner-d` }, involved: true }] } });
        const seated = playedGame(world.query, { challenger: `kestrel`, dest: `beta` });
        world.service.requestGame(`asker`, seated, null);
        await readAll(`kestrel`);
        now += 1_000;
        expect(world.service.list(seated)).toMatchObject({ list: { analyses: [{ status: `done`, analyzer: { name: `kestrel` }, involved: true }] } });
    });

    it('gives a game asked for by no name to an analyzer whose owner sat in neither seat while one is available, even busy, over an idle one whose owner played', async () => {
        const kestrel = dial(`kestrel`);
        const driftwood = dial(`driftwood`);
        void world.service.requestPosition(`player`, { setup: board, analyzer: `driftwood`, lines: 1, seconds: 2 }, never);
        const gameId = playedGame(world.query, { challenger: `kestrel`, dest: `beta` });
        expect(world.service.requestGame(`asker`, gameId, null).kind).toBe(`queued`);
        await settled();
        expect(kestrel.count(`move_request`)).toBe(0);
        expect(world.service.list(gameId)).toMatchObject({ list: { analyses: [{ status: `queued` }], independentOnline: true } });
        answer(`driftwood`);
        await settled();
        expect(driftwood.count(`move_request`)).toBe(2);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { analyses: [{ status: `running`, analyzer: { name: `driftwood` }, involved: false }] } });
    });

    it('falls back to an analyzer whose owner played once no other may read the game now', async () => {
        const kestrel = dial(`kestrel`);
        dial(`driftwood`);
        void world.service.requestPosition(`player`, { setup: board, analyzer: `driftwood`, lines: 1, seconds: 2 }, never);
        const gameId = playedGame(world.query, { challenger: `kestrel`, dest: `beta` });
        world.service.requestGame(`asker`, gameId, null);
        await settled();
        expect(kestrel.count(`move_request`)).toBe(0);
        world.sockets.get(`driftwood`)?.close();
        await settled();
        expect(kestrel.count(`move_request`)).toBe(1);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { analyses: [{ status: `running`, analyzer: { name: `kestrel` }, involved: true }], independentOnline: false } });
        world.sqlite.exec(`update bots set analyzer_while_playing = 0 where id = 'driftwood'`);
        world.live.add(`driftwood`);
        dial(`driftwood`);
        await readAll(`kestrel`);
        const other = playedGame(world.query, { challenger: `beta`, dest: `kestrel` });
        world.service.requestGame(`asker`, other, null);
        await settled();
        expect(kestrel.count(`move_request`)).toBe(6);
    });

    it('lets a named analyzer whose owner played read the game while another is idle', async () => {
        const kestrel = dial(`kestrel`);
        const driftwood = dial(`driftwood`);
        const gameId = playedGame(world.query, { challenger: `kestrel`, dest: `beta` });
        expect(world.service.requestGame(`asker`, gameId, `kestrel`)).toMatchObject({ kind: `queued`, analysis: { involved: false } });
        await settled();
        expect(kestrel.count(`move_request`)).toBe(1);
        expect(driftwood.count(`move_request`)).toBe(0);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { analyses: [{ status: `running`, analyzer: { name: `kestrel` }, involved: true }] } });
    });

    it('reads a game once per analyzer and once per owner, whether or not the owner played', async () => {
        world.sqlite.exec(`
            insert into name_reservations (name_key) values ('merlin');
            insert into bots (id, owner_id, name, name_key, token_hash, scope, created_at, version, analyzer_max_seconds, analyzer_lines, analyzer_while_playing)
                values ('merlin', 'owner-c', 'merlin', 'merlin', 'h5', 'bot:play', 1, null, 2, 1, 0);
        `);
        dial(`kestrel`);
        const gameId = playedGame(world.query, { challenger: `kestrel`, dest: `beta` });
        world.service.requestGame(`asker`, gameId, null);
        await readAll(`kestrel`);
        expect(world.service.requestGame(`asker`, gameId, `kestrel`)).toEqual({ kind: `refused`, code: `no_analyzer` });
        dial(`merlin`);
        expect(world.service.requestGame(`asker`, gameId, null)).toEqual({ kind: `refused`, code: `no_analyzer` });
        expect(world.service.requestGame(`asker`, gameId, `merlin`)).toEqual({ kind: `refused`, code: `no_analyzer` });
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { independentOnline: false } });
        dial(`driftwood`);
        now += 1_000;
        expect(world.service.list(gameId)).toMatchObject({ list: { independentOnline: true } });
        expect(world.service.requestGame(`asker`, gameId, null).kind).toBe(`queued`);
        await readAll(`driftwood`);
        now += 1_000;
        const listed = world.service.list(gameId);
        if (listed.kind !== `list`) throw new Error(`no list`);
        expect(listed.list.analyses.map((reading) => (reading.kind === `community` ? [reading.analyzer?.name, reading.involved] : null))).toEqual([
            [`kestrel`, true],
            [`driftwood`, false],
        ]);
        expect(world.service.requestGame(`player`, gameId, null)).toEqual({ kind: `refused`, code: `analysis_full` });
    });

    it('fails a request no analyzer took within the hour, and requeues one a stopped process left running', async () => {
        const kestrel = dial(`kestrel`);
        void world.service.requestPosition(`player`, { setup: board, analyzer: `kestrel`, lines: 1, seconds: 2 }, never);
        const late = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        expect(world.service.requestGame(`asker`, late, null).kind).toBe(`queued`);
        now += analysisQueueExpiryMs;
        world.service.expire();
        now += 1_000;
        expect(world.service.list(late)).toMatchObject({ list: { analyses: [{ status: `failed`, failure: `expired`, analyzer: null }] } });
        answer(`kestrel`);
        const left = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        expect(world.service.requestGame(`asker`, left, null).kind).toBe(`queued`);
        await settled();
        expect(kestrel.count(`move_request`)).toBe(2);
        world.service.stop();
        world.sessions.stop();
        world = build(world.query, world.sqlite);
        expect(world.sqlite.prepare(`select status, analyzer_bot_id as bot from analyses where game_id = ?`).get(left)).toEqual({ status: `queued`, bot: null });
        dial(`kestrel`);
        await settled();
        expect(world.sqlite.prepare(`select status from analyses where game_id = ?`).get(left)).toEqual({ status: `running` });
    });

    it('deletes the readings of a player who opts out, hides the own views, and refuses new requests', async () => {
        dial(`kestrel`);
        const gameId = playedGame(world.query, { user: `player`, bot: `alpha` });
        world.service.requestGame(`asker`, gameId, null);
        await readAll(`kestrel`);
        world.service.setOptOut(`player`, true);
        expect(world.service.list(gameId)).toEqual({ kind: `list`, list: { analyses: [], optedOut: true, independentOnline: false } });
        expect(world.sqlite.prepare(`select count(*) as n from analyses`).get()).toEqual({ n: 0 });
        expect(world.service.requestGame(`asker`, gameId, null)).toEqual({ kind: `refused`, code: `opted_out` });
        world.service.setOptOut(`player`, false);
        expect(world.service.requestGame(`asker`, gameId, null).kind).toBe(`queued`);
    });

    it('stops and deletes a reading the operator removes', async () => {
        const kestrel = dial(`kestrel`);
        const gameId = playedGame(world.query, { challenger: `alpha`, dest: `beta` });
        const requested = world.service.requestGame(`asker`, gameId, null);
        if (requested.kind !== `queued`) throw new Error(`not queued`);
        await settled();
        expect(world.service.delete(requested.analysis.analysisId)).toBe(true);
        expect(kestrel.last(`interrupt`)).toBeDefined();
        await settled();
        expect(world.service.delete(requested.analysis.analysisId)).toBe(false);
        now += 1_000;
        expect(world.service.list(gameId)).toEqual({ kind: `list`, list: { analyses: [], optedOut: false, independentOnline: true } });
    });
});
