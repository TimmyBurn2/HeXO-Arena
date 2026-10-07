import { analysisTreeNodeCap, gameTurnCap, playerOf, sideOf, type HtttxNotes, type HtttxTag, type Side } from '@hexo-arena/contract';
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
 * What an imported text said of a turn's stones, each the info and visuals of the position after it:
 * the first stone's and the second's; a turn of one stone has its first alone, the final move's notes joined to it.
 */
export interface TurnNotes {
    readonly first: HtttxNotes;
    readonly second: HtttxNotes | null;
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
    readonly notes: TurnNotes | null;
    readonly children: readonly NodeId[];
}

/**
 * A turn's first stone alone, where an imported line ends on the final move short of a six:
 * its mover still holds the second stone, and placing it plays the whole turn from the parent.
 * It ends its line, so a turn played from it is played from the parent.
 * `key` names the board with the lone stone on it, which no reading holds, since positions are read at whole turns only.
 */
export interface HalfNode {
    readonly kind: `half`;
    readonly id: NodeId;
    readonly parent: NodeId;
    readonly turn: number;
    readonly side: Side;
    readonly cell: Coord;
    readonly key: string;
    readonly notes: TurnNotes | null;
    readonly children: readonly [];
}

/** A node of a move tree. */
export type TreeNode = RootNode | TurnNode | HalfNode;

/** A node after the root: a turn, or a half-turn. */
export type PlayedNode = TurnNode | HalfNode;

/**
 * Turns played from a root, as a tree whose first children make the main line.
 * It also remembers each node's last visited child, which stepping forward follows.
 */
export interface MoveTree {
    readonly root: TreeRoot;
    readonly nodes: ReadonlyMap<NodeId, TreeNode>;
    readonly nextId: NodeId;
    readonly lastVisited: ReadonlyMap<NodeId, NodeId>;
    /** The tags of the text the tree was imported from, such as the game's name and players; none for any other tree. */
    readonly tags: readonly HtttxTag[];
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

/** A tree holding only its root, and the tags of the text it comes from, if any. */
export function newTree(root: TreeRoot, tags: readonly HtttxTag[] = []): MoveTree {
    const node: RootNode = { kind: `root`, id: rootId, turn: 0, key: positionKey(startOf(root)), children: [] };
    return { root, nodes: new Map([[rootId, node]]), nextId: rootId + 1, lastVisited: new Map(), tags };
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
        node = node.kind === `root` ? undefined : tree.nodes.get(node.parent);
    }
    return path.reverse();
}

/** The whole turns from the root to this node, for export or a link; a half-turn's lone stone is left out, as neither holds it. */
export function lineTo(tree: MoveTree, id: NodeId): TurnCells[] {
    return turnNodes(tree, pathTo(tree, id)).map((node) => node.cells);
}

/** The node whose position is read, linked, and exported for this one: a half-turn's parent, since positions are whole turns. */
export function wholeAt(tree: MoveTree, id: NodeId): NodeId {
    const node = tree.nodes.get(id);
    return node?.kind === `half` ? node.parent : id;
}

/**
 * The position after this node's turn, the root's start position for the root;
 * after a half-turn, its stone on the board with its mover still to place the second.
 */
