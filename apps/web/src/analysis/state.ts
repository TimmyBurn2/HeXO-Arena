import { analysisTreeNodeCap, gameTurnCap } from '@hexo-arena/contract';
import { playTurn, type Coord, type TurnCells } from '@hexo-arena/rules';
import { z } from 'zod';
import {
    lineEnd,
    mainLine,
    newTree,
    nodeAt,
    openingTurns,
    pathTo,
    play,
    positionAt,
    promote,
    removeFrom,
    rootId,
    sibling,
    stepForward,
    visit,
    type MoveTree,
    type NodeId,
    type TreeNode,
    type TreeRefusal,
    type TreeRoot,
} from './tree';

/**
 * The analysis board: its move tree, the node the board stands on,
 * and a first stone marked for the turn in hand.
 */
export interface AnalysisState {
    readonly tree: MoveTree;
    readonly at: NodeId;
    readonly mark: Coord | null;
}

/** A board standing on a node of a tree, nothing marked. */
export function standOn(tree: MoveTree, at: NodeId = rootId): AnalysisState {
    const node = tree.nodes.has(at) ? at : rootId;
    return { tree: visit(tree, node), at: node, mark: null };
}

/** A new board at the origin. */
export function blankBoard(): AnalysisState {
    return standOn(newTree({ kind: `origin` }));
}

/**
 * A stored game's turns from its cells in placement order:
 * the origin is no turn, every later turn is two cells,
 * and a game won on the first stone of a turn ends on one.
 */
export function turnsOfGame(cells: readonly Coord[]): TurnCells[] {
    const turns: TurnCells[] = [];
    for (let at = 1; at < cells.length; at += 2) {
        const first = cells[at];
        const second = cells[at + 1];
        if (first === undefined) break;
        turns.push(second === undefined ? [{ x: first.x, y: first.y }] : [{ x: first.x, y: first.y }, { x: second.x, y: second.y }]);
    }
    return turns;
}

/**
 * A tree whose main line is a stored game, opening included;
 * a turn the rules refuse ends it, so a damaged record still opens up to there.
 */
export function gameTree(gameId: string, openingPlies: number, turns: readonly TurnCells[]): MoveTree {
    let tree = newTree({ kind: `game`, gameId, openingPlies });
    let at = rootId;
    for (const turn of turns) {
        const played = play(tree, at, turn);
        if (!played.ok) break;
        tree = played.tree;
        at = played.node;
    }
    return tree;
}

/**
 * The lowest node the board steps back to: the end of a stored game's opening,
 * whose turns the server drew and nobody played, else the root.
 */
export function floorOf(tree: MoveTree): NodeId {
    const line = mainLine(tree);
    return line[Math.min(openingTurns(tree.root), line.length - 1)] ?? rootId;
}

/** Whether a node lies inside a stored game's opening, before the floor, where nothing is played. */
export function inOpening(tree: MoveTree, id: NodeId): boolean {
    const floor = floorOf(tree);
    return id !== floor && pathTo(tree, floor).includes(id);
}

/** The node at a turn of the main line, held between the floor and the line's end. */
export function mainLineAt(tree: MoveTree, turn: number): NodeId {
    const line = mainLine(tree);
    const floorTurn = nodeAt(tree, floorOf(tree))?.turn ?? 0;
    return line[Math.min(Math.max(turn, floorTurn), line.length - 1)] ?? rootId;
}

/** Stand on a node; a node in the opening stands on the floor instead. */
export function goTo(state: AnalysisState, id: NodeId): AnalysisState {
    if (!state.tree.nodes.has(id)) return state;
    const node = inOpening(state.tree, id) ? floorOf(state.tree) : id;
    if (node === state.at && state.mark === null) return state;
    return { tree: visit(state.tree, node), at: node, mark: null };
}

/** One turn back, never below the floor. */
export function back(state: AnalysisState): AnalysisState {
    const node = nodeAt(state.tree, state.at);
    if (node?.kind !== `turn` || state.at === floorOf(state.tree)) return state.mark === null ? state : { ...state, mark: null };
    return goTo(state, node.parent);
}

/** One turn on, along the child last visited. */
export function forward(state: AnalysisState): AnalysisState {
    const next = stepForward(state.tree, state.at);
    return next === null ? state : goTo(state, next);
}

/** To the floor. */
export function toStart(state: AnalysisState): AnalysisState {
    return goTo(state, floorOf(state.tree));
}

/** To the end of the line stepping forward follows. */
export function toEnd(state: AnalysisState): AnalysisState {
    return goTo(state, lineEnd(state.tree, state.at));
}

/** To the variation before or after this turn's, among the turns played from the same position. */
export function switchLine(state: AnalysisState, direction: -1 | 1): AnalysisState {
    const next = sibling(state.tree, state.at, direction);
    return next === null ? state : goTo(state, next);
}

/** Make the line through a node the main line. */
export function promoteLine(state: AnalysisState, id: NodeId): AnalysisState {
    return { ...state, tree: promote(state.tree, id) };
}

/**
 * Remove a turn and every turn after it; the board steps back to its parent
 * when it stood on any of them.
 * A stored game's own turns, given as `gameTurns`, stay: its record is no variation to prune.
 */
