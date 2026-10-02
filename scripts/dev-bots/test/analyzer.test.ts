import { originSetup, otherPlayer, playTurn, type Setup, type Stone } from '@hexo-arena/rules';
import { describe, expect, it } from 'vitest';
import { checkReading } from '../../../apps/server/src/analysis-checks';
import { readPosition } from '../src/analyzer';

// A small seeded generator, so every run reads the same boards.
function seeded(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return state / 2 ** 32;
    };
}

function played(turns: number, random: () => number): Setup {
    let setup = originSetup;
    for (let turn = 0; turn < turns; turn += 1) {
        const near = () => {
            const stone = setup.stones[Math.floor(random() * setup.stones.length)] ?? { x: 0, y: 0 };
            return { x: stone.x + Math.floor(random() * 5) - 2, y: stone.y + Math.floor(random() * 5) - 2 };
        };
        const result = playTurn(setup, [near(), near()]);
        if (result.ok && result.win === null) setup = result.setup;
    }
    return setup;
}

function stones(player: 0 | 1, ...cells: readonly (readonly [number, number])[]): Stone[] {
    return cells.map(([x, y]) => ({ x, y, player }));
}

describe('readPosition', () => {
    it('answers every board with distinct legal lines whose values the board bears out', () => {
        const random = seeded(17);
        for (let sample = 0; sample < 120; sample += 1) {
            const setup = played(2 + Math.floor(random() * 30), random);
            const board = sample % 3 === 0 ? { ...setup, toMove: otherPlayer(setup.toMove) } : setup;
            const [move, ...considerations] = readPosition(board, 3, random);
            if (move === undefined) throw new Error(`no line read`);
            expect(checkReading(board, { move, considerations }, 3), JSON.stringify(board)).toMatchObject({ ok: true });
            expect(considerations.length).toBeLessThanOrEqual(2);
        }
    });

    it('completes six when the side to move can, and values a board that leaves the other side six for the other side', () => {
        const random = seeded(5);
        const xToWin: Setup = { stones: [...stones(0, [0, 0], [1, 0], [2, 0], [3, 0]), ...stones(1, [0, 2], [1, 2], [5, 5])], toMove: 0 };
        const [winning, ...rest] = readPosition(xToWin, 3, random);
        expect(winning?.evaluation?.heuristic).toBe(1);
        expect(checkReading(xToWin, { move: winning ?? { pieces: [] }, considerations: rest }, 3)).toMatchObject({ ok: true });
        const oFacesFour: Setup = { ...xToWin, toMove: 1 };
        const [move, ...considerations] = readPosition(oFacesFour, 3, random);
        expect(checkReading(oFacesFour, { move: move ?? { pieces: [] }, considerations }, 3)).toMatchObject({ ok: true });
    });
});