export function positionAt(tree: MoveTree, id: NodeId): Setup {
    const start = startOf(tree.root);
    const nodes = pathTo(tree, id).flatMap((step) => {
        const node = tree.nodes.get(step);
        return node === undefined || node.kind === `root` ? [] : [node];
    });
    const last = nodes.at(-1);
    if (last === undefined) return start;
    const stones = [...start.stones];
    for (const node of nodes) {
        const player = playerOf(node.side);
        for (const cell of node.kind === `half` ? [node.cell] : node.cells) stones.push({ x: cell.x, y: cell.y, player });
    }
    return { stones, toMove: last.kind === `half` ? playerOf(last.side) : otherPlayer(playerOf(last.side)) };
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
 * From a half-turn, the turn is played from its parent, the position its turn left from.
 */
export function play(tree: MoveTree, at: NodeId, cells: TurnCells): TreePlay {
    const from = wholeAt(tree, at);
    const result = playOn(tree, from, cells, () => positionAt(tree, from));
    return result.ok ? { ok: true, tree: result.tree, node: result.node } : result;
}

/** Play turns one after another from a node, a half-turn's parent for a half-turn, stopping at the first refused. */
export function playLineFrom(tree: MoveTree, at: NodeId, turns: readonly TurnCells[]): TreePlay {
    if (!tree.nodes.has(at)) return { ok: false, refusal: { kind: `unknown-node` } };
    let reached = { tree, node: wholeAt(tree, at) };
    // The position is carried along rather than rebuilt from the root for each turn.
    let position = positionAt(tree, reached.node);
    for (const cells of turns) {
        const result = playOn(reached.tree, reached.node, cells, () => position);
        if (!result.ok) return result;
        reached = { tree: result.tree, node: result.node };
        position = result.position ?? positionAt(result.tree, result.node);
    }
    return { ok: true, ...reached };
}

/**
 * Play a lone stone from a node, as a line ending on the final move does:
 * a turn of one stone where it completes six, else a half-turn, which ends its line.
 * A child already holding it is visited instead, as `play` visits one.
 */
export function playLone(tree: MoveTree, at: NodeId, cell: Coord): TreePlay {
    const from = wholeAt(tree, at);
    const whole = play(tree, from, [cell]);
    if (whole.ok || whole.refusal.kind !== `rules` || whole.refusal.rejection.kind !== `turn-unfinished`) return whole;
    const parent = tree.nodes.get(from);
    if (parent === undefined || parent.kind === `half`) return { ok: false, refusal: { kind: `unknown-node` } };
    const existing = parent.children.find((child) => {
        const node = tree.nodes.get(child);
        return node?.kind === `half` && node.cell.x === cell.x && node.cell.y === cell.y;
    });
    if (existing !== undefined) return { ok: true, tree: remember(tree, from, existing), node: existing };
    if (tree.nodes.size - 1 >= analysisTreeNodeCap) return { ok: false, refusal: { kind: `node-cap`, limit: analysisTreeNodeCap } };
    const id = tree.nextId;
    const before = positionAt(tree, from);
    const key = positionKey({ stones: [...before.stones, { x: cell.x, y: cell.y, player: before.toMove }], toMove: before.toMove });
    const node: HalfNode = { kind: `half`, id, parent: from, turn: parent.turn + 1, side: sideOf(before.toMove), cell, key, notes: null, children: [] };
    const nodes = new Map(tree.nodes);
    nodes.set(id, node);
    nodes.set(from, { ...parent, children: [...parent.children, id] });
    return { ok: true, tree: remember({ ...tree, nodes, nextId: id + 1 }, from, id), node: id };
}

/** Set what an imported text said of a turn's or half-turn's stones; the root and an unknown node take none. */
export function annotate(tree: MoveTree, id: NodeId, notes: TurnNotes | null): MoveTree {
    const node = tree.nodes.get(id);
    if (node === undefined || node.kind === `root`) return tree;
    return { ...tree, nodes: new Map(tree.nodes).set(id, { ...node, notes }) };
}

type PlayedOn =
    | { readonly ok: true; readonly tree: MoveTree; readonly node: NodeId; readonly position: Setup | null }
    | { readonly ok: false; readonly refusal: TreeRefusal };

// `position` is asked for only when the turn is new; a visited child's
// position is left for the caller to find, as null.
function playOn(tree: MoveTree, at: NodeId, cells: TurnCells, position: () => Setup): PlayedOn {
    const parent = tree.nodes.get(at);
    // A half-turn ends its line; `play` plays from its parent instead.
    if (parent === undefined || parent.kind === `half`) return { ok: false, refusal: { kind: `unknown-node` } };
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
        notes: null,
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
        if (node === undefined || node.kind === `root`) continue;
        const parent = nodes.get(node.parent);
        if (parent === undefined || parent.kind === `half`) continue;
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
    if (node === undefined || node.kind === `root`) return { tree, focus: node === undefined ? rootId : id };
    const removed = new Set<NodeId>();
    const pending: NodeId[] = [id];
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
        removed.add(next);
        pending.push(...(tree.nodes.get(next)?.children ?? []));
    }
    const nodes = new Map([...tree.nodes].filter(([key]) => !removed.has(key)));
    const parent = nodes.get(node.parent);
    if (parent !== undefined && parent.kind !== `half`) nodes.set(parent.id, { ...parent, children: parent.children.filter((child) => child !== id) });
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
    return node === undefined || node.kind === `root` ? rootId : node.parent;
}

/** One turn forward: into the last visited child while it exists, else the main line; null at a line's end. */
export function stepForward(tree: MoveTree, id: NodeId): NodeId | null {
    const node = tree.nodes.get(id);
    if (node === undefined) return null;
    const remembered = tree.lastVisited.get(id);
    const children: readonly NodeId[] = node.children;
    if (remembered !== undefined && children.includes(remembered)) return remembered;
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
    if (node === undefined || node.kind === `root`) return null;
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
