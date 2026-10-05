import { analysisTreeNodeCap, gameTurnCap, playerOf, sideOf, type Side } from '@hexo-arena/contract';
import {
    originSetup,
    otherPlayer,
    playTurn,
    positionKey,
    type Coord,
    type Setup,
    type TurnCells,
    type TurnRejection,
    type Win,
} from '@hexo-arena/rules';

/** Where a move tree starts: the origin, a stored game from the origin, or a set-up board. */
export type TreeRoot =
    | { readonly kind: `origin` }
    | { readonly kind: `game`; readonly gameId: string; readonly openingPlies: number }
    | { readonly kind: `setup`; readonly start: Setup };

/** A node's handle, stable while the node stays in its tree. */
export type NodeId = number;

/** The start position, before any turn; turn numbers count from it. */
export interface RootNode {
    readonly kind: `root`;
    readonly id: NodeId;
    readonly turn: 0;
    readonly key: string;
    readonly children: readonly NodeId[];
}

/**
 * A played turn; `key` names the position after it, so transpositions share it.
 * The first child continues the main line, later ones are variations.
 */
export interface TurnNode {
    readonly kind: `turn`;
    readonly id: NodeId;
    readonly parent: NodeId;
    readonly turn: number;
    readonly side: Side;
    readonly cells: TurnCells;
    readonly key: string;
    readonly win: Win | null;
    readonly children: readonly NodeId[];
}

/** A node of a move tree. */
export type TreeNode = RootNode | TurnNode;

/**
 * Turns played from a root, as a tree whose first children make the main line.
 * It also remembers each node's last visited child, which stepping forward follows.
 */
export interface MoveTree {
    readonly root: TreeRoot;
    readonly nodes: ReadonlyMap<NodeId, TreeNode>;
    readonly nextId: NodeId;
    readonly lastVisited: ReadonlyMap<NodeId, NodeId>;
}

/** The root node's handle in every tree. */
export const rootId: NodeId = 0;

/** Why a turn did not enter the tree. */
export type TreeRefusal =
    | { readonly kind: `rules`; readonly turn: number; readonly cell: Coord; readonly rejection: TurnRejection }
    | { readonly kind: `node-cap`; readonly limit: number }
    | { readonly kind: `turn-cap`; readonly limit: number }
    | { readonly kind: `unknown-node` };

/** A turn or line played into a tree: the tree and the node reached, or why not. */
export type TreePlay =
    | { readonly ok: true; readonly tree: MoveTree; readonly node: NodeId }
    | { readonly ok: false; readonly refusal: TreeRefusal };

// The position a root starts from.
function startOf(root: TreeRoot): Setup {
    return root.kind === `setup` ? root.start : originSetup;
}

/** The turns at the start of a stored game that its server drew; other roots have none. */
export function openingTurns(root: TreeRoot): number {
    return root.kind === `game` ? (root.openingPlies - 1) / 2 : 0;
}

/** A tree holding only its root. */
export function newTree(root: TreeRoot): MoveTree {
    const node: RootNode = { kind: `root`, id: rootId, turn: 0, key: positionKey(startOf(root)), children: [] };
    return { root, nodes: new Map([[rootId, node]]), nextId: rootId + 1, lastVisited: new Map() };
}

/** The node with this handle, if the tree holds it. */
export function nodeAt(tree: MoveTree, id: NodeId): TreeNode | undefined {
    return tree.nodes.get(id);
}

/** The handles from the root to this node, both included; empty for a node the tree does not hold. */
export function pathTo(tree: MoveTree, id: NodeId): NodeId[] {
    const path: NodeId[] = [];
    let node = tree.nodes.get(id);
    while (node !== undefined) {
        path.push(node.id);
        node = node.kind === `turn` ? tree.nodes.get(node.parent) : undefined;
    }
    return path.reverse();
}

/** The turns from the root to this node, for export or a link. */
export function lineTo(tree: MoveTree, id: NodeId): TurnCells[] {
    return turnNodes(tree, pathTo(tree, id)).map((node) => node.cells);
}

