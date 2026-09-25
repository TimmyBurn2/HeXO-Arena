import { describe, expect, it } from 'vitest';
import {
    createGameRequestSchema,
    gameClockSchema,
    gameSnapshotSchema,
    humanMoveRequestSchema,
} from '../src/games';
import { defaultOpeningTurns, openingTurnsSchema } from '../src/stream';

const turnControl = { mode: `turn`, turnTimeMs: 30_000 };

describe('openingTurnsSchema', () => {
    it('accepts every whole turn count from none to four', () => {
        for (const turns of [0, 1, 2, 3, 4]) {
            expect(openingTurnsSchema.parse(turns)).toBe(turns);
        }
    });

    it('rejects a fifth turn, a negative count, and a fraction', () => {
        for (const turns of [5, -1, 1.5]) {
            expect(openingTurnsSchema.safeParse(turns).success).toBe(false);
        }
    });
});

describe('createGameRequestSchema', () => {
    it('fills in the default opening when none is asked for', () => {
        const parsed = createGameRequestSchema.parse({
            bot: `opponentbot`,
            timeControl: turnControl,
        });
        expect(parsed.openingTurns).toBe(defaultOpeningTurns);
        expect(defaultOpeningTurns).toBe(1);
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
            openingTurns: 0,
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
            openingTurns: 0,
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
