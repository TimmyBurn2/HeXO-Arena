import { nodeAt, type MoveTree, type NodeId } from './tree';

/**
 * A turn of a variation as one token of its paragraph, with the parentheses held to it:
 * one opening before it for each alternative it starts, one closing after it for each it ends,
 * so a parenthesis never wraps away from the turn it encloses.
 */
export interface BandToken {
    readonly id: NodeId;
    readonly open: number;
    readonly close: number;
    /** Inside parentheses: an alternative within the variation. */
    readonly nested: boolean;
}

/**
 * The variations at a main-line turn, one paragraph each, in the order they were played;
 * none when the turn is the only one played there.
 */
export function bandOf(tree: MoveTree, id: NodeId): BandToken[][] {
    const node = nodeAt(tree, id);
    if (node === undefined || node.kind === `root`) return [];
    const siblings = nodeAt(tree, node.parent)?.children ?? [];
    if (siblings[0] !== id) return [];
    return siblings.slice(1).map((first) => lineTokens(tree, first, false));
}

/**
 * A line as tokens, from its first turn along its first children;
 * each alternative inside it runs in parentheses right after the token it replaces, and the line goes on after them,
 * alternatives within alternatives the same way.
 */
export function lineTokens(tree: MoveTree, first: NodeId, nested: boolean): BandToken[] {
    const tokens: BandToken[] = [{ id: first, open: 0, close: 0, nested }];
    for (let node = nodeAt(tree, first); node !== undefined; ) {
        const [main, ...alternatives] = node.children;
        if (main === undefined) break;
        tokens.push({ id: main, open: 0, close: 0, nested });
        for (const alternative of alternatives) {
            const inner = lineTokens(tree, alternative, true);
            tokens.push(
                ...inner.map((token, index) => ({
                    ...token,
                    open: token.open + (index === 0 ? 1 : 0),
                    close: token.close + (index === inner.length - 1 ? 1 : 0),
                })),
            );
        }
        node = nodeAt(tree, main);
    }
    return tokens;
}
