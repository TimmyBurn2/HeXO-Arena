import { describe, expect, it } from 'vitest';
import { analysisTreeNodeCap, gameTurnCap } from '@hexo-arena/contract';
import { hexDistance, originSetup, positionKey, type Coord, type TurnCells } from '@hexo-arena/rules';
import { readGame } from '../src/analysis/notation';
import {
    isMainLine,
    lineEnd,
    lineTo,
    mainLine,
    newTree,
    nodeAt,
    openingTurns,
    play,
    playLineFrom,
    positionAt,
    promote,
    removeFrom,
    rootId,
    sibling,
    stepBack,
    stepForward,
    visit,
    type MoveTree,
    type NodeId,
    type TreePlay,
} from '../src/analysis/tree';
import { drawLine, workedText, workedTurns } from './analysis-lines';

function pair(ax: number, ay: number, bx: number, by: number): TurnCells {
    return [
        { x: ax, y: ay },
        { x: bx, y: by },
    ];
}

function accepted(result: TreePlay): { readonly tree: MoveTree; readonly node: NodeId } {
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
    return result;
}

// The root with two first turns, A (the main line) and B, each followed by
// one more turn, and a second reply A2 to A.
function branched() {
    const a = accepted(play(newTree({ kind: `origin` }), rootId, pair(1, 0, 0, 1)));
    const a1 = accepted(play(a.tree, a.node, pair(-1, 0, 0, -1)));
    const a2 = accepted(play(a1.tree, a.node, pair(2, 0, 3, 0)));
    const b = accepted(play(a2.tree, rootId, pair(-1, 1, -2, 2)));
    const b1 = accepted(play(b.tree, b.node, pair(1, 1, 2, 2)));
    return { tree: b1.tree, a: a.node, a1: a1.node, a2: a2.node, b: b.node, b1: b1.node };
}

describe('a new tree', () => {
    it('holds its root alone, keyed by the start position', () => {
        const tree = newTree({ kind: `origin` });
        expect([...tree.nodes.keys()]).toEqual([rootId]);
        expect(nodeAt(tree, rootId)).toMatchObject({ kind: `root`, turn: 0, key: positionKey(originSetup), children: [] });
        expect(positionAt(tree, rootId)).toEqual(originSetup);
    });

    it('starts a set-up root from its board and player to move', () => {
        const start = { stones: [{ x: 0, y: 0, player: 1 as const }], toMove: 0 as const };
        const tree = newTree({ kind: `setup`, start });
        expect(positionAt(tree, rootId)).toEqual(start);
        const first = accepted(play(tree, rootId, pair(1, 0, 2, 0)));
        expect(nodeAt(first.tree, first.node)).toMatchObject({ turn: 1, side: `x` });
    });

    it('counts a stored game\'s drawn turns as its opening', () => {
        expect(openingTurns({ kind: `game`, gameId: `g_1`, openingPlies: 5 })).toBe(2);
        expect(openingTurns({ kind: `origin` })).toBe(0);
    });
});

