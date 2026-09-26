import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '@hexarena/contract';
import { feedOf, lastMoveOf, positionOf, reasonText, resultLine, resultSentence, stonesOf, winLineOf } from '../src/game/snapshot-views';

function snapshot(
    cells: readonly { x: number; y: number; side: `x` | `o` }[],
    extra: Record<string, unknown> = {},
): GameSnapshot {
    const base = {
        gameId: `g-1`,
        you: `o`,
        opponent: { name: `hextide`, rating: 1690, provisional: false },
        openingTurns: 1,
        board: { cells },
    };
    const merged = { status: `in-progress`, toMove: `o`, clock: { mode: `unlimited` }, ...base, ...extra };
    // merged carries the discriminated union members by construction
    return merged as GameSnapshot;
}

const originGame = [{ x: 0, y: 0, side: `x` as const }, { x: 1, y: -1, side: `o` as const }, { x: 0, y: 1, side: `o` as const }];

describe('stonesOf', () => {
    it('number stones by placement order', () => {
        const stones = stonesOf(snapshot(originGame));
        expect(stones.map((stone) => stone.number)).toEqual([1, 2, 3]);
        expect(stones[0]).toEqual({ x: 0, y: 0, side: `x`, number: 1 });
    });
});

describe('positionOf', () => {
    it('map sides onto the rules player numbering', () => {
        const position = positionOf(snapshot(originGame));
        expect(position.stones[0]).toEqual({ x: 0, y: 0, player: 0 });
        expect(position.stones[1]?.player).toBe(1);
    });
});

describe('lastMoveOf', () => {
    it('mark the final pair', () => {
        expect(lastMoveOf(snapshot(originGame))).toEqual([
            { x: 1, y: -1 },
            { x: 0, y: 1 },
        ]);
    });

    it('shrink to the single origin stone', () => {
        expect(lastMoveOf(snapshot([{ x: 0, y: 0, side: `x` }]))).toEqual([{ x: 0, y: 0 }]);
    });
});

describe('feedOf', () => {
    it('open with the server line, then number the turns', () => {
        const cells = [
            { x: 0, y: 0, side: `x` as const },
            { x: 1, y: -1, side: `o` as const },
            { x: 0, y: 1, side: `o` as const },
            { x: 2, y: 0, side: `x` as const },
            { x: -1, y: 2, side: `x` as const },
            { x: 2, y: -2, side: `o` as const },
            { x: -2, y: 1, side: `o` as const },
        ];
        const lines = feedOf(snapshot(cells));
        expect(lines[0]).toEqual({ label: `op`, text: `x: (0,0) o: (1,-1) (0,1)` });
        expect(lines[1]).toEqual({ label: `1`, text: `x: (2,0) (-1,2)` });
        expect(lines[2]).toEqual({ label: `2`, text: `o: (2,-2) (-2,1)` });
    });

    it('carry a lone trailing stone as its own half line', () => {
        const lines = feedOf(snapshot(originGame));
        expect(lines).toEqual([{ label: `op`, text: `x: (0,0) o: (1,-1) (0,1)` }]);
    });

    it('group the opening honestly for a zero-turn session', () => {
        const lines = feedOf(snapshot(originGame, { openingTurns: 0 }));
        expect(lines).toEqual([
            { label: `op`, text: `x: (0,0)` },
            { label: `1`, text: `o: (1,-1) (0,1)` },
        ]);
    });

    it('widen the server line for a three-turn opening', () => {
        const cells = [
            { x: 0, y: 0, side: `x` as const },
            { x: 1, y: -1, side: `o` as const },
            { x: 0, y: 1, side: `o` as const },
            { x: 2, y: 0, side: `x` as const },
            { x: -1, y: 2, side: `x` as const },
            { x: 2, y: -2, side: `o` as const },
            { x: -2, y: 1, side: `o` as const },
        ];
        const lines = feedOf(snapshot(cells, { openingTurns: 3 }));
        expect(lines).toEqual([{ label: `op`, text: `x: (0,0) o: (1,-1) (0,1) x: (2,0) (-1,2) o: (2,-2) (-2,1)` }]);
    });
});

describe('winLineOf', () => {
    it('computes the six from the stones, client-side', () => {
        const cells = [
            { x: 0, y: 0, side: `x` as const },
            { x: 1, y: 0, side: `o` as const },
            { x: 2, y: 0, side: `o` as const },
            { x: 1, y: -1, side: `x` as const },
            { x: 2, y: -1, side: `x` as const },
            { x: 3, y: 0, side: `o` as const },
            { x: 4, y: 0, side: `o` as const },
            { x: 3, y: -1, side: `x` as const },
            { x: 2, y: 1, side: `x` as const },
            { x: 5, y: 0, side: `o` as const },
            { x: 6, y: 0, side: `o` as const },
        ];
        const win = winLineOf(
            snapshot(cells, { status: `finished`, winner: `o`, reason: `six-in-a-row` }),
        );
        expect(win).toEqual([
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 3, y: 0 },
            { x: 4, y: 0 },
            { x: 5, y: 0 },
            { x: 6, y: 0 },
        ]);
    });

    it('draws nothing when nobody won', () => {
        expect(winLineOf(snapshot(originGame, { status: `finished`, winner: null, reason: `aborted` }))).toBe(null);
    });
});

describe('the finish vocabulary', () => {
    it('speaks every reason in plain words', () => {
        expect(reasonText(`six-in-a-row`)).toBe(`six in a row`);
        expect(reasonText(`timeout`)).toBe(`clock`);
        expect(reasonText(`disconnect`)).toBe(`disconnect`);
        expect(reasonText(`surrender`)).toBe(`surrender`);
        expect(reasonText(`terminated`)).toBe(`terminated`);
        expect(reasonText(`aborted`)).toBe(`aborted`);
    });

    it('names the winner or nobody', () => {
        const finished = snapshot(originGame, { status: `finished`, winner: `x`, reason: `surrender` });
        expect(resultSentence(finished)).toBe(`hextide won, surrender`);
        const aborted = snapshot(originGame, { status: `finished`, winner: null, reason: `aborted` });
        expect(resultSentence(aborted)).toBe(`nobody won, aborted`);
    });

    it('capitalize the shown result unless it starts with a name', () => {
        const aborted = snapshot(originGame, { status: `finished`, winner: null, reason: `aborted` });
        expect(resultLine(aborted)).toBe(`Nobody won, aborted`);
        const named = snapshot(originGame, { status: `finished`, winner: `x`, reason: `surrender` });
        expect(resultLine(named)).toBe(resultSentence(named).replace(/^you /, `You `));
    });
});

