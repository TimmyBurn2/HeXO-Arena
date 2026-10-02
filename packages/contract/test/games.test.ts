import { describe, expect, it } from 'vitest';
import {
    createGameRequestSchema,
    defaultHumanOpeningPlies,
    gameClockSchema,
    gameSnapshotSchema,
    humanMoveRequestSchema,
    liveGameEntrySchema,
    liveGameListCap,
} from '../src/games';
import { openingPliesSchema } from '../src/stream';

const turnControl = { mode: `turn`, turnTimeMs: 30_000 };
const players = {
    x: { name: `Guest a1b2`, rating: null, provisional: false, kind: `guest` },
    o: { name: `opponentbot`, rating: 1500, provisional: true, kind: `bot` },
};

describe('openingPliesSchema', () => {
    it('accepts every odd ply count from one to nine', () => {
        for (const plies of [1, 3, 5, 7, 9]) {
            expect(openingPliesSchema.parse(plies)).toBe(plies);
        }
    });

    it('rejects zero, every even count, eleven, and a fraction', () => {
        for (const plies of [0, 2, 4, 6, 8, 10, 11, -1, 4.5]) {
            expect(openingPliesSchema.safeParse(plies).success).toBe(false);
        }
    });
});

describe('createGameRequestSchema', () => {
    it('opens on the origin alone when no opening is asked for', () => {
        const parsed = createGameRequestSchema.parse({
            bot: `opponentbot`,
            timeControl: turnControl,
        });
        expect(parsed.openingPlies).toBe(defaultHumanOpeningPlies);
        expect(defaultHumanOpeningPlies).toBe(1);
    });

    it('lets a request leave rated out, as every caller before it did, and takes it only as a boolean', () => {
        const request = { bot: `opponentbot`, timeControl: turnControl };
        expect(createGameRequestSchema.parse(request)).not.toHaveProperty(`rated`);
        expect(createGameRequestSchema.parse({ ...request, rated: true }).rated).toBe(true);
        expect(createGameRequestSchema.parse({ ...request, rated: false }).rated).toBe(false);
        expect(createGameRequestSchema.safeParse({ ...request, rated: `no` }).success).toBe(false);
    });

    it('keeps the time-control floors from the stream contract', () => {
        expect(
            createGameRequestSchema.safeParse({
                bot: `opponentbot`,
                timeControl: { mode: `turn`, turnTimeMs: 4_999 },
            }).success,
        ).toBe(false);
        expect(
            createGameRequestSchema.safeParse({
                bot: `opponentbot`,
                timeControl: { mode: `match`, mainTimeMs: 59_999, incrementMs: 0 },
            }).success,
        ).toBe(false);
    });
});

describe('gameClockSchema', () => {
    it('mirrors the three time-control modes', () => {
        expect(gameClockSchema.parse({ mode: `unlimited` })).toEqual({ mode: `unlimited` });
        expect(gameClockSchema.parse({ mode: `turn`, remainingTurnMs: 0 })).toEqual({
            mode: `turn`,
            remainingTurnMs: 0,
        });
        expect(
            gameClockSchema.parse({ mode: `match`, remainingMainMs: { x: 1, o: 2 } }),
        ).toEqual({ mode: `match`, remainingMainMs: { x: 1, o: 2 } });
    });

    it('rejects negative remaining time', () => {
        expect(gameClockSchema.safeParse({ mode: `turn`, remainingTurnMs: -1 }).success).toBe(false);
    });
});