/** The position after this node's turn, the root's start position for the root. */
export function positionAt(tree: MoveTree, id: NodeId): Setup {
    const start = startOf(tree.root);
    const path = turnNodes(tree, pathTo(tree, id));
    const last = path.at(-1);
    if (last === undefined) return start;
    const stones = [...start.stones];
    for (const node of path) {
        const player = playerOf(node.side);
        for (const cell of node.cells) stones.push({ x: cell.x, y: cell.y, player });
    }
    return { stones, toMove: otherPlayer(playerOf(last.side)) };
}

/** The main line: the root and every first child after it. */
export function mainLine(tree: MoveTree): NodeId[] {
    const line: NodeId[] = [];
    for (let node = tree.nodes.get(rootId); node !== undefined; node = firstChild(tree, node)) line.push(node.id);
    return line;
}

/** Whether this node lies on the main line. */
export function isMainLine(tree: MoveTree, id: NodeId): boolean {
    const path = pathTo(tree, id);
    return path.length > 0 && path.every((step, index) => index === 0 || tree.nodes.get(path[index - 1] ?? rootId)?.children[0] === step);
}

/**
 * Play a turn from a node: visit the child that already holds these cells, in either order,
 * or add a child after the existing ones, a new variation unless it is the first.
 * Either way the node remembers the child as its last visited.
 */
export function play(tree: MoveTree, at: NodeId, cells: TurnCells): TreePlay {
    const result = playOn(tree, at, cells, () => positionAt(tree, at));
    return result.ok ? { ok: true, tree: result.tree, node: result.node } : result;
}

/** Play turns one after another from a node, stopping at the first refused. */
export function playLineFrom(tree: MoveTree, at: NodeId, turns: readonly TurnCells[]): TreePlay {
    if (!tree.nodes.has(at)) return { ok: false, refusal: { kind: `unknown-node` } };
    let reached = { tree, node: at };
    // The position is carried along rather than rebuilt from the root for each turn.
    let position = positionAt(tree, at);
    for (const cells of turns) {
        const result = playOn(reached.tree, reached.node, cells, () => position);
        if (!result.ok) return result;
        reached = { tree: result.tree, node: result.node };
        position = result.position ?? positionAt(result.tree, result.node);
    }
    return { ok: true, ...reached };
}

type PlayedOn =
    | { readonly ok: true; readonly tree: MoveTree; readonly node: NodeId; readonly position: Setup | null }
    | { readonly ok: false; readonly refusal: TreeRefusal };

// `position` is asked for only when the turn is new; a visited child's
// position is left for the caller to find, as null.
function playOn(tree: MoveTree, at: NodeId, cells: TurnCells, position: () => Setup): PlayedOn {
    const parent = tree.nodes.get(at);
    if (parent === undefined) return { ok: false, refusal: { kind: `unknown-node` } };
    const existing = parent.children.find((child) => {
        const node = tree.nodes.get(child);
        return node?.kind === `turn` && sameCells(node.cells, cells);
    });
    if (existing !== undefined) return { ok: true, tree: remember(tree, at, existing), node: existing, position: null };
    if (tree.nodes.size - 1 >= analysisTreeNodeCap) return { ok: false, refusal: { kind: `node-cap`, limit: analysisTreeNodeCap } };
    const turn = parent.turn + 1;
    if (turn > gameTurnCap) return { ok: false, refusal: { kind: `turn-cap`, limit: gameTurnCap } };
    const before = position();
    const played = playTurn(before, cells);
    if (!played.ok) {
        const [first, second] = cells;
        const cell = played.index === 1 && second !== undefined ? second : first;
        return { ok: false, refusal: { kind: `rules`, turn, cell, rejection: played.rejection } };
    }
    const id = tree.nextId;
    const node: TurnNode = {
        kind: `turn`,
        id,
        parent: at,
        turn,
        side: sideOf(before.toMove),
        cells,
        key: positionKey(played.setup),
        win: played.win,
        children: [],
    };
    const nodes = new Map(tree.nodes);
    nodes.set(id, node);
    nodes.set(at, { ...parent, children: [...parent.children, id] });
    return { ok: true, tree: remember({ ...tree, nodes, nextId: id + 1 }, at, id), node: id, position: played.setup };
}

