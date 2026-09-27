import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '@hexo-arena/contract';
import { feedOf, lastMoveOf, positionOf, reasonText, resultLine, resultSentence, stonesOf, winLineOf } from '../src/game/snapshot-views';

function snapshot(
    cells: readonly { x: number; y: number; side: `x` | `o` }[],
    extra: Record<string, unknown> = {},
): GameSnapshot {
    const base = {
        gameId: `g-1`,
        you: `o`,
        players: {
            x: { name: `hextide`, rating: 1690, provisional: false, kind: `bot` },
            o: { name: `tom`, rating: 1503, provisional: false, kind: `user` },
        },
        openingPlies: 3,
        board: { cells },
    };
    const merged = { status: `in-progress`, toMove: `o`, clock: { mode: `unlimited` }, ...base, ...extra };
    // merged carries the discriminated union members by construction
    return merged as GameSnapshot;
}

const nineOpening = [
    { x: 0, y: 0, side: `x` as const },
    { x: 1, y: -1, side: `o` as const },
    { x: 0, y: 1, side: `o` as const },
    { x: 2, y: 0, side: `x` as const },
    { x: -1, y: 2, side: `x` as const },
    { x: 2, y: -2, side: `o` as const },
    { x: -2, y: 1, side: `o` as const },
    { x: 1, y: 1, side: `x` as const },
    { x: -1, y: 0, side: `x` as const },
];

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
    it('open with the server line labeled by its turn span, then number the turns', () => {
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
        expect(lines).toEqual([
            { label: `op 0-1`, spoken: `opening, turns 0 to 1`, groups: [`x: (0,0)`, `o: (1,-1) (0,1)`] },
            { label: `2`, spoken: `2`, groups: [`x: (2,0) (-1,2)`] },
            { label: `3`, spoken: `3`, groups: [`o: (2,-2) (-2,1)`] },
        ]);
    });

    it('carry a lone trailing stone as its own half line', () => {
        const lines = feedOf(snapshot(originGame.slice(0, 2), { openingPlies: 1 }));
        expect(lines).toEqual([
            { label: `op 0`, spoken: `opening, turn 0`, groups: [`x: (0,0)`] },
            { label: `1`, spoken: `1`, groups: [`o: (1,-1)`] },
        ]);
    });

    it('group a one-ply opening as the origin alone and start the players at turn 1', () => {
        const lines = feedOf(snapshot(originGame, { openingPlies: 1 }));
        expect(lines).toEqual([
            { label: `op 0`, spoken: `opening, turn 0`, groups: [`x: (0,0)`] },
            { label: `1`, spoken: `1`, groups: [`o: (1,-1) (0,1)`] },
        ]);
    });

    it('group a five-ply opening as the origin and two turns and start the players at turn 3', () => {
        const lines = feedOf(snapshot(nineOpening.slice(0, 7), { openingPlies: 5 }));
        expect(lines).toEqual([
            { label: `op 0-2`, spoken: `opening, turns 0 to 2`, groups: [`x: (0,0)`, `o: (1,-1) (0,1)`, `x: (2,0) (-1,2)`] },
            { label: `3`, spoken: `3`, groups: [`o: (2,-2) (-2,1)`] },
        ]);
    });

    it('group a nine-ply opening as the origin and four turns and start the players at turn 5', () => {
        const lines = feedOf(snapshot([...nineOpening, { x: 4, y: 0, side: `o` }, { x: 4, y: 1, side: `o` }], { openingPlies: 9 }));
        expect(lines).toEqual([
            {
                label: `op 0-4`,
                spoken: `opening, turns 0 to 4`,
                groups: [`x: (0,0)`, `o: (1,-1) (0,1)`, `x: (2,0) (-1,2)`, `o: (2,-2) (-2,1)`, `x: (1,1) (-1,0)`],
            },
            { label: `5`, spoken: `5`, groups: [`o: (4,0) (4,1)`] },
        ]);
    });

    it('hold every stone on the opening line when no player has moved yet', () => {
        const lines = feedOf(snapshot(nineOpening.slice(0, 7), { openingPlies: 7 }));
        expect(lines).toEqual([
            { label: `op 0-3`, spoken: `opening, turns 0 to 3`, groups: [`x: (0,0)`, `o: (1,-1) (0,1)`, `x: (2,0) (-1,2)`, `o: (2,-2) (-2,1)`] },
        ]);
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
        expect(reasonText(`timeout`)).toBe(`on time`);
        expect(reasonText(`disconnect`)).toBe(`disconnect`);
        expect(reasonText(`surrender`)).toBe(`resignation`);
        expect(reasonText(`terminated`)).toBe(`terminated`);
        expect(reasonText(`aborted`)).toBe(`aborted`);
    });

    it('say how the game ended and name the side that resigned or dropped', () => {
        const finished = (winner: `x` | `o` | null, reason: string) =>
            resultSentence(snapshot(originGame, { status: `finished`, winner, reason }));
        expect(finished(`x`, `six-in-a-row`)).toBe(`hextide won with six in a row`);
        expect(finished(`o`, `timeout`)).toBe(`you won on time`);
        expect(finished(`x`, `surrender`)).toBe(`hextide won, you resigned`);
        expect(finished(`o`, `surrender`)).toBe(`you won, hextide resigned`);
        expect(finished(`o`, `disconnect`)).toBe(`you won, hextide disconnected`);
        expect(finished(null, `aborted`)).toBe(`nobody won, the game was aborted`);
        expect(finished(null, `terminated`)).toBe(`nobody won, the game was terminated`);
    });

    it('capitalize the shown result unless it starts with a name', () => {
        const aborted = snapshot(originGame, { status: `finished`, winner: null, reason: `aborted` });
        expect(resultLine(aborted)).toBe(`Nobody won, the game was aborted`);
        const named = snapshot(originGame, { status: `finished`, winner: `x`, reason: `surrender` });
        expect(resultLine(named)).toBe(resultSentence(named).replace(/^you /, `You `));
    });
});

