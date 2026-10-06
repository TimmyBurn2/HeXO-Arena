import { describe, expect, it } from 'vitest';
import { sideOf } from '@hexo-arena/contract';
import { boardView, numberedStones } from '../src/analysis/board-view';
import { draftOf } from '../src/analysis/draft';
import type { ShownLine } from '../src/analysis/reading-view';
import { gameTree, markCell, playCells, standOn, toEnd, turnsOfGame, type AnalysisState } from '../src/analysis/state';
import { newTree, nodeAt, positionAt } from '../src/analysis/tree';
import { judgedCells } from './judged-game';

const turns = turnsOfGame(judgedCells);
const played = toEnd(standOn(gameTree(`g1`, 1, turns)));
const before = toEnd(standOn(gameTree(`g1`, 1, turns.slice(0, 2))));
const lineA: ShownLine = {
    letter: `A`,
    cells: [{ x: 9, y: 9 }, { x: 9, y: 8 }],
    evaluation: { heuristic: 0.1 },
    completesSix: false,
    value: { shown: `x 55%`, spoken: `x's win chance 55 percent` },
    drawn: 0.1,
    cellsText: `[9,9] [9,8]`,
};

function shown(state: AnalysisState) {
    const position = positionAt(state.tree, state.at);
    return {
        draft: null,
        preferred: null,
        stones: numberedStones(state.tree, state.at),
        frame: position.stones,
        mark: state.mark,
        node: nodeAt(state.tree, state.at),
        toMove: sideOf(position.toMove),
        lines: [lineA],
        boardLines: true,
        preview: null,
        judgment: null,
    };
}

describe('numberedStones', () => {
    it('numbers the stones in the order they were played, and leaves a set-up board\'s own stones unnumbered', () => {
        expect(numberedStones(played.tree, played.at).map((stone) => stone.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        const start = { stones: [{ x: 0, y: 0, player: 0 as const }, { x: 1, y: 0, player: 1 as const }], toMove: 1 as const };
        const setup = playCells(standOn(newTree({ kind: `setup`, start })), [{ x: 0, y: 1 }, { x: 1, y: 1 }]).state;
        expect(numberedStones(setup.tree, setup.at).map((stone) => stone.number)).toEqual([null, null, 1, 2]);
    });
});

describe('boardView', () => {
    it('draws the position with its last turn and its mark, the analyzer\'s lines while the settings draw them, and the line pointed at while it is one of them', () => {
        const marked = markCell(before, { x: 2, y: 1 }).state;
        const view = boardView({ ...shown(marked), preview: lineA });
        expect(view).toMatchObject({ mark: { x: 2, y: 1 }, winLine: [], lines: { side: `o`, lines: [lineA] }, preview: { side: `o`, cells: lineA.cells }, field: undefined });
        expect(view.lastMove).toEqual(turns[1]);
        expect(boardView({ ...shown(marked), boardLines: false }).lines).toBeUndefined();
        expect(boardView({ ...shown(marked), preview: { ...lineA } }).preview).toBeUndefined();
    });

    it('draws a six as its win line, with no last turn', () => {
        const view = boardView(shown(played));
        expect(view.lastMove).toEqual([]);
        expect(view.winLine).toHaveLength(6);
    });

    it('draws a judged turn\'s mark beside its last stone', () => {
        const judgment = { cell: { x: 5, y: 1 }, severity: `blunder` as const };
        expect(boardView({ ...shown(played), judgment }).judgment).toEqual(judgment);
    });

    it('draws a preferred line on the board its turn was played from, in place of the position\'s marks and lines', () => {
        const from = numberedStones(before.tree, before.at);
        const cells: ShownLine[`cells`] = [{ x: -1, y: 1 }, { x: -1, y: 2 }];
        const line = { side: `o` as const, cells, words: `o: [-1,1] [-1,2]` };
        const judgment = { cell: { x: 5, y: 1 }, severity: `blunder` as const };
        const view = boardView({ ...shown(played), preferred: { line, stones: from }, preview: lineA, judgment });
        expect(view).toEqual({
            stones: from,
            frame: positionAt(played.tree, played.at).stones,
            field: undefined,
            mark: null,
            lastMove: [],
            winLine: [],
            lines: undefined,
            preview: { side: `o`, cells: line.cells },
            judgment: undefined,
            visuals: [],
        });
    });

    it('draws a draft\'s stones, unnumbered, on the field round the origin and them, and nothing else', () => {
        const draft = draftOf(positionAt(before.tree, before.at));
        const view = boardView({ ...shown(played), draft, preferred: { line: { side: `o`, cells: lineA.cells, words: `` }, stones: [] } });
        const field = [{ x: 0, y: 0 }, ...draft.stones];
        expect(view).toEqual({
            stones: draft.stones.map((stone) => ({ x: stone.x, y: stone.y, side: stone.player === 0 ? `x` : `o`, number: null })),
            frame: field,
            field,
            mark: null,
            lastMove: [],
            winLine: [],
            lines: undefined,
            preview: undefined,
            judgment: undefined,
            visuals: [],
        });
    });
});
