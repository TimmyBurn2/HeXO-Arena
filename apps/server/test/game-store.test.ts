import { gameTurnCap } from '@hexo-arena/contract';
import { emptyPosition, place, type Coord, type Position } from '@hexo-arena/rules';
import { asc } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBot, findBot } from '../src/bots';
import { createQuery, openDatabase, runMigrations, type Query, type Sqlite } from '../src/db';
import { games } from '../src/db/schema';
import { abortUnfinishedGames, findFinishedHeadline, findGame, insertGame, insertMove, recordFinish, replayPosition } from '../src/game-store';
import { deleteBotByPolicy } from '../src/moderation';
import { createUserWithExactName } from '../src/users';

const unlimited = { mode: `unlimited` as const };
const origin = [{ x: 0, y: 0, player: 0 as const }];

describe('finish order', () => {
    let sqlite: Sqlite;
    let query: Query;
    let seat: { userId: string; botId: string };

    beforeEach(() => {
        sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        if (createBot(query, owner.id, `alpha`).kind !== `created`) throw new Error(`seed failed`);
        const bot = findBot(query, `alpha`);
        if (bot === undefined) throw new Error(`seed lookup failed`);
        seat = { userId: owner.id, botId: bot.id };
    });

    afterEach(() => {
        sqlite.close();
    });

    function create(): string {
        return insertGame(query, { ...seat, userSide: `x`, timeControl: unlimited, opening: origin });
    }

    function sequence(): { id: string; finishSeq: number | null }[] {
        return query.select({ id: games.id, finishSeq: games.finishSeq }).from(games).orderBy(asc(games.finishSeq)).all();
    }

    it('numbers finishes in the order they happen, not the order games began', () => {
        const first = create();
        const second = create();
        recordFinish(query, second, { winner: `x`, reason: `surrender` });
        recordFinish(query, first, { winner: `o`, reason: `surrender` });
        expect(sequence()).toEqual([
            { id: second, finishSeq: 1 },
            { id: first, finishSeq: 2 },
        ]);
    });

    it('gives a finish that already happened no second number', () => {
        const only = create();
        recordFinish(query, only, { winner: `x`, reason: `surrender` });
        recordFinish(query, only, { winner: `o`, reason: `timeout` });
        expect(sequence()).toEqual([{ id: only, finishSeq: 1 }]);
    });

    it('numbers every game the boot sweep aborts', () => {
        create();
        create();
        abortUnfinishedGames(query);
        expect(sequence().map((row) => row.finishSeq)).toEqual([1, 2]);
    });

    it('sweeps a guest\'s unfinished game at boot like any other, rating nobody', () => {
        const guestGame = insertGame(query, { guestName: `Guest k3f9`, botId: seat.botId, userSide: `o`, timeControl: unlimited, opening: origin });
        abortUnfinishedGames(query);
        expect(findGame(query, guestGame)).toMatchObject({ kind: `guest`, guestName: `Guest k3f9`, guestSide: `o`, winner: null, finishReason: `aborted` });
        expect(findFinishedHeadline(query, guestGame)).toMatchObject({ status: `finished`, names: { x: `alpha`, o: `Guest k3f9` }, reason: `aborted` });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 0 });
    });
});

describe('a bot\'s guest games', () => {
    it('keep no bot on the record: a bot with only guest games is deleted outright, its games with it', () => {
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        createBot(query, owner.id, `alpha`);
        const botId = findBot(query, `alpha`)?.id ?? ``;
        const gameId = insertGame(query, { guestName: `Guest k3f9`, botId, userSide: `o`, timeControl: unlimited, opening: origin });
        recordFinish(query, gameId, { winner: `o`, reason: `six-in-a-row` });
        expect(deleteBotByPolicy(query, botId)).toEqual({ kind: `deleted` });
        expect(sqlite.prepare(`select count(*) as n from games`).get()).toEqual({ n: 0 });
        sqlite.close();
    });
});

describe('a bot\'s games started unrated', () => {
    it('keep no bot on the record: a bot whose only decided game a person started unrated is deleted outright, its games with it', () => {
        const sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        const query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        const player = createUserWithExactName(query, `dev:player`, `player`);
        if (owner === `name_taken` || player === `name_taken`) throw new Error(`seed name taken`);
        createBot(query, owner.id, `alpha`);
        const botId = findBot(query, `alpha`)?.id ?? ``;
        const gameId = insertGame(query, { userId: player.id, unratedByChoice: true, botId, userSide: `o`, timeControl: unlimited, opening: origin });
        recordFinish(query, gameId, { winner: `o`, reason: `six-in-a-row` });
        expect(findGame(query, gameId)).toMatchObject({ kind: `human`, unratedByChoice: true });
        expect(sqlite.prepare(`select count(*) as n from game_ratings`).get()).toEqual({ n: 0 });
        expect(deleteBotByPolicy(query, botId)).toEqual({ kind: `deleted` });
        expect(sqlite.prepare(`select count(*) as n from games`).get()).toEqual({ n: 0 });
        sqlite.close();
    });
});

