import { valueWords, type AxialCoord, type Judgment, type Side, type ValueText } from '@hexo-arena/contract';
import { afterWords } from './reading-view';
import type { Reading } from './sources';
import { nodeAt, type MoveTree, type NodeId, type TurnNode } from './tree';

/** What a move tree row says beside its turn: a reading's verdict on it, and the value after it. */
export interface RowFact {
    readonly judgment: Judgment | null;
    readonly value: ValueText | null;
}

/**
 * Each turn's row facts in a tree, from the readings a source holds, as a game's reading words them:
 * the value after a turn is its own line's when the reading before it listed the turn,
 * else the next mover's best line's at the position after, counting that line's own turn; a turn that completes six wins.
 * `read` finds a source's reading of a position by key, `sourceFor` names the source by the side to move there.
 */
export function rowFacts(tree: MoveTree, read: (key: string, sourceId: string) => Reading | null, sourceFor: (side: Side) => string): Map<NodeId, RowFact> {
    const facts = new Map<NodeId, RowFact>();
    for (const node of tree.nodes.values()) {
        if (node.kind !== `turn`) continue;
        const parent = nodeAt(tree, node.parent);
        const value = parent === undefined ? null : valueAfter(node, parent.key, read, sourceFor);
        if (value !== null) facts.set(node.id, { judgment: null, value });
    }
    return facts;
}

function valueAfter(node: TurnNode, parentKey: string, read: (key: string, sourceId: string) => Reading | null, sourceFor: (side: Side) => string): ValueText | null {
    const before = read(parentKey, sourceFor(node.side));
    // A six is won whatever the reading, but says so only where the source read the position it was played from.
    if (node.win !== null) return before === null ? null : valueWords({}, { kind: `line`, mover: node.side, completesSix: true }, before.values);
    const listed = before?.lines.find((line) => sameCells(line.cells, node.cells));
    if (listed !== undefined && before !== null) return afterWords({ kind: `played`, evaluation: listed.evaluation }, before.values);
    const next: Side = node.side === `x` ? `o` : `x`;
    const reading = read(node.key, sourceFor(next));
    const best = reading?.lines[0]?.evaluation;
    return reading === null || best === undefined ? null : afterWords({ kind: `next`, evaluation: best, mover: next }, reading.values);
}

function sameCells(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
    return a.length === b.length && a.every((cell) => b.some((each) => each.x === cell.x && each.y === cell.y));
}
