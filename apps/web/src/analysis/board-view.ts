import { sideOf, type AxialCoord, type JudgmentSeverity, type Side } from '@hexo-arena/contract';
import type { BoardLines, BoardStone } from '../board/Board';
import type { SetupDraft } from './draft';
import type { PreferredLine } from './explain';
import type { ShownLine } from './reading-view';
import { positionAt, type MoveTree, type NodeId, type TreeNode } from './tree';

/** What the analysis board draws, as its props name it. */
export interface BoardView {
    readonly stones: readonly BoardStone[];
    readonly frame: readonly AxialCoord[];
    readonly field: readonly AxialCoord[] | undefined;
    readonly mark: AxialCoord | null;
    readonly lastMove: readonly AxialCoord[];
    readonly winLine: readonly AxialCoord[];
    readonly lines: BoardLines | undefined;
    readonly preview: { readonly side: Side; readonly cells: readonly AxialCoord[] } | undefined;
    readonly judgment: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | undefined;
}

/** Each stone numbered in the order it was played; a set-up board's own stones were placed, not played, so carry none. */
export function numberedStones(tree: MoveTree, at: NodeId): BoardStone[] {
    const setupStones = tree.root.kind === `setup` ? tree.root.start.stones.length : 0;
    return positionAt(tree, at).stones.map((stone, index) => ({
        x: stone.x,
        y: stone.y,
        side: sideOf(stone.player),
        number: index < setupStones ? null : index - setupStones + 1,
    }));
}

/**
 * What the board draws, one of three ways: a draft's stones, on the field they grow round, while setting up;
 * a preferred line on the board its turn was played from, in that turn's place;
 * else the position shown, with its mark, its last turn or six, the analyzer's lines and the one pointed at, and a judged turn's mark.
 */
export function boardView({ draft, preferred, stones, frame, mark, node, toMove, lines, boardLines, preview, judgment }: {
    draft: SetupDraft | null;
    // A preferred line shown, with the stones of the board its turn was played from.
    preferred: { readonly line: PreferredLine; readonly stones: readonly BoardStone[] } | null;
    stones: readonly BoardStone[];
    frame: readonly AxialCoord[];
    mark: AxialCoord | null;
    node: TreeNode | undefined;
    toMove: Side;
    lines: readonly ShownLine[];
    // Whether the settings draw the lines on the board.
    boardLines: boolean;
    // The line pointed at, shown while it is still one of the lines.
    preview: ShownLine | null;
    judgment: { readonly cell: AxialCoord; readonly severity: JudgmentSeverity } | null;
}): BoardView {
    if (draft !== null) {
        const field = [{ x: 0, y: 0 }, ...draft.stones];
        const placed = draft.stones.map((stone) => ({ x: stone.x, y: stone.y, side: sideOf(stone.player), number: null }));
        return { stones: placed, frame: field, field, mark: null, lastMove: [], winLine: [], lines: undefined, preview: undefined, judgment: undefined };
    }
    if (preferred !== null) {
        const { line } = preferred;
        return { stones: preferred.stones, frame, field: undefined, mark: null, lastMove: [], winLine: [], lines: undefined, preview: { side: line.side, cells: line.cells }, judgment: undefined };
    }
    const turn = node?.kind === `turn` ? node : null;
    const pointed = preview !== null && lines.includes(preview) ? preview : null;
    return {
        stones,
        frame,
        field: undefined,
        mark,
        lastMove: turn !== null && turn.win === null ? turn.cells : [],
        winLine: turn !== null && turn.win !== null ? turn.win.cells : [],
        lines: boardLines && lines.length > 0 ? { side: toMove, lines } : undefined,
        preview: pointed === null ? undefined : { side: toMove, cells: pointed.cells },
        judgment: judgment ?? undefined,
    };
}
