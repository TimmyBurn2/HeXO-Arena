import { gameTurnCap, internalToWire, wireToInternal } from '@hexo-arena/contract';
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

/** What a syntax error expected where it stopped. */
export type ExpectedToken = `metadata` | `turn-number` | `dot` | `coordinate` | `integer` | `comma` | `bracket` | `turn-end`;

/**
 * Why a text or link was refused.
 * Turns count from 1 after the start position; cells are engine coordinates.
 */
export type NotationError =
    | { readonly kind: `empty` }
    | { readonly kind: `syntax`; readonly line: number; readonly column: number; readonly turn: number | null; readonly expected: ExpectedToken }
    | { readonly kind: `version`; readonly version: string }
    | { readonly kind: `turn-number`; readonly expected: number; readonly found: number }
    | { readonly kind: `coordinate-count`; readonly turn: number; readonly count: number }
    | { readonly kind: `illegal`; readonly turn: number; readonly cell: Coord; readonly rejection: TurnRejection }
    | { readonly kind: `too-many-turns`; readonly limit: number }
    | { readonly kind: `boat-character`; readonly index: number; readonly character: string }
    | { readonly kind: `setup`; readonly problem: SetupProblem }
    | { readonly kind: `link-field`; readonly field: string }
    | { readonly kind: `link-data` }
    | { readonly kind: `unknown-link` }
    | { readonly kind: `unknown-text` };

/** A read that either holds its value or says why nothing loads. */
export type NotationRead<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: NotationError };

/** A cell as HTTTX writes it: `[q,r]`. */
export function cellText(cell: Coord): string {
    const { q, r } = internalToWire(cell);
    return `[${String(q)},${String(r)}]`;
}

/**
 * The strict HTTTX text of a line from the origin, which every known reader accepts:
 * `version[1];`, then one numbered turn a line, a one-stone turn only where it completes six.
 */