describe('gameSnapshotSchema', () => {
    it('carries the turn and clock while in progress and the result once finished', () => {
        const inProgress = gameSnapshotSchema.parse({
            gameId: `g1`,
            status: `in-progress`,
            you: `x`,
            players,
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: { mode: `unlimited` },
            toMove: `o`,
            clock: { mode: `unlimited` },
        });
        expect(inProgress.status).toBe(`in-progress`);
        expect(inProgress.you).toBe(`x`);
        const finished = gameSnapshotSchema.parse({
            gameId: `g1`,
            status: `finished`,
            players,
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: { mode: `unlimited` },
            winner: null,
            reason: `aborted`,
            voided: false,
        });
        expect(finished.status).toBe(`finished`);
        expect(`clock` in finished && finished.clock !== undefined).toBe(false);
        expect(finished.you).toBeUndefined();
    });

    it('marks a game its player started unrated, and only with true', () => {
        const live = {
            gameId: `g1`,
            status: `in-progress`,
            players,
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: { mode: `unlimited` },
            toMove: `o`,
            clock: { mode: `unlimited` },
        };
        expect(gameSnapshotSchema.parse(live).unratedByChoice).toBeUndefined();
        expect(gameSnapshotSchema.parse({ ...live, unratedByChoice: true }).unratedByChoice).toBe(true);
        expect(gameSnapshotSchema.safeParse({ ...live, unratedByChoice: false }).success).toBe(false);
        const finished = { ...live, status: `finished`, winner: `x`, reason: `six-in-a-row`, voided: false, unratedByChoice: true };
        expect(gameSnapshotSchema.parse(finished).unratedByChoice).toBe(true);
    });

    it('names both seats and rejects a seat of unknown kind', () => {
        const base = {
            gameId: `g1`,
            status: `in-progress`,
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: { mode: `unlimited` },
            toMove: `o`,
            clock: { mode: `unlimited` },
        };
        expect(gameSnapshotSchema.parse({ ...base, players }).players).toEqual(players);
        const unknownKind = { ...players, o: { ...players.o, kind: `robot` } };
        expect(gameSnapshotSchema.safeParse({ ...base, players: unknownKind }).success).toBe(false);
        expect(gameSnapshotSchema.safeParse({ ...base, opponent: players.o }).success).toBe(false);
    });

    it('names the clock with its amounts, live and finished alike', () => {
        const match = { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 };
        const live = {
            gameId: `g1`,
            status: `in-progress`,
            players,
            openingPlies: 1,
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            timeControl: match,
            toMove: `o`,
            clock: { mode: `match`, remainingMainMs: { x: 300_000, o: 298_000 } },
        };
        expect(gameSnapshotSchema.parse(live).timeControl).toEqual(match);
        const { timeControl: _live, ...liveWithout } = live;
        expect(gameSnapshotSchema.safeParse(liveWithout).success).toBe(false);
        const finished = { gameId: `g1`, status: `finished`, players, openingPlies: 1, board: live.board, timeControl: turnControl, winner: `x`, reason: `six-in-a-row`, voided: false };
        expect(gameSnapshotSchema.parse(finished).timeControl).toEqual(turnControl);
        const { timeControl: _finished, ...finishedWithout } = finished;
        expect(gameSnapshotSchema.safeParse(finishedWithout).success).toBe(false);
    });
});

describe('humanMoveRequestSchema', () => {
    it('wants exactly two cells', () => {
        const two = { cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }] };
        expect(humanMoveRequestSchema.parse(two)).toEqual(two);
        expect(humanMoveRequestSchema.safeParse({ cells: [{ x: 1, y: 0 }] }).success).toBe(false);
        expect(
            humanMoveRequestSchema.safeParse({
                cells: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
            }).success,
        ).toBe(false);
    });
});

describe('liveGameEntrySchema', () => {
    const entry = {
        gameId: `g1`,
        players,
        timeControl: turnControl,
        toMove: `o`,
        rated: false,
        cells: [
            { x: 0, y: 0, side: `x` },
            { x: 1, y: 0, side: `o` },
            { x: 0, y: 1, side: `o` },
        ],
        clock: { mode: `turn`, remainingTurnMs: 12_000 },
    };

    it('lists a guest game as unrated with its players, every stone in ply order, and its clock', () => {
        expect(liveGameEntrySchema.parse(entry)).toEqual(entry);
        expect(liveGameListCap).toBe(12);
    });

    it('wants the origin at least and a clock, and carries no ply count', () => {
        expect(liveGameEntrySchema.safeParse({ ...entry, cells: [] }).success).toBe(false);
        const { clock: _clock, ...clockless } = entry;
        expect(liveGameEntrySchema.safeParse(clockless).success).toBe(false);
        expect(liveGameEntrySchema.parse({ ...entry, plies: 3 })).not.toHaveProperty(`plies`);
    });
});
