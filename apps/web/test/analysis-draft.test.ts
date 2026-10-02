import { describe, expect, it } from 'vitest';
import { analysisStoneCap } from '@hexo-arena/contract';
import { originSetup, type Stone } from '@hexo-arena/rules';
import { checkDraft, clearBoard, clickCell, draftOf, draftSetup, originOnly, setTool, setToMove, undo } from '../src/analysis/draft';

describe('setting up a position by hand', () => {
    it('places a stone of the tool\'s side on an empty cell and takes any stone off its cell', () => {
        const placed = clickCell(draftOf(originSetup), { x: 1, y: 0 });
        expect(placed.stones).toEqual([...originSetup.stones, { x: 1, y: 0, player: 0 }]);
        const circle = clickCell(setTool(placed, `o`), { x: 2, y: 0 });
        expect(circle.stones.at(-1)).toEqual({ x: 2, y: 0, player: 1 });
        expect(clickCell(circle, { x: 0, y: 0 }).stones).toEqual([
            { x: 1, y: 0, player: 0 },
            { x: 2, y: 0, player: 1 },
        ]);
    });

    it('takes stones off and places none while Take off is in hand', () => {
        const off = setTool(draftOf(originSetup), `off`);
        expect(clickCell(off, { x: 3, y: 3 })).toBe(off);
        expect(clickCell(off, { x: 0, y: 0 }).stones).toEqual([]);
    });

    it('clears the board, leaves the origin alone, and names the player to move', () => {
        const busy = clickCell(clickCell(draftOf(originSetup), { x: 1, y: 0 }), { x: 2, y: 0 });
        expect(clearBoard(busy).stones).toEqual([]);
        expect(draftSetup(originOnly(clearBoard(busy)))).toEqual(originSetup);
        expect(setToMove(busy, 0).toMove).toBe(0);
    });

    it('undoes each change in turn, the player to move included, and stops at the start', () => {
        const start = draftOf(originSetup);
        const changed = setToMove(clickCell(start, { x: 1, y: 0 }), 0);
        expect(draftSetup(undo(changed))).toEqual({ stones: changed.stones, toMove: 1 });
        expect(draftSetup(undo(undo(changed)))).toEqual(originSetup);
        expect(undo(undo(undo(changed))).history).toEqual([]);
    });

    it('counts the stones by side and names why a board cannot be played from', () => {
        expect(checkDraft(draftOf(originSetup))).toEqual({ x: 1, o: 0, problem: null });
        expect(checkDraft(clearBoard(draftOf(originSetup))).problem).toEqual({ kind: `no-stones` });
        const six = draftOf({ stones: [0, 1, 2, 3, 4, 5].map((x): Stone => ({ x, y: 0, player: 1 })), toMove: 0 });
        expect(checkDraft(six)).toMatchObject({ x: 0, o: 6, problem: { kind: `six-on-board` } });
        const crowded = draftOf({ stones: Array.from({ length: analysisStoneCap + 1 }, (_, x): Stone => ({ x, y: x % 2, player: 0 })), toMove: 1 });
        expect(checkDraft(crowded).problem).toEqual({ kind: `too-many-stones`, count: analysisStoneCap + 1 });
    });
});