export function writeGame(turns: readonly TurnCells[]): string {
    return `version[1];\n${turns.map((cells, index) => `${String(index + 1)}. ${cells.map(cellText).join(``)};\n`).join(``)}`;
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
 * Read HTTTX game text, forgiving in form and strict in content.
 * Accepted beyond the strict form: one metadata segment of letter keys, where `version`, if present, must be 1
 * and the rest are ignored; `!` threat marks; whitespace and line breaks between tokens; no `;` after the last turn;
 * leading zeros and -0 in a coordinate.
 * Refused, naming where: turn numbers out of sequence, a turn of no or three or more cells,
 * any turn the rules refuse, text after a six, more turns than a game may have.
 * Turns are played from `start`, the origin unless a set-up board is given.
 */
export function readGame(text: string, start: Setup = originSetup): NotationRead<PlayedLine> {
    const reader = new TextReader(text);
    reader.skipSpace();
    if (reader.atEnd()) return { ok: false, error: { kind: `empty` } };
    if (isLetter(reader.peek())) {
        const header = reader.readMetadata();
        if (header !== null) return { ok: false, error: header };
    }
    const turns: TurnCells[] = [];
    let end = start;
    let win: Win | null = null;
    for (;;) {
        reader.skipSpace();
        if (reader.atEnd()) break;
        const expected = turns.length + 1;
        if (expected > gameTurnCap) return { ok: false, error: { kind: `too-many-turns`, limit: gameTurnCap } };
        const turn = reader.readTurn(expected);
        if (!turn.ok) return turn;
        const played = playNumbered(end, turn.value, expected);
        if (!played.ok) return played;
        turns.push(turn.value);
        end = played.value.end;
        win = played.value.win;
    }
    return { ok: true, value: { turns, end, win } };
}

// No board reaches a coordinate of ten digits, so longer integers are
// refused as text before they could lose precision as numbers.
const maxDigits = 9;

class TextReader {
    private at = 0;

    constructor(private readonly text: string) {}

    atEnd(): boolean {
        return this.at >= this.text.length;
    }

    peek(): string {
        return this.text.charAt(this.at);
    }

    skipSpace(): void {
        while (!this.atEnd() && /\s/u.test(this.peek())) this.at += 1;
    }

    readMetadata(): NotationError | null {
        for (;;) {
            this.skipSpace();
            if (this.peek() === `;`) {
                this.at += 1;
                return null;
            }
            const keyStart = this.at;
            while (isLetter(this.peek())) this.at += 1;
            const key = this.text.slice(keyStart, this.at);
            this.skipSpace();
            if (key === `` || this.peek() !== `[`) return this.syntax(null, `metadata`);
            const close = this.text.indexOf(`]`, this.at);
            if (close === -1) return this.syntax(null, `metadata`);
            const value = this.text.slice(this.at + 1, close);
            this.at = close + 1;
            if (key === `version` && value.trim() !== `1`) return { kind: `version`, version: value };
        }
    }

    readTurn(expected: number): NotationRead<TurnCells> {
        const numberAt = this.at;
        const digits = this.readDigits();
        if (digits === null) return { ok: false, error: this.syntax(expected, `turn-number`, numberAt) };
        const found = Number(digits);
        if (found !== expected) return { ok: false, error: { kind: `turn-number`, expected, found } };
        this.skipSpace();
        if (this.peek() !== `.`) return { ok: false, error: this.syntax(expected, `dot`) };
        this.at += 1;
        const cells: Coord[] = [];
        for (;;) {
            this.skipSpace();
            if (this.peek() !== `[`) break;
            const cell = this.readCell(expected);
            if (!cell.ok) return cell;
            cells.push(cell.value);
        }
        while (this.peek() === `!`) {
            this.at += 1;
            this.skipSpace();
        }
        if (this.peek() === `;`) {
            this.at += 1;
        } else if (!this.atEnd()) {
            return { ok: false, error: this.syntax(expected, cells.length === 0 ? `coordinate` : `turn-end`) };
        }
        const [first, second, ...rest] = cells;
        if (first === undefined || rest.length > 0) {
            return { ok: false, error: { kind: `coordinate-count`, turn: expected, count: cells.length } };
        }
        return { ok: true, value: second === undefined ? [first] : [first, second] };
    }

    private readCell(turn: number): NotationRead<Coord> {
        this.at += 1;
        this.skipSpace();
        const q = this.readInteger();
        if (q === null) return { ok: false, error: this.syntax(turn, `integer`) };
        this.skipSpace();
        if (this.peek() !== `,`) return { ok: false, error: this.syntax(turn, `comma`) };
        this.at += 1;
        this.skipSpace();
        const r = this.readInteger();
        if (r === null) return { ok: false, error: this.syntax(turn, `integer`) };
        this.skipSpace();
        if (this.peek() !== `]`) return { ok: false, error: this.syntax(turn, `bracket`) };
        this.at += 1;
        return { ok: true, value: wireToInternal({ q, r }) };
    }

    // A coordinate takes no sign but a minus; explore.htttx.io reads
    // leading zeros and -0, so they read here as the plain number.
    private readInteger(): number | null {
        const start = this.at;
        const negative = this.peek() === `-`;
        if (negative) this.at += 1;
        const digits = this.readRun();
        const significant = digits.replace(/^0+/u, ``);
        if (digits === `` || significant.length > maxDigits) {
            this.at = start;
            return null;
        }
        const value = Number(significant === `` ? `0` : significant);
        // The trailing + 0 turns -0 into 0.
        return negative ? -value + 0 : value;
    }

    // A turn number has no leading zeros, since it is counted, never copied from a board.
    private readDigits(): string | null {
        const start = this.at;
        const digits = this.readRun();
        if (digits === `` || digits.length > maxDigits || (digits.length > 1 && digits.startsWith(`0`))) {
            this.at = start;
            return null;
        }
        return digits;
    }

    private readRun(): string {
        const start = this.at;
        while (/[0-9]/u.test(this.peek())) this.at += 1;
        return this.text.slice(start, this.at);
    }

    private syntax(turn: number | null, expected: ExpectedToken, offset = this.at): NotationError {
        const before = this.text.slice(0, offset).split(/\r\n|\r|\n/u);
        const line = before.length;
        const column = (before[before.length - 1]?.length ?? 0) + 1;
        return { kind: `syntax`, line, column, turn, expected };
    }
}

function isLetter(character: string): boolean {
    return /^[A-Za-z]$/u.test(character);
}
