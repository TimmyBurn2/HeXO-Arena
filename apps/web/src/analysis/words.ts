import type { Side } from '@hexo-arena/contract';
import type { TurnRejection } from '@hexo-arena/rules';
import { text } from '../text';
import { cellText, type NotationError } from './notation';
import type { TreeRefusal } from './tree';

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
            return words.turnNumber(error.expected, error.found);
        case `coordinate-count`:
            return words.cellCount(error.turn, error.count);
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

/** The state of a position in words: whose turn, with one stone marked, or who won. */
export function positionWords(toMove: Side, marked: boolean, won: Side | null): string {
    if (won !== null) return text.analysis.nav.won(won);
    return marked ? text.analysis.nav.oneLeft(toMove) : text.analysis.nav.toMove(toMove);
}

function assertNever(value: never): never {
    throw new Error(`unexpected value ${JSON.stringify(value)}`);
}