describe('playing into a tree', () => {
    it('adds the first turn from a node as its main line and later ones as variations', () => {
        const { tree, a, b } = branched();
        expect(nodeAt(tree, rootId)?.children).toEqual([a, b]);
        expect(isMainLine(tree, a)).toBe(true);
        expect(isMainLine(tree, b)).toBe(false);
        expect(mainLine(tree)).toEqual([rootId, a, nodeAt(tree, a)?.children[0]]);
    });

    it('numbers turns and sides from the root', () => {
        const { tree, a, a1 } = branched();
        expect(nodeAt(tree, a)).toMatchObject({ turn: 1, side: `o` });
        expect(nodeAt(tree, a1)).toMatchObject({ turn: 2, side: `x` });
    });

    it('visits the child that already holds the same cells, in either order', () => {
        const { tree, a } = branched();
        const again = accepted(play(tree, rootId, pair(0, 1, 1, 0)));
        expect(again.node).toBe(a);
        expect(again.tree.nodes.size).toBe(tree.nodes.size);
    });

    it('keys a position the same however the turns reached it', () => {
        const turns = [pair(1, 0, 0, 1), pair(-1, 0, 0, -1), pair(2, 0, 3, 0)];
        const forward = accepted(playLineFrom(newTree({ kind: `origin` }), rootId, turns));
        const swapped = accepted(playLineFrom(forward.tree, rootId, [turns[2] ?? pair(0, 0, 0, 0), turns[1] ?? pair(0, 0, 0, 0), turns[0] ?? pair(0, 0, 0, 0)]));
        expect(swapped.node).not.toBe(forward.node);
        expect(nodeAt(swapped.tree, swapped.node)?.key).toBe(nodeAt(forward.tree, forward.node)?.key);
    });

    it('reaches the same position as reading the line as text', () => {
        const root = { kind: `game`, gameId: `g_1`, openingPlies: 3 } as const;
        const loaded = accepted(playLineFrom(newTree(root), rootId, workedTurns));
        const read = readGame(workedText);
        expect(read.ok && read.value.end).toEqual(positionAt(loaded.tree, loaded.node));
        expect(lineTo(loaded.tree, loaded.node)).toEqual(workedTurns);
        expect(positionAt(loaded.tree, loaded.node).toMove).toBe(1);
    });

    it('refuses a turn the rules refuse, naming its number and cell', () => {
        const { tree, a } = branched();
        expect(play(tree, a, pair(2, 2, 1, 0))).toEqual({
            ok: false,
            refusal: { kind: `rules`, turn: 2, cell: { x: 1, y: 0 }, rejection: { kind: `cell-occupied` } },
        });
    });

    it('records a six and refuses any turn after it', () => {
        const row = [pair(0, 3, 0, 5), pair(1, 0, 2, 0), pair(2, 3, 2, 5), pair(3, 0, 4, 0), pair(4, 3, 4, 5)];
        const built = accepted(playLineFrom(newTree({ kind: `origin` }), rootId, row));
        const won = accepted(play(built.tree, built.node, [{ x: 5, y: 0 }]));
        expect(nodeAt(won.tree, won.node)).toMatchObject({ kind: `turn`, win: { player: 0 } });
        expect(play(won.tree, won.node, pair(9, 9, 9, 8))).toMatchObject({ ok: false, refusal: { kind: `rules`, rejection: { kind: `game-finished` } } });
    });

    it('refuses a node it does not hold', () => {
        expect(play(newTree({ kind: `origin` }), 42, pair(1, 0, 0, 1))).toEqual({ ok: false, refusal: { kind: `unknown-node` } });
    });

    // A line played out to the turn cap outlasts the default five seconds on a busy machine.
    it('refuses a turn past the game turn cap', () => {
        const turns = drawLine(gameTurnCap + 1);
        const long = accepted(playLineFrom(newTree({ kind: `origin` }), rootId, turns.slice(0, gameTurnCap)));
        const extra = turns.at(-1) ?? pair(0, 0, 0, 0);
        expect(play(long.tree, long.node, extra)).toEqual({ ok: false, refusal: { kind: `turn-cap`, limit: gameTurnCap } });
    }, 30_000);

    it('refuses a turn past the node cap, counting every variation', () => {
        const near: Coord[] = [];
        for (let x = -8; x <= 8; x += 1) {
            for (let y = -8; y <= 8; y += 1) {
                if ((x !== 0 || y !== 0) && hexDistance({ x, y }, { x: 0, y: 0 }) <= 8) near.push({ x, y });
            }
        }
        let tree = newTree({ kind: `origin` });
        let added = 0;
        for (let i = 0; i < near.length && added <= analysisTreeNodeCap; i += 1) {
            for (let j = i + 1; j < near.length && added <= analysisTreeNodeCap; j += 1) {
                const [first, second] = [near[i], near[j]];
                if (first === undefined || second === undefined) continue;
                const result = play(tree, rootId, [first, second]);
                if (added < analysisTreeNodeCap) {
                    tree = accepted(result).tree;
                } else {
                    expect(result).toEqual({ ok: false, refusal: { kind: `node-cap`, limit: analysisTreeNodeCap } });
                }
                added += 1;
            }
        }
        expect(tree.nodes.size).toBe(analysisTreeNodeCap + 1);
    });
});

describe('reshaping a tree', () => {
    it('promotes a line to the main line at every branching on its way', () => {
        const { tree, a, a1, a2, b, b1 } = branched();
        const promoted = promote(tree, b1);
        expect(mainLine(promoted)).toEqual([rootId, b, b1]);
        const back = promote(promoted, a2);
        expect(nodeAt(back, rootId)?.children).toEqual([a, b]);
        expect(nodeAt(back, a)?.children).toEqual([a2, a1]);
    });

    it('removes a turn and all after it, standing on its parent', () => {
        const { tree, a, a1, a2, b } = branched();
        const visited = visit(tree, a1);
        const { tree: pruned, focus } = removeFrom(visited, a);
        expect(focus).toBe(rootId);
        expect([...pruned.nodes.keys()].some((id) => [a, a1, a2].includes(id))).toBe(false);
        expect(nodeAt(pruned, rootId)?.children).toEqual([b]);
        expect(isMainLine(pruned, b)).toBe(true);
        expect(stepForward(pruned, rootId)).toBe(b);
    });

    it('keeps the root when asked to remove it', () => {
        const { tree } = branched();
        expect(removeFrom(tree, rootId)).toEqual({ tree, focus: rootId });
    });
});

describe('moving through a tree', () => {
    it('steps back to the parent, staying at the root', () => {
        const { tree, a, a1 } = branched();
        expect(stepBack(tree, a1)).toBe(a);
        expect(stepBack(tree, rootId)).toBe(rootId);
    });

    it('steps forward into the last visited child, else the main line', () => {
        const fresh = branched();
        const { a, a1, b, b1 } = fresh;
        const tree = visit(fresh.tree, a1);
        expect(stepForward(tree, rootId)).toBe(a);
        expect(stepForward(tree, a)).toBe(a1);
        const elsewhere = visit(tree, b1);
        expect(stepForward(elsewhere, rootId)).toBe(b);
        expect(lineEnd(elsewhere, rootId)).toBe(b1);
        expect(stepForward(elsewhere, b1)).toBeNull();
    });

    it('remembers a played turn as its node\'s last visited child', () => {
        const { tree, b } = branched();
        expect(stepForward(tree, rootId)).toBe(b);
    });

    it('switches between variations of one turn, stopping at either end', () => {
        const { tree, a, b } = branched();
        expect(sibling(tree, a, 1)).toBe(b);
        expect(sibling(tree, b, -1)).toBe(a);
        expect(sibling(tree, b, 1)).toBeNull();
        expect(sibling(tree, a, -1)).toBeNull();
        expect(sibling(tree, rootId, 1)).toBeNull();
    });
});
