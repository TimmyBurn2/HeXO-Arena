import { describe, expect, it } from 'vitest';
import type { Setup, Stone, TurnCells } from '@hexo-arena/rules';
import { analysisStorageKey } from '../src/analysis/storage-key';
import {
    back,
    blankBoard,
    deletable,
    deleteFrom,
    floorOf,
    forward,
    gameTree,
    goTo,
    holdsOwnTurns,
    mainLineAt,
    markCell,
    promoteLine,
    readStoredBoard,
    restoreBoard,
    rootOfStored,
    standOn,
    storeBoard,
    switchLine,
    toEnd,
    toStart,
    turnsOfGame,
    unmark,
    type AnalysisState,
} from '../src/analysis/state';
import { isMainLine, lineTo, mainLine, newTree, nodeAt, positionAt, rootId } from '../src/analysis/tree';
import { workedTurns } from './analysis-lines';

// Mark both cells of a turn, failing loudly on a refusal.
function playTurnOf(state: AnalysisState, cells: TurnCells): AnalysisState {
    let next = state;
    for (const cell of cells) {
        const marked = markCell(next, cell);
        if (marked.refusal !== null) throw new Error(`refused: ${JSON.stringify(marked.refusal)}`);
        next = marked.state;
    }
    return next;
}

function line(state: AnalysisState, turns: readonly TurnCells[]): AnalysisState {
    return turns.reduce(playTurnOf, state);
}

const a1: TurnCells = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
];
const a2: TurnCells = [
    { x: -1, y: 0 },
    { x: 0, y: -1 },
];
const b1: TurnCells = [
    { x: 2, y: 0 },
    { x: 3, y: 0 },
];

// A game of four turns, the first of them drawn by the server.
const gameTurns = workedTurns;
const openingPlies = 3;

describe('marking cells on the analysis board', () => {
    it('marks a first stone, takes it back on a second click, and plays the turn on another cell', () => {
        const first = markCell(blankBoard(), { x: 1, y: 0 });
        expect(first).toMatchObject({ refusal: null, state: { mark: { x: 1, y: 0 } } });
        expect(markCell(first.state, { x: 1, y: 0 }).state.mark).toBeNull();
        const played = markCell(first.state, { x: 0, y: 1 }).state;
        expect(played.mark).toBeNull();
        expect(nodeAt(played.tree, played.at)).toMatchObject({ kind: `turn`, turn: 1, side: `o`, cells: a1 });
    });

    it('visits the turn the tree already holds, in either order of its stones, rather than adding one', () => {
        const played = playTurnOf(blankBoard(), a1);
        const again = playTurnOf(back(played), [a1[1], a1[0]] as TurnCells);
        expect(again.at).toBe(played.at);
        expect(again.tree.nodes.size).toBe(2);
    });

    it('refuses a taken cell, naming the turn and the cell, and keeps the mark it had', () => {
        const marked = markCell(blankBoard(), { x: 1, y: 0 }).state;
        expect(markCell(marked, { x: 0, y: 0 })).toEqual({
            state: marked,
            refusal: { kind: `rules`, turn: 1, cell: { x: 0, y: 0 }, rejection: { kind: `cell-occupied` } },
        });
        expect(markCell(blankBoard(), { x: 0, y: 0 }).refusal).toMatchObject({ kind: `rules`, turn: 1, rejection: { kind: `cell-occupied` } });
    });

    it('plays a first stone that completes six as a turn of its own, after which the board takes no stone', () => {
        const fives: Stone[] = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0, player: 0 }));
        const start: Setup = { stones: [...fives, { x: 0, y: 2, player: 1 }], toMove: 0 };
        const won = markCell(standOn(newTree({ kind: `setup`, start })), { x: 5, y: 0 });
        expect(won.refusal).toBeNull();
        expect(nodeAt(won.state.tree, won.state.at)).toMatchObject({ cells: [{ x: 5, y: 0 }], win: { player: 0 } });
        expect(markCell(won.state, { x: 1, y: 1 }).refusal).toMatchObject({ rejection: { kind: `game-finished` } });
    });

    it('clears a mark on demand and when the board moves', () => {
        const marked = markCell(playTurnOf(blankBoard(), a1), { x: -1, y: 0 }).state;
        expect(unmark(marked).mark).toBeNull();
        expect(back(marked).mark).toBeNull();
    });
});

