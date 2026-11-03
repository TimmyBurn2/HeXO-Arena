import {
    analysisStoneCap,
    forcedWinner,
    playerOf,
    writeHtttx,
    type AnalyzerValues,
    type HtttxEvaluation,
    type HtttxInfo,
    type HtttxLine,
    type HtttxNotes,
    type HtttxSetup,
    type HtttxStone,
    type HtttxTag,
    type HtttxTurn,
    type HtttxV1Document,
    type HtttxV2Document,
    type HtttxVisual,
    type NotationCell,
} from '@hexo-arena/contract';
import { originSetup, positionKey, setupProblem, type Player, type Setup, type Win } from '@hexo-arena/rules';
import { htttxSetupOf, type NotationError, type NotationRead } from './notation';
import type { AfterReading } from './reading-view';
import {
    annotate,
    lineTo,
    mainLine,
    newTree,
    nodeAt,
    play,
    playLone,
    positionAt,
    rootId,
    type MoveTree,
    type NodeId,
    type PlayedNode,
    type TreeNode,
    type TreeRefusal,
    type TreeRoot,
    type TurnNotes,
} from './tree';

/** A v2 document read into a tree from the origin or its setup: the tree, the text's tags, and its main line's length, variations, and end. */
export interface Study {
    readonly tree: MoveTree;
    readonly tags: readonly HtttxTag[];
    /** The main line's last node, where the board opens. */
    readonly end: NodeId;
    /** Turns along the main line, a closing half-turn counted. */
    readonly turns: number;
    /** Lines beside the main line, nested ones counted. */
    readonly variations: number;
    readonly position: Setup;
    readonly win: Win | null;
    /** Whether the main line ends on a half-turn, its mover a stone short. */
    readonly half: boolean;
}

// A line being played into the tree: the next turn to play, the node it is played from,
// and, once played, the node it reached and how many of its variations are under way.
interface Walk {
    readonly line: HtttxLine;
    index: number;
    from: NodeId;
    reached: NodeId | null;
    variations: number;
}

/**
 * A v2 document as a tree from its setup, every turn played by the rules:
 * a set-up board, its visuals on the root, or the origin where the setup is the default one or there is none;
 * the main line as the first children, each variation as the next child of the node its first turn is played from,
 * nested ones the same way, in the order the text writes them.
 * A turn of one stone and the final move is a turn where it completes six, else a half-turn.
 * Each node keeps what the text said of its stones; a turn the tree already holds keeps the notes it had unless the text gives some.
 * Refused: a setup the board cannot be played from; naming the turn, a turn the rules refuse, a line past the turn cap, a tree past its node cap.
 */
export function studyOf(document: HtttxV2Document): NotationRead<Study> {
    const start = document.setup === null ? originSetup : setupOf(document.setup);
    const problem = setupProblem(start, analysisStoneCap);
    if (problem !== null) return { ok: false, error: { kind: `setup`, problem } };
    const root: TreeRoot = positionKey(start) === positionKey(originSetup) ? { kind: `origin` } : { kind: `setup`, start };
    let tree = newTree(root, document.tags, document.setup?.visuals ?? []);
    let variations = 0;
    // Played depth first, a stack rather than recursion, so the children of
    // each node keep the text's order and no nesting runs out of stack.
    const walks: Walk[] = document.line === null ? [] : [{ line: document.line, index: 0, from: rootId, reached: null, variations: 0 }];
    for (let walk = walks.at(-1); walk !== undefined; walk = walks.at(-1)) {
        const turn = walk.line[walk.index];
        if (turn === undefined) {
            walks.pop();
            continue;
        }
        if (walk.reached === null) {
            const played = turn.second.kind === `stone` ? play(tree, walk.from, [turn.first.cell, turn.second.cell]) : playLone(tree, walk.from, turn.first.cell);
            if (!played.ok) return { ok: false, error: refusalError(played.refusal) };
            const notes = notesOf(turn);
            tree = notes === null ? played.tree : annotate(played.tree, played.node, notes);
            walk.reached = played.node;
        }
        const variation = turn.variations[walk.variations];
        if (variation !== undefined) {
            walk.variations += 1;
            variations += 1;
            walks.push({ line: variation, index: 0, from: walk.from, reached: null, variations: 0 });
            continue;
        }
        walk.from = walk.reached;
        walk.reached = null;
        walk.variations = 0;
        walk.index += 1;
    }
    // Building visits every variation; stepping forward should follow the main line.
    tree = { ...tree, lastVisited: new Map() };
    const line = mainLine(tree);
    const end = line.at(-1) ?? rootId;
    const last = nodeAt(tree, end);
    return {
        ok: true,
        value: {
            tree,
            tags: document.tags,
            end,
            turns: line.length - 1,
            variations,
            position: positionAt(tree, end),
            win: last?.kind === `turn` ? last.win : null,
            half: last?.kind === `half`,
        },
    };
}

