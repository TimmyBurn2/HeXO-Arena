import { analysisStoneCap } from '@hexo-arena/contract';
import { originSetup, setupProblem, type Coord, type Player, type Setup, type SetupProblem, type Stone } from '@hexo-arena/rules';

/** What a click on the set-up board does: place an x or an o stone, or take a stone off. */
export type SetupTool = `x` | `o` | `off`;

/**
 * A position being set up by hand: its stones, the player to move after it,
 * the tool in hand, and the boards before each change, newest last, for Undo.
 */
export interface SetupDraft {
    readonly stones: readonly Stone[];
    readonly toMove: Player;
    readonly tool: SetupTool;
    readonly history: readonly Setup[];
}

// Undo reaches this far back; older boards are dropped.
const historyCap = 200;

/** A draft starting from a position, x stones in hand. */
export function draftOf(setup: Setup): SetupDraft {
    return { stones: setup.stones, toMove: setup.toMove, tool: `x`, history: [] };
}

/**
 * A click on a cell: a stone there comes off, whatever the tool;
 * an empty cell takes a stone of the tool's side, and nothing under Take off.
 */
export function clickCell(draft: SetupDraft, cell: Coord): SetupDraft {
    const taken = draft.stones.some((stone) => stone.x === cell.x && stone.y === cell.y);
    if (taken) return change(draft, { stones: draft.stones.filter((stone) => stone.x !== cell.x || stone.y !== cell.y), toMove: draft.toMove });
    if (draft.tool === `off`) return draft;
    return change(draft, { stones: [...draft.stones, { x: cell.x, y: cell.y, player: draft.tool === `x` ? 0 : 1 }], toMove: draft.toMove });
}

/** Take every stone off. */
export function clearBoard(draft: SetupDraft): SetupDraft {
    return draft.stones.length === 0 ? draft : change(draft, { stones: [], toMove: draft.toMove });
}

/** Leave the origin stone alone on the board, o to move, as every game starts. */
export function originOnly(draft: SetupDraft): SetupDraft {
    return change(draft, originSetup);
}

/** Name the player to move after the position. */
export function setToMove(draft: SetupDraft, toMove: Player): SetupDraft {
    return draft.toMove === toMove ? draft : change(draft, { stones: draft.stones, toMove });
}

/** Pick what a click does. */
export function setTool(draft: SetupDraft, tool: SetupTool): SetupDraft {
    return { ...draft, tool };
}

/** The board before the last change, if any. */
export function undo(draft: SetupDraft): SetupDraft {
    const before = draft.history.at(-1);
    if (before === undefined) return draft;
    return { ...draft, stones: before.stones, toMove: before.toMove, history: draft.history.slice(0, -1) };
}

/** The set-up position the draft holds. */
export function draftSetup(draft: SetupDraft): Setup {
    return { stones: draft.stones, toMove: draft.toMove };
}

/** What the check line says of a draft: its stones by side, and why it cannot be played from, if it cannot. */
export interface DraftCheck {
    readonly x: number;
    readonly o: number;
    readonly problem: SetupProblem | null;
}

/** The draft as the check line reads it. */
export function checkDraft(draft: SetupDraft): DraftCheck {
    const x = draft.stones.filter((stone) => stone.player === 0).length;
    return { x, o: draft.stones.length - x, problem: setupProblem(draftSetup(draft), analysisStoneCap) };
}

function change(draft: SetupDraft, next: Setup): SetupDraft {
    const history = [...draft.history, { stones: draft.stones, toMove: draft.toMove }].slice(-historyCap);
    return { ...draft, stones: next.stones, toMove: next.toMove, history };
}