describe('replay', () => {
    let sqlite: Sqlite;
    let query: Query;
    let seat: { userId: string; botId: string };

    beforeEach(() => {
        sqlite = openDatabase(`:memory:`);
        runMigrations(sqlite);
        query = createQuery(sqlite);
        const owner = createUserWithExactName(query, `dev:owner`, `owner`);
        if (owner === `name_taken`) throw new Error(`seed name taken`);
        if (createBot(query, owner.id, `alpha`).kind !== `created`) throw new Error(`seed failed`);
        const bot = findBot(query, `alpha`);
        if (bot === undefined) throw new Error(`seed lookup failed`);
        seat = { userId: owner.id, botId: bot.id };
    });

    afterEach(() => {
        sqlite.close();
    });

    function store(turns: readonly (readonly [Coord, Coord])[]): string {
        const id = insertGame(query, { ...seat, userSide: `x`, timeControl: unlimited, opening: origin });
        for (const [index, cells] of turns.entries()) {
            insertMove(query, { gameId: id, seq: index + 1, side: index % 2 === 0 ? `o` : `x`, cells });
        }
        return id;
    }

    function replay(id: string): Position {
        const record = findGame(query, id);
        if (record === undefined) throw new Error(`no record`);
        return replayPosition(query, record);
    }

    // Colored by floor((x + 2y) / 2) mod 2,
    // each axis runs in pairs or alternates,
    // so neither side ever holds six in a row.
    function drawnTurns(count: number): [Coord, Coord][] {
        const cells: [Coord[], Coord[]] = [[], []];
        for (let y = 1; cells[0].length < count + 1 || cells[1].length < count + 1; y += 1) {
            for (let step = 0; step < 30; step += 1) {
                const x = step % 2 === 0 ? step / 2 : -(step + 1) / 2;
                cells[Math.floor((x + 2 * y) / 2) & 1]?.push({ x, y });
            }
        }
        const turns: [Coord, Coord][] = [];
        for (let turn = 0; turn < count; turn += 1) {
            const own = cells[turn % 2 === 0 ? 1 : 0];
            const [first, second] = own.splice(0, 2);
            if (first === undefined || second === undefined) throw new Error(`out of cells`);
            turns.push([first, second]);
        }
        return turns;
    }

    it('counts the turns of a finished game in its headline, opening turns included', () => {
        const opening = [...origin, { x: 1, y: 0, player: 1 as const }, { x: -1, y: 0, player: 1 as const }];
        const id = insertGame(query, { ...seat, userSide: `x`, timeControl: unlimited, opening });
        for (const [index, cells] of drawnTurns(2).entries()) {
            insertMove(query, { gameId: id, seq: index + 1, side: index % 2 === 0 ? `x` : `o`, cells });
        }
        recordFinish(query, id, { winner: null, reason: `terminated` });
        expect(findFinishedHeadline(query, id)).toMatchObject({ status: `finished`, turns: 3 });
    });

    it('stops at the stone that wins, leaving the rest of its turn unplaced', () => {
        const turns: [Coord, Coord][] = [
            [{ x: -3, y: 3 }, { x: -1, y: 3 }],
            [{ x: 1, y: 0 }, { x: 2, y: 0 }],
            [{ x: 1, y: 3 }, { x: 3, y: 3 }],
            [{ x: 3, y: 0 }, { x: 4, y: 0 }],
            [{ x: 5, y: 3 }, { x: 7, y: 3 }],
            [{ x: 5, y: 0 }, { x: 7, y: 7 }],
        ];
        let expected: Position = emptyPosition;
        for (const cell of [{ x: 0, y: 0 }, ...turns.flat().slice(0, -1)]) {
            const placed = place(expected, cell);
            if (!placed.ok) throw new Error(`illegal script`);
            expected = placed.position;
        }
        expect(replay(store(turns))).toEqual(expected);
    });

    it('refuse to replay a stored turn onto a taken cell', () => {
        expect(() => replay(store([[{ x: 0, y: 0 }, { x: 1, y: 0 }]]))).toThrow(/stored cell is illegal/u);
    });

    it(`replays a ${String(gameTurnCap)}-turn game in time linear in its length`, () => {
        const short = store(drawnTurns(gameTurnCap / 10));
        const long = store(drawnTurns(gameTurnCap));
        expect(replay(long).stones).toHaveLength(1 + 2 * gameTurnCap);
        const fastest = (id: string) => {
            let best = Infinity;
            for (let run = 0; run < 5; run += 1) {
                const started = performance.now();
                replay(id);
                best = Math.min(best, performance.now() - started);
            }
            return best;
        };
        fastest(short);
        fastest(long);
        // Ten times the turns costs at most ten times as much when linear,
        // and about a hundred times when quadratic.
        expect(fastest(long) / fastest(short)).toBeLessThan(20);
    });
});