function setupOf(setup: HtttxSetup): Setup {
    const stones = (cells: readonly NotationCell[], player: Player) => cells.map(({ x, y }) => ({ x, y, player }));
    return { stones: [...stones(setup.x, 0), ...stones(setup.o, 1)], toMove: playerOf(setup.first) };
}

function refusalError(refusal: TreeRefusal): NotationError {
    switch (refusal.kind) {
        case `rules`:
            return { kind: `illegal`, turn: refusal.turn, cell: refusal.cell, rejection: refusal.rejection };
        case `node-cap`:
            return { kind: `tree-cap`, limit: refusal.limit };
        case `turn-cap`:
            return { kind: `too-many-turns`, limit: refusal.limit };
        case `unknown-node`:
            // The reader ends a line at its final move, so every turn is played from a node the tree holds.
            throw new Error(`a turn was played from a node the tree does not hold`);
    }
}

// A turn's notes as the tree keeps them: the final move's join its turn's first stone,
// the position they describe, its info where it gives any and its visuals after the stone's.
function notesOf(turn: HtttxTurn): TurnNotes | null {
    const first = noted(turn.first);
    const notes: TurnNotes =
        turn.second.kind === `stone`
            ? { first, second: noted(turn.second) }
            : {
                  first: {
                      info: joinedInfo(first.info, turn.second.info),
                      visuals: [...first.visuals, ...turn.second.visuals],
                  },
                  second: null,
              };
    const empty = (each: HtttxNotes | null) => each === null || (each.info === null && each.visuals.length === 0);
    return empty(notes.first) && empty(notes.second) ? null : notes;
}

function noted(move: HtttxNotes): HtttxNotes {
    return { info: move.info, visuals: move.visuals };
}

function joinedInfo(stone: HtttxInfo | null, final: HtttxInfo | null): HtttxInfo | null {
    if (stone === null || final === null) return final ?? stone;
    return { clockMs: final.clockMs ?? stone.clockMs, evaluation: final.evaluation ?? stone.evaluation };
}

/** The notes of the position a node shows: its turn's last stone's, the first's for a turn of one stone or a half-turn. */
export function shownNotes(node: PlayedNode): HtttxNotes | null {
    const notes = node.notes;
    return notes === null ? null : (notes.second ?? notes.first);
}

/** The visuals of the position a node shows: the setup's on the root, else its shown notes'. */
export function shownVisuals(node: TreeNode): readonly HtttxVisual[] {
    return node.kind === `root` ? node.visuals : (shownNotes(node)?.visuals ?? []);
}

/** A kind of note an imported text can carry. */
export type ImportedKind = `clocks` | `evaluations` | `highlights` | `labels`;

/** The kinds of note a tree's imported text carries, in that order; none for a tree no text annotated. */
export function importedKinds(tree: MoveTree): ImportedKind[] {
    const notes = [...tree.nodes.values()].flatMap((node): HtttxNotes[] => {
        if (node.kind === `root`) return [{ info: null, visuals: node.visuals }];
        return node.notes === null ? [] : [node.notes.first, node.notes.second ?? node.notes.first];
    });
    const has = {
        clocks: notes.some((each) => each.info?.clockMs !== null && each.info?.clockMs !== undefined),
        evaluations: notes.some((each) => each.info?.evaluation !== null && each.info?.evaluation !== undefined),
        highlights: notes.some((each) => each.visuals.some((visual) => visual.highlight !== null || visual.label === null)),
        labels: notes.some((each) => each.visuals.some((visual) => visual.label !== null)),
    };
    return ([`clocks`, `evaluations`, `highlights`, `labels`] as const).filter((kind) => has[kind]);
}

/** What an export adds to each whole turn's last stone: an evaluation and the mover's clock after it, either or both. */
export interface ExportAdditions {
    readonly evaluation: (node: PlayedNode) => HtttxEvaluation | null;
    readonly clock: (node: PlayedNode) => number | null;
}

/** No additions: the tree and its imported notes alone. */
export const noAdditions: ExportAdditions = { evaluation: () => null, clock: () => null };

/**
 * The tree as a v2 document: a set-up board's setup, or the origin's where the root shows visuals;
 * the main line, every variation where it leaves, nested ones inside,
 * each turn numbered from the root, a turn of one stone and a half-turn ending on the final move.
 * Imported notes stay with their stones and win; `additions` give each whole turn's last stone an evaluation and a clock
 * only where the imported text gives it none.
 */