/** Make the line through this node the main line, at every branching on its way from the root. */
export function promote(tree: MoveTree, id: NodeId): MoveTree {
    const nodes = new Map(tree.nodes);
    for (const step of pathTo(tree, id)) {
        const node = nodes.get(step);
        if (node?.kind !== `turn`) continue;
        const parent = nodes.get(node.parent);
        if (parent === undefined) continue;
        nodes.set(parent.id, { ...parent, children: [step, ...parent.children.filter((child) => child !== step)] });
    }
    return { ...tree, nodes };
}

/**
 * Remove a turn and everything after it; the root stays.
 * `focus` is where the board should stand afterwards: the removed turn's parent.
 */
export function removeFrom(tree: MoveTree, id: NodeId): { readonly tree: MoveTree; readonly focus: NodeId } {
    const node = tree.nodes.get(id);
    if (node?.kind !== `turn`) return { tree, focus: node === undefined ? rootId : id };
    const removed = new Set<NodeId>();
    const pending: NodeId[] = [id];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        removed.add(next);
        pending.push(...(tree.nodes.get(next)?.children ?? []));
    }
    const nodes = new Map([...tree.nodes].filter(([key]) => !removed.has(key)));
    const parent = nodes.get(node.parent);
    if (parent !== undefined) nodes.set(parent.id, { ...parent, children: parent.children.filter((child) => child !== id) });
    const lastVisited = new Map([...tree.lastVisited].filter(([from, to]) => !removed.has(from) && !removed.has(to)));
    return { tree: { ...tree, nodes, lastVisited }, focus: node.parent };
}

/** Record that the board stands on this node, so stepping forward from each node on its path returns along it. */
export function visit(tree: MoveTree, id: NodeId): MoveTree {
    const path = pathTo(tree, id);
    const lastVisited = new Map(tree.lastVisited);
    for (let index = 1; index < path.length; index += 1) {
        const from = path[index - 1];
        const to = path[index];
        if (from !== undefined && to !== undefined) lastVisited.set(from, to);
    }
    return { ...tree, lastVisited };
}

/** One turn back; the root stays where it is. */
export function stepBack(tree: MoveTree, id: NodeId): NodeId {
    const node = tree.nodes.get(id);
    return node?.kind === `turn` ? node.parent : rootId;
}

/** One turn forward: into the last visited child while it exists, else the main line; null at a line's end. */
export function stepForward(tree: MoveTree, id: NodeId): NodeId | null {
    const node = tree.nodes.get(id);
    if (node === undefined) return null;
    const remembered = tree.lastVisited.get(id);
    if (remembered !== undefined && node.children.includes(remembered)) return remembered;
    return node.children[0] ?? null;
}

/** The end of the line stepping forward follows from this node. */
export function lineEnd(tree: MoveTree, id: NodeId): NodeId {
    let at = id;
    for (let next = stepForward(tree, at); next !== null; next = stepForward(tree, at)) at = next;
    return at;
}

/** The previous or next variation beside this node; null past either end and at the root. */
export function sibling(tree: MoveTree, id: NodeId, direction: -1 | 1): NodeId | null {
    const node = tree.nodes.get(id);
    if (node?.kind !== `turn`) return null;
    const siblings = tree.nodes.get(node.parent)?.children ?? [];
    return siblings[siblings.indexOf(id) + direction] ?? null;
}

function remember(tree: MoveTree, from: NodeId, to: NodeId): MoveTree {
    if (tree.lastVisited.get(from) === to) return tree;
    return { ...tree, lastVisited: new Map(tree.lastVisited).set(from, to) };
}

function firstChild(tree: MoveTree, node: TreeNode): TreeNode | undefined {
    const first = node.children[0];
    return first === undefined ? undefined : tree.nodes.get(first);
}

function turnNodes(tree: MoveTree, path: readonly NodeId[]): TurnNode[] {
    return path.flatMap((id) => {
        const node = tree.nodes.get(id);
        return node?.kind === `turn` ? [node] : [];
    });
}

function sameCells(a: readonly Coord[], b: readonly Coord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((other) => other.x === cell.x && other.y === cell.y));
}