export function deleteFrom(state: AnalysisState, gameTurns: readonly TurnCells[], id: NodeId): AnalysisState {
    if (!deletable(state.tree, gameTurns, id)) return state;
    const removed = removeFrom(state.tree, id);
    const stood = pathTo(state.tree, state.at).includes(id);
    return stood ? { tree: visit(removed.tree, removed.focus), at: removed.focus, mark: null } : { ...state, tree: removed.tree };
}

/** Whether a turn can be removed: any turn but a stored game's own, given as `gameTurns`. */
export function deletable(tree: MoveTree, gameTurns: readonly TurnCells[], id: NodeId): boolean {
    return nodeAt(tree, id)?.kind === `turn` && !inOpening(tree, id) && !gameLineIds(tree, gameTurns).has(id);
}

/** A cell's mark: the board after it, and why the cell took no stone, if it did not. */
export interface Marked {
    readonly state: AnalysisState;
    readonly refusal: TreeRefusal | null;
}

/**
 * Mark a cell for the side to move.
 * A first stone that completes six plays a one-stone turn at once;
 * any other first stone waits for its second, which plays the turn, a new variation or a turn already in the tree.
 * The marked cell again takes the mark back; a refused stone leaves the mark as it was.
 */
export function markCell(state: AnalysisState, cell: Coord): Marked {
    const { tree, at, mark } = state;
    if (mark !== null && mark.x === cell.x && mark.y === cell.y) return { state: { ...state, mark: null }, refusal: null };
    if (mark === null) {
        const cap = capRefusal(tree, at);
        const single = playTurn(positionAt(tree, at), [cell]);
        if (single.ok) return playCells(state, [cell]);
        const node = nodeAt(tree, at);
        const turn = (node?.turn ?? 0) + 1;
        if (single.rejection.kind !== `turn-unfinished`) return { state, refusal: { kind: `rules`, turn, cell, rejection: single.rejection } };
        if (cap !== null && !hasChild(tree, at, cell)) return { state, refusal: cap };
        return { state: { ...state, mark: cell }, refusal: null };
    }
    return playCells(state, [mark, cell]);
}

/** Play a whole turn from the node the board stands on, as a line of the analyzer or a pasted turn would. */
export function playCells(state: AnalysisState, cells: TurnCells): Marked {
    const played = play(state.tree, state.at, cells);
    if (!played.ok) return { state, refusal: played.refusal };
    return { state: { tree: visit(played.tree, played.node), at: played.node, mark: null }, refusal: null };
}

/** Clear the marked stone. */
export function unmark(state: AnalysisState): AnalysisState {
    return state.mark === null ? state : { ...state, mark: null };
}

// The caps refuse a new turn before its first stone is marked, unless
// the stone may still finish a turn the tree already holds.
function capRefusal(tree: MoveTree, at: NodeId): TreeRefusal | null {
    if (tree.nodes.size - 1 >= analysisTreeNodeCap) return { kind: `node-cap`, limit: analysisTreeNodeCap };
    if ((nodeAt(tree, at)?.turn ?? 0) + 1 > gameTurnCap) return { kind: `turn-cap`, limit: gameTurnCap };
    return null;
}

function hasChild(tree: MoveTree, at: NodeId, cell: Coord): boolean {
    return (nodeAt(tree, at)?.children ?? []).some((child) => {
        const node = nodeAt(tree, child);
        return node?.kind === `turn` && node.cells.some((own) => own.x === cell.x && own.y === cell.y);
    });
}

/**
 * Whether the tree holds turns its address cannot bring back:
 * any turn but a stored game's own, given as `gameTurns`.
 */
export function holdsOwnTurns(tree: MoveTree, gameTurns: readonly TurnCells[]): boolean {
    const game = gameLineIds(tree, gameTurns);
    return [...tree.nodes.keys()].some((id) => id !== rootId && !game.has(id));
}

const cellSchema = z.tuple([z.number().int(), z.number().int()]);
const playerSchema = z.union([z.literal(0), z.literal(1)]);
const storedRootSchema = z.discriminatedUnion(`kind`, [
    z.object({ kind: z.literal(`origin`) }),
    z.object({ kind: z.literal(`game`), gameId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/u) }),
    z.object({ kind: z.literal(`setup`), stones: z.array(z.tuple([z.number().int(), z.number().int(), playerSchema])).min(1), toMove: playerSchema }),
]);
// A node names its parent by its place in the list, -1 for the root, and
// holds its cells, except a stored game's own turn, which the game holds.
const storedNodeSchema = z.object({
    p: z.number().int().min(-1),
    c: z.union([z.tuple([cellSchema]), z.tuple([cellSchema, cellSchema])]).optional(),
});
const storedBoardSchema = z.object({
    root: storedRootSchema,
    nodes: z.array(storedNodeSchema).max(analysisTreeNodeCap),
    at: z.number().int().min(-1),
    mark: cellSchema.nullable(),
});

/** A board as the browser keeps it. */
export type StoredBoard = z.infer<typeof storedBoardSchema>;

