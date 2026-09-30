import { describe, expect, it } from 'vitest';
import type { GameSnapshot, GameTurn } from '@hexo-arena/contract';
import { applyFinish, applyTurn, lastTurnOf, laterOf } from '../src/game/live';

const running: GameSnapshot = {
    gameId: `g-1`,
    players: {
        x: { name: `sealbot`, rating: 1712, provisional: false, kind: `bot` },
        o: { name: `Guest k3f9`, rating: null, provisional: false, kind: `guest` },
    },
    openingPlies: 3,
    board: {
        cells: [
            { x: 0, y: 0, side: `x` },
            { x: 1, y: -1, side: `o` },
            { x: 0, y: 1, side: `o` },
        ],
    },
    timeControl: { mode: `turn`, turnTimeMs: 30_000 },
    status: `in-progress`,
    toMove: `x`,
    clock: { mode: `turn`, remainingTurnMs: 30_000 },
};

const turnTwo: GameTurn = {
    turn: 2,
    side: `x`,
    cells: [
        { x: 2, y: 0 },
        { x: 3, y: 0 },
    ],
    toMove: `o`,
    clock: { mode: `turn`, remainingTurnMs: 29_000 },
};

describe('lastTurnOf', () => {
    it('counts the origin as turn 0 and a cut-short winning turn as whole', () => {
        expect(lastTurnOf(running)).toBe(1);
        const cells = [...running.board.cells, { x: 2, y: 0, side: `x` as const }];
        expect(lastTurnOf({ ...running, board: { cells } })).toBe(2);
    });
});

describe('applyTurn', () => {
    it('appends the next turn with its side and takes its turn and clock', () => {
        const fit = applyTurn(running, turnTwo);
        if (fit.kind !== `applied`) throw new Error(`not applied`);
        expect(fit.snapshot.board.cells.slice(3)).toEqual([
            { x: 2, y: 0, side: `x` },
            { x: 3, y: 0, side: `x` },
        ]);
        expect(fit.snapshot).toMatchObject({ toMove: `o`, clock: { remainingTurnMs: 29_000 } });
    });

    it('holds a turn the board already has, as when the move answer landed first', () => {
        expect(applyTurn(running, { ...turnTwo, turn: 1 }).kind).toBe(`held`);
    });

    it('reports a skipped turn as a gap', () => {
        expect(applyTurn(running, { ...turnTwo, turn: 3 }).kind).toBe(`gap`);
    });
});

describe('applyFinish', () => {
    it('finishes the board with the result and the final clock, keeping the seat', () => {
        const finished = applyFinish({ ...running, you: `o` }, { winner: `x`, reason: `timeout`, clock: { mode: `turn`, remainingTurnMs: 0 } });
        expect(finished).toMatchObject({ status: `finished`, winner: `x`, reason: `timeout`, you: `o` });
        expect(`toMove` in finished).toBe(false);
    });
});

describe('laterOf', () => {
    it('keeps the board with more stones, whichever read arrived last', () => {
        const fit = applyTurn(running, turnTwo);
        if (fit.kind !== `applied`) throw new Error(`not applied`);
        expect(laterOf(fit.snapshot, running)).toBe(fit.snapshot);
        expect(laterOf(running, fit.snapshot)).toBe(fit.snapshot);
    });

    it('never takes a finish back on an equal board', () => {
        const finished = applyFinish(running, { winner: null, reason: `aborted`, clock: { mode: `turn`, remainingTurnMs: 0 } });
        expect(laterOf(finished, running)).toBe(finished);
        expect(laterOf(running, finished)).toBe(finished);
    });
});
