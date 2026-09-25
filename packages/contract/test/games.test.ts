import { describe, expect, it } from 'vitest';
import {
    createGameRequestSchema,
    gameClockSchema,
    gameSnapshotSchema,
    humanMoveRequestSchema,
} from '../src/games';
import { defaultOpeningStones, openingStonesSchema } from '../src/stream';

const turnControl = { mode: `turn`, turnTimeMs: 30_000 };

describe('openingStonesSchema', () => {
    it('accepts every even stone count from none to six', () => {
        for (const stones of [0, 2, 4, 6]) {
            expect(openingStonesSchema.parse(stones)).toBe(stones);
        }
    });

    it('rejects odd counts, which would hand someone a half turn', () => {
        for (const stones of [1, 3, 5, 7, -2]) {
            expect(openingStonesSchema.safeParse(stones).success).toBe(false);
        }
    });
});

describe('createGameRequestSchema', () => {
    it('fills in the default opening when none is asked for', () => {
        const parsed = createGameRequestSchema.parse({
            bot: `opponentbot`,
            timeControl: turnControl,
        });
        expect(parsed.openingStones).toBe(defaultOpeningStones);
        expect(defaultOpeningStones).toBe(2);
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
            opponent: { name: `opponentbot`, rating: 1500, provisional: true },
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            toMove: `o`,
            clock: { mode: `unlimited` },
        });
        expect(inProgress.status).toBe(`in-progress`);
        const finished = gameSnapshotSchema.parse({
            gameId: `g1`,
            status: `finished`,
            you: `x`,
            opponent: { name: `opponentbot`, rating: 1500, provisional: true },
            board: { cells: [{ x: 0, y: 0, side: `x` }] },
            winner: null,
            reason: `aborted`,
        });
        expect(finished.status).toBe(`finished`);
        expect(`clock` in finished && finished.clock !== undefined).toBe(false);
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
