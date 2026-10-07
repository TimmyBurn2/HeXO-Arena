import { valueWords, type AnalyzerValues, type HtttxEvaluation, type Side, type ValueText } from '@hexo-arena/contract';
import type { TurnRejection } from '@hexo-arena/rules';
import { text } from '../text';
import { cellText, type NotationError } from './notation';
import { floorOf } from './state';
import { isMainLine, mainLine, nodeAt, openingTurns, rootId, type MoveTree, type NodeId, type TreeRefusal } from './tree';

/** Why pasted text or a link loaded nothing, naming the turn and the cell where it can. */
export function notationErrorText(error: NotationError): string {
    const words = text.analysis.import;
    switch (error.kind) {
        case `empty`:
            return words.unknownText;
        case `syntax`:
            return words.syntax(error.line, error.column, error.turn, words.expected[error.expected]);
        case `version`:
            return words.version(error.version);
        case `turn-number`:
            return words.turnNumber(error.line, error.column, error.expected, error.found);
        case `coordinate-count`:
            return words.cellCount(error.line, error.column, error.turn, error.count);
        case `threat-mark`:
            return words.threatMark(error.line, error.column, error.turn);
        case `after-final`:
            return words.afterFinal(error.line, error.column, error.turn);
        case `tree-cap`:
            return words.treeCap(error.limit);
        case `illegal`:
            return words.illegal(error.turn, cellText(error.cell), words.why[error.rejection.kind]);
        case `too-many-turns`:
            return words.tooManyTurns(error.limit);
        case `boat-character`:
            return words.character(error.index, error.character);
        case `setup`:
            switch (error.problem.kind) {
                case `no-stones`:
                    return words.noStones;
                case `too-many-stones`:
                    return words.tooManyStones(error.problem.count);
                case `cell-taken`:
                    return words.sharedCell(cellText(error.problem.cell));
                case `six-on-board`:
                    return words.six;
                default:
                    return assertNever(error.problem);
            }
        case `link-field`:
            return words.linkField(error.field);
        case `link-data`:
            return words.linkData;
        case `unknown-link`:
            return words.unknownLink;
        case `unknown-text`:
            return words.unknownText;
        default:
            return assertNever(error);
    }
}

/** Why a cell on the board took no stone. */
export function refusalText(refusal: TreeRefusal): string {
    const words = text.analysis.refusals;
    switch (refusal.kind) {
        case `rules`:
            return rejectionText(refusal.rejection);
        case `node-cap`:
            return words.nodeCap;
        case `turn-cap`:
            return words.turnCap(refusal.limit);
        case `unknown-node`:
            return words.gone;
        default:
            return assertNever(refusal);
    }
}

function rejectionText(rejection: TurnRejection): string {
    const words = text.analysis.refusals;
    switch (rejection.kind) {
        case `cell-occupied`:
            return words.cellTaken;
        case `outside-placement-radius`:
            return words.tooFar;
        case `game-finished`:
            return words.won;
        case `first-stone-off-origin`:
            return words.firstAtOrigin;
        case `turn-unfinished`:
            return words.secondStone;
        default:
            return assertNever(rejection);
    }
}

// An open evaluation reads as an analyzer's expected value would at a scale of 100: (100 + e) / 200 is x's win chance.
const openValues: AnalyzerValues = { scale: 100, cuts: null, meaning: `expected` };

/**
 * An imported open or closed evaluation in words, never judged:
 * an open one held to -100 to 100 as the leading side's win chance, (100 + e) / 200 for x, in whole percents as an analyzer's shows;
 * a closed one as its winner's win in its count of turns, or a decided position where `#0` names no side.
 */
export function importedWords(evaluation: HtttxEvaluation): ValueText {
    const words = text.analysis.notes;
    if (evaluation.kind === `closed`) {
        const said = evaluation.turns === 0 ? words.decided : words.wins(evaluation.turns > 0 ? `x` : `o`, Math.abs(evaluation.turns));
        return { shown: said, spoken: said };
    }
    return valueWords({ heuristic: evaluation.value }, { kind: `board` }, openValues) ?? { shown: words.even, spoken: words.even };
}

/** A clock in ms as the notes show it: tenths of a second under a minute, then minutes and seconds, then hours. */
export function clockText(ms: number): string {
    if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)} s`;
    const seconds = Math.floor(ms / 1_000);
    const hours = Math.floor(seconds / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const rest = String(seconds % 60).padStart(2, `0`);
    return hours === 0 ? `${String(minutes)}:${rest}` : `${String(hours)}:${String(minutes).padStart(2, `0`)}:${rest}`;
}

/** The state of a position in words: whose turn, with one stone marked, or who won. */
export function positionWords(toMove: Side, marked: boolean, won: Side | null): string {
    if (won !== null) return text.analysis.nav.won(won);
    return marked ? text.analysis.nav.oneLeft(toMove) : text.analysis.nav.toMove(toMove);
}

/**
 * Where the board stands, as its steps say it: setting up; a stored game's drawn opening;
 * a variation's turn; a turn of the game, out of its last; or a turn of the line.
 * `openingPlies` is a stored game's, null on any other board.
 */
export function turnWords(tree: MoveTree, at: NodeId, editing: boolean, openingPlies: number | null): string {
    if (editing) return text.analysis.nav.setup;
    if (openingPlies !== null && at === floorOf(tree) && openingTurns(tree.root) > 0) return openingPlies === 1 ? text.replay.origin : text.replay.opening(openingPlies);
    const turn = nodeAt(tree, at)?.turn ?? 0;
    if (!isMainLine(tree, at)) return text.analysis.nav.variation(turn);
    if (openingPlies === null) return text.analysis.nav.turn(turn);
    return text.analysis.nav.turnOf(turn, nodeAt(tree, mainLine(tree).at(-1) ?? rootId)?.turn ?? 0);
}

function assertNever(value: never): never {
    throw new Error(`unexpected value ${JSON.stringify(value)}`);
}