/** A board's root as the browser keeps it: a stored game by its id alone. */
export type StoredRoot = StoredBoard[`root`];

/**
 * Write a board down for the browser to keep: every node in tree order, parents first and siblings in their order,
 * with a stored game's own turns, given as `gameTurns`, by place alone, since the game holds their cells.
 */
export function storeBoard(state: AnalysisState, gameTurns: readonly TurnCells[]): StoredBoard {
    const { tree } = state;
    const game = gameLineIds(tree, gameTurns);
    const index = new Map<NodeId, number>([[rootId, -1]]);
    const nodes: StoredBoard[`nodes`] = [];
    const pending: NodeId[] = [...(nodeAt(tree, rootId)?.children ?? [])].reverse();
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
        const node = nodeAt(tree, id);
        if (node?.kind !== `turn`) continue;
        index.set(id, nodes.length);
        const parent = index.get(node.parent) ?? -1;
        nodes.push(game.has(id) ? { p: parent } : { p: parent, c: storedCells(node.cells) });
        pending.push(...[...node.children].reverse());
    }
    return { root: storedRootOf(tree.root), nodes, at: index.get(state.at) ?? -1, mark: state.mark === null ? null : [state.mark.x, state.mark.y] };
}

/** The stored board in the browser's storage, or null when there is none or it does not read. */
export function readStoredBoard(raw: string | null): StoredBoard | null {
    if (raw === null) return null;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    const parsed = storedBoardSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

/** The root a stored board names, with a stored game's opening given by the game. */
export function rootOfStored(root: StoredRoot, openingPlies: number): TreeRoot {
    switch (root.kind) {
        case `origin`:
            return root;
        case `game`:
            return { kind: `game`, gameId: root.gameId, openingPlies };
        case `setup`:
            return { kind: `setup`, start: { stones: root.stones.map(([x, y, player]) => ({ x, y, player })), toMove: root.toMove } };
        default:
            return assertNever(root);
    }
}

/**
 * Rebuild a stored board on its root, playing every turn again by the rules;
 * a stored game's own turns come from `gameTurns`.
 * A turn that no longer plays is dropped with every turn after it, so a board
 * written by an older page still opens as far as it reads.
 */
export function restoreBoard(stored: StoredBoard, root: TreeRoot, gameTurns: readonly TurnCells[] = []): AnalysisState {
    let tree = newTree(root);
    const ids: (NodeId | null)[] = [];
    const depths: number[] = [];
    for (const node of stored.nodes) {
        const parent = node.p === -1 ? rootId : (ids[node.p] ?? null);
        const depth = node.p === -1 ? 1 : (depths[node.p] ?? 0) + 1;
        depths.push(depth);
        const cells = node.c === undefined ? gameTurns[depth - 1] : turnCells(node.c);
        const played = parent === null || cells === undefined ? null : play(tree, parent, cells);
        if (played === null || !played.ok) {
            ids.push(null);
            continue;
        }
        tree = played.tree;
        ids.push(played.node);
    }
    const at = stored.at === -1 ? rootId : (ids[stored.at] ?? rootId);
    const state = goTo(standOn(tree), at);
    if (stored.mark === null || state.at !== at) return state;
    // Only a stone that waits for its second comes back as a mark.
    const marked = markCell(state, { x: stored.mark[0], y: stored.mark[1] });
    return marked.state.at === at && marked.state.mark !== null ? marked.state : state;
}

// A stored game's own turns, wherever promotions have moved them among
// their siblings: from the root, the child playing the game's next turn.
function gameLineIds(tree: MoveTree, gameTurns: readonly TurnCells[]): Set<NodeId> {
    const ids = new Set<NodeId>();
    if (tree.root.kind !== `game`) return ids;
    let node = nodeAt(tree, rootId);
    for (const turn of gameTurns) {
        const next: TreeNode | undefined = node?.children.map((child) => nodeAt(tree, child)).find((child) => child?.kind === `turn` && sameTurn(child.cells, turn));
        if (next === undefined) break;
        ids.add(next.id);
        node = next;
    }
    return ids;
}

function sameTurn(a: TurnCells, b: TurnCells): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}

function storedRootOf(root: TreeRoot): StoredRoot {
    switch (root.kind) {
        case `origin`:
            return root;
        case `game`:
            return { kind: `game`, gameId: root.gameId };
        case `setup`:
            return { kind: `setup`, stones: root.start.stones.map((stone) => [stone.x, stone.y, stone.player]), toMove: root.start.toMove };
        default:
            return assertNever(root);
    }
}

function storedCells(cells: TurnCells): [[number, number]] | [[number, number], [number, number]] {
    const [first, second] = cells;
    return second === undefined ? [[first.x, first.y]] : [
        [first.x, first.y],
        [second.x, second.y],
    ];
}

function turnCells(cells: [[number, number]] | [[number, number], [number, number]]): TurnCells {
    const [first, second] = cells;
    const cell = ([x, y]: [number, number]): Coord => ({ x, y });
    return second === undefined ? [cell(first)] : [cell(first), cell(second)];
}

function assertNever(value: never): never {
    throw new Error(`unexpected value ${JSON.stringify(value)}`);
}