export function studyDocument(tree: MoveTree, tags: readonly HtttxTag[], additions: ExportAdditions = noAdditions): HtttxV2Document {
    const root = nodeAt(tree, rootId);
    const visuals = root?.kind === `root` ? root.visuals : [];
    const setup = tree.root.kind === `setup` || visuals.length > 0 ? htttxSetupOf(positionAt(tree, rootId), visuals) : null;
    const first = root?.children[0];
    return { version: 2, tags, setup, line: first === undefined ? null : lineFrom(tree, first, additions) };
}

/** The main line's whole turns as a v1 document, for tools that read only v1; a closing half-turn is left out. */
export function mainLineDocument(tree: MoveTree, tags: readonly HtttxTag[]): HtttxV1Document {
    return { version: 1, tags, turns: lineTo(tree, mainLine(tree).at(-1) ?? rootId) };
}

/** A tree as text: v2 with every variation, or v1 with the main line alone; a set-up board, which v1 cannot hold, always v2. */
export function studyText(tree: MoveTree, tags: readonly HtttxTag[], version: 1 | 2, additions: ExportAdditions = noAdditions): string {
    if (version === 1 && tree.root.kind !== `setup`) return writeHtttx(mainLineDocument(tree, tags));
    return writeHtttx(studyDocument(tree, tags, additions));
}

// Variation depth is bounded by the tree's node cap, so recursion here stays shallow.
function lineFrom(tree: MoveTree, first: NodeId, additions: ExportAdditions): HtttxLine {
    const turns: HtttxTurn[] = [];
    for (let id: NodeId | undefined = first; id !== undefined; ) {
        const node = nodeAt(tree, id);
        if (node === undefined || node.kind === `root`) break;
        const parent = nodeAt(tree, node.parent);
        const others = parent?.children[0] === node.id ? parent.children.slice(1) : [];
        turns.push({ ...movesOf(node, additions), number: node.turn, variations: others.map((other) => lineFrom(tree, other, additions)) });
        id = node.kind === `turn` ? node.children[0] : undefined;
    }
    const [head, ...rest] = turns;
    if (head === undefined) throw new Error(`a line holds its first node`);
    return [head, ...rest];
}

function movesOf(node: PlayedNode, additions: ExportAdditions): Pick<HtttxTurn, `first` | `second`> {
    const none: HtttxNotes = { info: null, visuals: [] };
    const notes = node.notes ?? { first: none, second: null };
    const stone = (cell: { readonly x: number; readonly y: number }, own: HtttxNotes, last: boolean): HtttxStone => ({
        kind: `stone`,
        cell,
        info: last && node.kind === `turn` ? addedInfo(own.info, additions.evaluation(node), additions.clock(node)) : own.info,
        visuals: own.visuals,
    });
    const final = { kind: `final`, info: null, visuals: [] } as const;
    if (node.kind === `half`) return { first: stone(node.cell, notes.first, true), second: final };
    const [one, two] = node.cells;
    if (two === undefined) return { first: stone(one, notes.first, true), second: final };
    return { first: stone(one, notes.first, false), second: stone(two, notes.second ?? none, true) };
}

function addedInfo(own: HtttxInfo | null, evaluation: HtttxEvaluation | null, clock: number | null): HtttxInfo | null {
    const info = { clockMs: own?.clockMs ?? clock, evaluation: own?.evaluation ?? evaluation };
    return info.clockMs === null && info.evaluation === null ? null : info;
}

/**
 * The evaluation of the board after a turn as the notation writes it, from a reading around the turn:
 * a forced win as `#n`, htttx's win_in from that board, which `writeHtttx` maps one to one;
 * else, where the analyzer's values mean expected, `%`, its scaled value in hundredths, 100 (2 P(x wins) - 1);
 * a raw value writes none, as its numbers carry no win chance.
 * The played turn's own line describes that board; the next mover's best line describes the board after it,
 * so a win it finds counts that line's turn too, and a line completing six is the next mover's win in 1.
 */
export function notationEvaluation(after: AfterReading, values: AnalyzerValues): HtttxEvaluation | null {
    const { evaluation } = after;
    const winner = forcedWinner(evaluation);
    const winIn = evaluation.win_in ?? 0;
    if (winner !== null) {
        const sign = winner === `x` ? 1 : -1;
        if (after.kind === `played`) return { kind: `closed`, turns: winIn };
        return { kind: `closed`, turns: winner === after.mover && Math.abs(winIn) === 1 ? sign : sign * (Math.abs(winIn) + 1) };
    }
    const heuristic = evaluation.heuristic;
    if (values.meaning !== `expected` || heuristic === undefined || !Number.isFinite(heuristic)) return null;
    // The trailing + 0 turns -0 into 0, which the notation never writes.
    return { kind: `open`, value: Math.round(100 * Math.max(-1, Math.min(1, heuristic / values.scale))) + 0 };
}