describe('stepping through the tree', () => {
    it('steps back to the root and forward along the child last visited', () => {
        const main = line(blankBoard(), [a1, a2]);
        const variation = playTurnOf(back(main), b1);
        const atA1 = back(variation);
        expect(nodeAt(forward(atA1).tree, forward(atA1).at)).toMatchObject({ cells: b1 });
        expect(toStart(variation).at).toBe(rootId);
        expect(back(toStart(variation)).at).toBe(rootId);
        expect(toEnd(toStart(variation)).at).toBe(variation.at);
    });

    it('switches between the variations played from one position', () => {
        const main = line(blankBoard(), [a1, a2]);
        const variation = playTurnOf(back(main), b1);
        expect(switchLine(variation, -1).at).toBe(main.at);
        expect(switchLine(switchLine(variation, -1), 1).at).toBe(variation.at);
        expect(switchLine(variation, 1).at).toBe(variation.at);
        expect(isMainLine(variation.tree, variation.at)).toBe(false);
    });

    it('opens a stored game on its main line and never steps back into its drawn opening', () => {
        const state = standOn(gameTree(`g_1`, openingPlies, gameTurns));
        const floor = floorOf(state.tree);
        expect(nodeAt(state.tree, floor)?.turn).toBe(1);
        expect(goTo(state, rootId).at).toBe(floor);
        expect(back(goTo(state, floor)).at).toBe(floor);
        expect(nodeAt(state.tree, mainLineAt(state.tree, 3))?.turn).toBe(3);
        expect(mainLineAt(state.tree, 0)).toBe(floor);
        expect(nodeAt(state.tree, mainLineAt(state.tree, 99))?.turn).toBe(4);
    });

    it('reads a stored game whose last turn is the one stone that won', () => {
        const cells = [{ x: 0, y: 0 }, ...[1, 2].flatMap((n) => [{ x: n, y: 0 }, { x: n, y: 1 }]), { x: 3, y: 0 }];
        expect(turnsOfGame(cells)).toEqual([
            [{ x: 1, y: 0 }, { x: 1, y: 1 }],
            [{ x: 2, y: 0 }, { x: 2, y: 1 }],
            [{ x: 3, y: 0 }],
        ]);
    });
});

describe('editing the tree', () => {
    it('promotes a variation to the main line', () => {
        const main = line(blankBoard(), [a1, a2]);
        const variation = playTurnOf(back(main), b1);
        const promoted = promoteLine(variation, variation.at);
        expect(mainLine(promoted.tree).at(-1)).toBe(variation.at);
    });

    it('deletes a turn with every turn after it, stepping back when the board stood on one', () => {
        const main = line(blankBoard(), [a1, a2]);
        const first = back(main).at;
        const removed = deleteFrom(main, [], first);
        expect(removed.at).toBe(rootId);
        expect(removed.tree.nodes.size).toBe(1);
        const kept = deleteFrom(back(main), [], main.at);
        expect(kept.at).toBe(first);
        expect(kept.tree.nodes.size).toBe(2);
    });

    it('keeps a stored game\'s own turns, opening and all, and deletes the variations played from them', () => {
        const state = standOn(gameTree(`g_1`, openingPlies, gameTurns));
        for (const turn of [1, 2, 4]) {
            const id = mainLineAt(state.tree, turn);
            expect(deletable(state.tree, gameTurns, id)).toBe(false);
            expect(deleteFrom(state, gameTurns, id)).toBe(state);
        }
        const variation = playTurnOf(back(toEnd(state)), [
            { x: 4, y: 0 },
            { x: 4, y: 1 },
        ]);
        const promoted = promoteLine(variation, variation.at);
        expect(deletable(promoted.tree, gameTurns, promoted.at)).toBe(true);
        expect(deleteFrom(promoted, gameTurns, promoted.at).tree.nodes.size).toBe(state.tree.nodes.size);
    });

    it('counts only turns the address cannot bring back as the reader\'s own', () => {
        expect(holdsOwnTurns(blankBoard().tree, [])).toBe(false);
        expect(holdsOwnTurns(playTurnOf(blankBoard(), a1).tree, [])).toBe(true);
        const game = standOn(gameTree(`g_1`, openingPlies, gameTurns));
        expect(holdsOwnTurns(game.tree, gameTurns)).toBe(false);
        const own = playTurnOf(toEnd(game), [
            { x: 4, y: 0 },
            { x: 4, y: 1 },
        ]);
        expect(holdsOwnTurns(own.tree, gameTurns)).toBe(true);
    });
});

