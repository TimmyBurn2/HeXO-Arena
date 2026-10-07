import { gameTurnCap, htttxCell, readHtttx, writeHtttx, type HtttxDocument, type HtttxError } from '@hexo-arena/contract';
import {
    originSetup,
    playTurn,
    type Coord,
    type Setup,
    type SetupProblem,
    type TurnCells,
    type TurnRejection,
    type Win,
} from '@hexo-arena/rules';

/** Turns played from a start position, the position they reach, and the six that ended them, if any. */
export interface PlayedLine {
    readonly turns: readonly TurnCells[];
    readonly end: Setup;
    readonly win: Win | null;
}

/**
 * Why a text or link was refused: the notation's own reasons, or the rules', a cap's, a boat position's, or a link's.
 * Turns count from 1 after the start position; cells are engine coordinates.
 */
export type NotationError =
    | HtttxError
    | { readonly kind: `illegal`; readonly turn: number; readonly cell: Coord; readonly rejection: TurnRejection }
    | { readonly kind: `too-many-turns`; readonly limit: number }
    | { readonly kind: `tree-cap`; readonly limit: number }
    | { readonly kind: `boat-character`; readonly index: number; readonly character: string }
    | { readonly kind: `setup`; readonly problem: SetupProblem }
    | { readonly kind: `link-field`; readonly field: string }
    | { readonly kind: `link-data` }
    | { readonly kind: `unknown-link` }
    | { readonly kind: `unknown-text` };

/** A read that either holds its value or says why nothing loads. */
export type NotationRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NotationError };

/** A cell as HTTTX writes it: `[q,r]`. */
export const cellText: (cell: Coord) => string = htttxCell;

/**
 * The strict HTTTX v1 text of a line from the origin, which every known reader accepts:
 * `version[1];`, then one numbered turn a line, a one-stone turn only where it completes six.
 */
export function writeGame(turns: readonly TurnCells[]): string {
    return writeHtttx({ version: 1, tags: [], turns });
}

/** The same turns with no header and no spaces, for a link. */
export function writeTurns(turns: readonly TurnCells[]): string {
    return turns.map((cells, index) => `${String(index + 1)}.${cells.map(cellText).join(``)};`).join(``);
}

/**
 * Play turns from a start position by the rules, stopping at the first one refused,
 * which is named by its number and cell.
 */
export function playLine(start: Setup, turns: readonly TurnCells[]): NotationRead<PlayedLine> {
    let end = start;
    let win: Win | null = null;
    for (const [index, cells] of turns.entries()) {
        const played = playNumbered(end, cells, index + 1);
        if (!played.ok) return played;
        end = played.value.end;
        win = played.value.win;
    }
    return { ok: true, value: { turns, end, win } };
}

function playNumbered(end: Setup, cells: TurnCells, turn: number): NotationRead<{ readonly end: Setup; readonly win: Win | null }> {
    const played = playTurn(end, cells);
    if (played.ok) return { ok: true, value: { end: played.setup, win: played.win } };
    // A missing second stone is reported on the lone first one.
    const [first, second] = cells;
    const cell = played.index === 1 && second !== undefined ? second : first;
    return { ok: false, error: { kind: `illegal`, turn, cell, rejection: played.rejection } };
}

/**
 * Read HTTTX text as a line of whole turns, as a link and v1 text hold one: the notation reads it (see `readHtttx`),
 * then its main line is played by the rules from `start`, the origin unless a set-up board is given;
 * v2's variations and notes are read past, as a line holds neither, and a turn ending on the final move is its one stone.
 * Refused, naming where: any turn the rules refuse, text after a six, more turns than a game may have.
 */
export function readGame(text: string, start: Setup = originSetup): NotationRead<PlayedLine> {
    const read = readHtttx(text);
    return read.ok ? playMain(read.document, start) : read;
}

/** A document's main line played by the rules from `start`, refused past the turn cap or at the first turn the rules refuse. */
export function playMain(document: HtttxDocument, start: Setup = originSetup): NotationRead<PlayedLine> {
    const turns = mainTurns(document);
    if (turns.length > gameTurnCap) return { ok: false, error: { kind: `too-many-turns`, limit: gameTurnCap } };
    return playLine(start, turns);
}

/** A document's main line as whole turns; v2's final move leaves its turn one stone. */
export function mainTurns(document: HtttxDocument): TurnCells[] {
    if (document.version === 1) return [...document.turns];
    return document.line.map((turn) => (turn.second.kind === `stone` ? [turn.first.cell, turn.second.cell] : [turn.first.cell]));
}