describe('the board kept in the browser', () => {
    it('keeps its key versioned', () => {
        expect(analysisStorageKey).toBe(`hexo-arena.analysis.v1`);
    });

    it('brings back a board from the origin with its variations, the node it stood on, and its mark', () => {
        const main = line(blankBoard(), [a1, a2]);
        const variation = markCell(playTurnOf(back(main), b1), { x: 5, y: 0 }).state;
        const stored = readStoredBoard(JSON.stringify(storeBoard(variation, [])));
        if (stored === null) throw new Error(`the board did not read back`);
        const restored = restoreBoard(stored, rootOfStored(stored.root, 1));
        expect(lineTo(restored.tree, restored.at)).toEqual([a1, b1]);
        expect(mainLine(restored.tree).map((id) => nodeAt(restored.tree, id)?.turn)).toEqual([0, 1, 2]);
        expect(restored.mark).toEqual({ x: 5, y: 0 });
    });

    it('keeps a stored game by its id and its own turns by place, taking their cells from the game again', () => {
        const game = standOn(gameTree(`g_1`, openingPlies, gameTurns));
        const variation = playTurnOf(back(toEnd(game)), [
            { x: 4, y: 0 },
            { x: 4, y: 1 },
        ]);
        const promoted = promoteLine(variation, variation.at);
        const stored = storeBoard(promoted, gameTurns);
        expect(stored.root).toEqual({ kind: `game`, gameId: `g_1` });
        expect(stored.nodes.filter((node) => node.c !== undefined)).toEqual([{ p: 2, c: [[4, 0], [4, 1]] }]);
        const restored = restoreBoard(stored, rootOfStored(stored.root, openingPlies), gameTurns);
        expect(lineTo(restored.tree, restored.at)).toEqual(lineTo(promoted.tree, promoted.at));
        expect(mainLine(restored.tree).at(-1)).toBe(restored.at);
        expect(floorOf(restored.tree)).toBe(mainLineAt(restored.tree, 1));
    });

    it('brings back a set-up root with its stones and player to move', () => {
        const start: Setup = { stones: [{ x: 3, y: 3, player: 1 }], toMove: 0 };
        const board = playTurnOf(standOn(newTree({ kind: `setup`, start })), [
            { x: 4, y: 3 },
            { x: 5, y: 3 },
        ]);
        const stored = readStoredBoard(JSON.stringify(storeBoard(board, [])));
        if (stored === null) throw new Error(`the board did not read back`);
        const restored = restoreBoard(stored, rootOfStored(stored.root, 1));
        expect(positionAt(restored.tree, rootId)).toEqual(start);
        expect(positionAt(restored.tree, restored.at)).toEqual(positionAt(board.tree, board.at));
    });

    it('reads nothing from text it did not write', () => {
        expect(readStoredBoard(null)).toBeNull();
        expect(readStoredBoard(`{`)).toBeNull();
        expect(readStoredBoard(JSON.stringify({ root: { kind: `game`, gameId: `../x` }, nodes: [], at: -1, mark: null }))).toBeNull();
    });

    it('drops a stored turn that no longer plays, with every turn after it', () => {
        const stored = readStoredBoard(
            JSON.stringify({
                root: { kind: `origin` },
                nodes: [
                    { p: -1, c: [[1, 0], [0, 1]] },
                    { p: 0, c: [[0, 0], [9, 9]] },
                    { p: 1, c: [[-1, 0], [0, -1]] },
                    { p: 0, c: [[-1, 0], [0, -1]] },
                ],
                at: 2,
                mark: null,
            }),
        );
        if (stored === null) throw new Error(`the board did not read back`);
        const restored = restoreBoard(stored, rootOfStored(stored.root, 1));
        expect(restored.tree.nodes.size).toBe(3);
        expect(restored.at).toBe(rootId);
    });
});
