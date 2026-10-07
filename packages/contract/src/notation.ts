import { internalToWire, wireToInternal } from './axial';
import type { FinishReason, Side, TimeControl } from './stream';

/** A placed stone's cell in the engine's coordinates. */
export interface NotationCell {
    readonly x: number;
    readonly y: number;
}

/** A v1 turn's cells: two, or one where it completes six. */
export type HtttxCells = readonly [NotationCell] | readonly [NotationCell, NotationCell];

/** A metadata tag as written, `key[value]`; the `version` tag is held apart, as the document's version. */
export interface HtttxTag {
    readonly key: string;
    readonly value: string;
}

/**
 * An evaluation of the position after a stone:
 * `open`, an integer advantage, positive for x, -100 to 100 recommended as 100 (2 P(x wins) - 1);
 * `closed`, a forced win, its count as {@link writeHtttx} maps it, 0 naming no side.
 */
export type HtttxEvaluation = { readonly kind: `open`; readonly value: number } | { readonly kind: `closed`; readonly turns: number };

/** What a text says of the position after a stone: the placer's clock in ms, its evaluation, or both. */
export interface HtttxInfo {
    readonly clockMs: number | null;
    readonly evaluation: HtttxEvaluation | null;
}

/** A highlight's letter as written, any capital, or null for a bare `#`; N, a bare `#`, and every letter but X and O are neutral. */
export interface HtttxHighlight {
    readonly letter: string | null;
}

/** One cell's look in the position after a stone: a highlight, a label, both, or neither, which is a neutral highlight. */
export interface HtttxVisual {
    readonly cell: NotationCell;
    readonly highlight: HtttxHighlight | null;
    readonly label: string | null;
}

/** What a move carries beside its stone: the info and the visuals of the position after it. */
export interface HtttxNotes {
    readonly info: HtttxInfo | null;
    readonly visuals: readonly HtttxVisual[];
}

/** A placed stone and its notes. */
export interface HtttxStone extends HtttxNotes {
    readonly kind: `stone`;
    readonly cell: NotationCell;
}

/** The final move, `[/]`, ending a line on its turn's first stone; its notes belong to the position after that stone. */
export interface HtttxFinal extends HtttxNotes {
    readonly kind: `final`;
}

/** A v2 turn: its number, its two moves, and the variations that replace it, each a line from the same number. */
export interface HtttxTurn {
    readonly number: number;
    readonly first: HtttxStone;
    readonly second: HtttxStone | HtttxFinal;
    readonly variations: readonly HtttxLine[];
}

/** A line: one turn or more, numbered on from its first. */
export type HtttxLine = readonly [HtttxTurn, ...HtttxTurn[]];

/** A v1 game text: whole turns from the origin, each two cells or one where it completes six. */
export interface HtttxV1Document {
    readonly version: 1;
    readonly tags: readonly HtttxTag[];
    readonly turns: readonly HtttxCells[];
}

/** A v2 game text: a main line with nested variations, info, visuals, and the final move. */
export interface HtttxV2Document {
    readonly version: 2;
    readonly tags: readonly HtttxTag[];
    readonly line: HtttxLine;
}

/** A game text as read or to be written. */
export type HtttxDocument = HtttxV1Document | HtttxV2Document;

/** What a syntax error expected where it stopped. */
export type HtttxExpected =
    | `metadata`
    | `version-first`
    | `turn-number`
    | `dot`
    | `coordinate`
    | `integer`
    | `integer-form`
    | `cell-number`
    | `comma`
    | `bracket`
    | `turn-end`
    | `info`
    | `info-end`
    | `visual-end`
    | `variation-end`;

/**
 * Why a text did not read as HTTTX.
 * Lines and columns count from 1; a turn is named by the number it carries or should carry.
 */
export type HtttxError =
    | { readonly kind: `empty` }
    | { readonly kind: `syntax`; readonly line: number; readonly column: number; readonly turn: number | null; readonly expected: HtttxExpected }
    | { readonly kind: `version`; readonly version: string }
    | { readonly kind: `turn-number`; readonly line: number; readonly column: number; readonly expected: number; readonly found: number }
    | { readonly kind: `coordinate-count`; readonly line: number; readonly column: number; readonly turn: number; readonly count: number }
    | { readonly kind: `threat-mark`; readonly line: number; readonly column: number; readonly turn: number }
    | { readonly kind: `after-final`; readonly line: number; readonly column: number; readonly turn: number };

/** A read that holds the document or says why the text did not read. */
export type HtttxRead = { readonly ok: true; readonly document: HtttxDocument } | { readonly ok: false; readonly error: HtttxError };

/** What an HTTTX file may say of its game beside the turns; every key is optional. */
export interface HtttxHeader {
    readonly name?: string;
    readonly platform?: string;
    /** When the game started; written in UTC to the second. */
    readonly startedAt?: Date;
    readonly cross?: string;
    readonly circle?: string;
    readonly timeControl?: TimeControl;
    readonly result?: { readonly winner: Side | null; readonly reason: FinishReason };
}

/** A cell as HTTTX writes it: `[q,r]` in the wire's axial coordinates. */
export function htttxCell(cell: NotationCell): string {
    return `[${coordinateText(cell)}]`;
}

function coordinateText(cell: NotationCell): string {
    const { q, r } = internalToWire(cell);
    return `${String(q)},${String(r)}`;
}

// A value ends at its `]` and the header at its `;`, and readers take a
// line break for the end of a token, so none of them may stand in a value.
function cleanValue(text: string): string {
    const swapped = text.replace(/[\s\S]/gu, (character) => {
        const code = character.charCodeAt(0);
        if (code < 0x20 || code === 0x7f) return ` `;
        return character === `[` ? `(` : character === `]` ? `)` : character === `;` ? `,` : character;
    });
    return swapped.replace(/ {2,}/gu, ` `).trim();
}

// Integer seconds, as both versions write a clock; one off whole seconds is left out rather than rounded.
function timeControlValue(clock: TimeControl): string | null {
    if (clock.mode !== `match` || clock.mainTimeMs % 1_000 !== 0 || clock.incrementMs % 1_000 !== 0) return null;
    return `${String(clock.mainTimeMs / 1_000)}+${String(clock.incrementMs / 1_000)}`;
}

// The notation names four endings; a disconnect, an illegal move, and an
// abort fit none of them, so those games say only who won, if anyone did.
function endReasonValue(result: NonNullable<HtttxHeader[`result`]>): string | null {
    if (result.winner === null) return result.reason === `terminated` ? `draw` : null;
    switch (result.reason) {
        case `six-in-a-row`:
            return `win`;
        case `timeout`:
            return `time`;
        case `surrender`:
            return `resign`;
        case `disconnect`:
        case `terminated`:
        case `aborted`:
            return null;
    }
}

function utcText(at: Date): string {
    return at.toISOString().slice(0, 19).replace(`T`, ` `);
}

/** A header's tags in the order the notation lists its keys, each value kept clear of the characters that end a token, an empty one left out. */
export function htttxTags(header: HtttxHeader): HtttxTag[] {
    const result = header.result;
    const fields: [string, string | null | undefined][] = [
        [`name`, header.name],
        [`platform`, header.platform],
        [`utcdatetime`, header.startedAt === undefined ? null : utcText(header.startedAt)],
        [`playercross`, header.cross],
        [`playercircle`, header.circle],
        [`timecontrol`, header.timeControl === undefined ? null : timeControlValue(header.timeControl)],
        [`endreason`, result === undefined ? null : endReasonValue(result)],
        [`winner`, result?.winner === undefined || result.winner === null ? null : result.winner === `x` ? `cross` : `circle`],
    ];
    return fields
        .map(([key, value]) => ({ key, value: value === undefined || value === null ? `` : cleanValue(value) }))
        .filter((tag) => tag.value !== ``);
}

/**
 * A main line of whole turns as v2 writes it, each turn's info on its last stone:
 * a turn of one stone ends the line on `[/]`, its info on the stone before it.
 * Null for no turns, which v2 cannot write.
 */
export function htttxLineOf(turns: readonly { readonly cells: HtttxCells; readonly info: HtttxInfo | null }[]): HtttxLine | null {
    const line = turns.map(({ cells, info }, index): HtttxTurn => {
        const [first, second] = cells;
        const stone = (cell: NotationCell, notes: HtttxInfo | null): HtttxStone => ({ kind: `stone`, cell, info: notes, visuals: [] });
        return {
            number: index + 1,
            first: stone(first, second === undefined ? info : null),
            second: second === undefined ? { kind: `final`, info: null, visuals: [] } : stone(second, info),
            variations: [],
        };
    });
    const [head, ...rest] = line;
    return head === undefined ? null : [head, ...rest];
}

/**
 * The document as text.
 * v1 is the strict form every known reader accepts: `version[1]` and the tags in one metadata segment,
 * then one numbered turn a line from the origin, which the notation never writes.
 * v2 writes the main line a turn a line, each variation on a line of its own under the turn it replaces,
 * its turns and any variations nested in it written compactly; info and visuals follow their stone.
 * A closed evaluation `#n` is htttx's `win_in` one to one: turns from the position after the stone,
 * the side to move there first, both sides' turns counted, positive when x wins and negative when o does.
 * A tag's value is written as it stands, a `]` turned to `)` since it would end the value.
 */
export function writeHtttx(document: HtttxDocument): string {
    const tags = document.tags.map((tag) => `${tag.key}[${tag.value.replaceAll(`]`, `)`)}]`).join(``);
    if (document.version === 1) {
        const lines = document.turns.map((cells, index) => `${String(index + 1)}. ${cells.map(htttxCell).join(``)};\n`);
        return `version[1]${tags};\n${lines.join(``)}`;
    }
    return `version[2]${tags};\n${document.line.map((turn) => `${turnText(turn, false)}\n`).join(``)}`;
}

function turnText(turn: HtttxTurn, nested: boolean): string {
    const head = `${String(turn.number)}. ${moveText(turn.first)}${moveText(turn.second)}`;
    const variations = turn.variations.map((line) => `${nested ? ` ` : `\n  `}(${line.map((each) => turnText(each, true)).join(` `)})`);
    return `${head}${variations.join(``)};`;
}

function moveText(move: HtttxStone | HtttxFinal): string {
    const stone = move.kind === `stone` ? htttxCell(move.cell) : `[/]`;
    return `${stone}${move.info === null ? `` : infoText(move.info)}${move.visuals.map(visualText).join(``)}`;
}

function infoText(info: HtttxInfo): string {
    const evaluation = info.evaluation === null ? null : info.evaluation.kind === `open` ? `%${String(info.evaluation.value)}` : `#${String(info.evaluation.turns)}`;
    const clock = info.clockMs === null ? null : `@${String(info.clockMs)}`;
    return `{${[clock, evaluation].filter((part) => part !== null).join(`:`)}}`;
}

function visualText(visual: HtttxVisual): string {
    const highlight = visual.highlight === null ? [] : [`#${visual.highlight.letter ?? ``}`];
    const label = visual.label === null ? [] : [`$${visual.label}`];
    return `<${[coordinateText(visual.cell), ...highlight, ...label].join(`:`)}>`;
}

/**
 * A game's turns from its stones in placement order: the origin is left
 * out, and each turn after it holds two stones, the last one alone where
 * the game ended on its first stone.
 */
export function turnsOfStones<T extends NotationCell>(stones: readonly T[]): T[][] {
    const turns: T[][] = [];
    for (let at = 1; at < stones.length; at += 2) turns.push(stones.slice(at, at + 2));
    return turns;
}

/**
 * Read HTTTX text of version 1 or 2, in form only; whether its turns are legal is the rules' to say.
 * The first `version` tag names the version, 1 when there is none, and every other must agree.
 * Metadata tags are `key[value]`, the key a letter then letters, digits, `_` or `-`, the value anything up to `]`, kept as written.
 * v1, forgiving as known writers are: whitespace between tokens, a last turn without its `;`,
 * leading zeros and -0 in a coordinate, a turn of one cell; `!` threat marks are refused by name.
 * v2, exactly its grammar: whitespace anywhere outside a tag value, even inside a number;
 * integers without leading zeros or -0; `version[2]` the first tag; at least one turn;
 * a variation inside turn n from turn n on; `[/]` on a line's last turn only;
 * a visual with a section it does not know is passed over.
 * Integers longer than a number holds exactly are refused, coordinates past nine digits, which no board reaches.
 */
export function readHtttx(text: string): HtttxRead {
    const reader = new Reader(text);
    reader.skipSpace();
    if (reader.atEnd()) return refused({ kind: `empty` });
    const tags: (HtttxTag & { readonly at: number })[] = [];
    if (/^[A-Za-z]$/u.test(reader.peek())) {
        const read = reader.readMetadata(tags);
        if (read !== null) return refused(read);
    }
    const versions = tags.filter((tag) => tag.key === `version`);
    const named = versions[0]?.value.trim() ?? `1`;
    if (named !== `1` && named !== `2`) return refused({ kind: `version`, version: versions[0]?.value ?? named });
    const disagreeing = versions.find((tag) => tag.value.trim() !== named);
    if (disagreeing !== undefined) return refused({ kind: `version`, version: disagreeing.value });
    const kept = tags.filter((tag) => tag.key !== `version`).map(({ key, value }) => ({ key, value }));
    if (named === `1`) {
        const turns = reader.readV1Turns();
        return turns.ok ? { ok: true, document: { version: 1, tags: kept, turns: turns.value } } : refused(turns.error);
    }
    const first = tags[0];
    if (first !== undefined && first.key !== `version`) return refused(reader.syntaxAt(first.at, null, `version-first`));
    reader.spaced = true;
    const line = reader.readV2Line();
    return line.ok ? { ok: true, document: { version: 2, tags: kept, line: line.value } } : refused(line.error);
}

function refused(error: HtttxError): HtttxRead {
    return { ok: false, error };
}

type Read<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HtttxError };

// A turn read up to its `;`, gathering the variations that replace it.
interface OpenTurn {
    readonly number: number;
    readonly first: HtttxStone;
    readonly second: HtttxStone | HtttxFinal;
    readonly variations: HtttxLine[];
}

// A line being read: its turns, the number its next turn carries, and the turn whose `[/]` ended it.
interface OpenLine {
    readonly turns: HtttxTurn[];
    next: number;
    ended: number | null;
}

// A variation being read inside the turn it replaces.
interface OpenVariation extends OpenLine {
    readonly replaces: OpenTurn;
}

// Coordinates past this many digits lie beyond any board; other integers
// past this many would lose digits as numbers.
const coordinateDigits = 9;
const integerDigits = 15;

class Reader {
    private at = 0;
    // Whether whitespace is passed over everywhere, as v2 reads it, rather than only between v1's tokens.
    spaced = false;

    constructor(private readonly text: string) {}

    atEnd(): boolean {
        return this.peek() === ``;
    }

    peek(): string {
        if (this.spaced) this.skipSpace();
        return this.text.charAt(this.at);
    }

    skipSpace(): void {
        while (this.at < this.text.length && /\s/u.test(this.text.charAt(this.at))) this.at += 1;
    }

    readMetadata(tags: (HtttxTag & { readonly at: number })[]): HtttxError | null {
        for (;;) {
            this.skipSpace();
            if (this.peek() === `;`) {
                this.at += 1;
                return null;
            }
            const keyStart = this.at;
            const key = /^[A-Za-z][A-Za-z0-9_-]*/u.exec(this.text.slice(this.at))?.[0] ?? ``;
            this.at += key.length;
            this.skipSpace();
            if (key === `` || this.peek() !== `[`) return this.syntax(null, `metadata`);
            const close = this.text.indexOf(`]`, this.at);
            if (close === -1) return this.syntax(null, `metadata`);
            tags.push({ key, value: this.text.slice(this.at + 1, close), at: keyStart });
            this.at = close + 1;
        }
    }

    readV1Turns(): Read<HtttxCells[]> {
        const turns: HtttxCells[] = [];
        for (;;) {
            this.skipSpace();
            if (this.atEnd()) return { ok: true, value: turns };
            const turn = this.readV1Turn(turns.length + 1);
            if (!turn.ok) return turn;
            turns.push(turn.value);
        }
    }

    private readV1Turn(expected: number): Read<HtttxCells> {
        const numberAt = this.at;
        const found = this.readUnsigned();
        if (found === null) return this.failed(this.syntax(expected, `turn-number`, numberAt));
        if (found !== expected) return this.failed({ kind: `turn-number`, ...this.place(numberAt), expected, found });
        this.skipSpace();
        if (this.peek() !== `.`) return this.failed(this.syntax(expected, `dot`));
        this.at += 1;
        const cells: NotationCell[] = [];
        for (;;) {
            this.skipSpace();
            if (this.peek() !== `[`) break;
            this.at += 1;
            const cell = this.readCell(expected, true);
            if (!cell.ok) return cell;
            cells.push(cell.value);
        }
        if (this.peek() === `!`) return this.failed({ kind: `threat-mark`, ...this.place(this.at), turn: expected });
        if (this.peek() === `;`) {
            this.at += 1;
        } else if (!this.atEnd()) {
            return this.failed(this.syntax(expected, cells.length === 0 ? `coordinate` : `turn-end`));
        }
        const [first, second, ...rest] = cells;
        if (first === undefined || rest.length > 0) return this.failed({ kind: `coordinate-count`, ...this.place(numberAt), turn: expected, count: cells.length });
        return { ok: true, value: second === undefined ? [first] : [first, second] };
    }

    // The main line and every variation, read with a stack rather than by
    // recursion, so no depth of nesting runs out of stack.
    readV2Line(): Read<HtttxLine> {
        const main: OpenLine = { turns: [], next: 1, ended: null };
        const open: OpenVariation[] = [];
        let turn: OpenTurn | null = null;
        for (;;) {
            const line = open.at(-1) ?? main;
            const next = this.peek();
            if (turn !== null) {
                if (next === `(`) {
                    this.at += 1;
                    open.push({ turns: [], next: turn.number, ended: null, replaces: turn });
                    turn = null;
                } else if (next === `;`) {
                    this.at += 1;
                    line.turns.push(turn);
                    line.next = turn.number + 1;
                    if (turn.second.kind === `final`) line.ended = turn.number;
                    turn = null;
                } else if (next === `!`) {
                    return this.failed({ kind: `threat-mark`, ...this.place(this.at), turn: turn.number });
                } else {
                    return this.failed(this.syntax(turn.number, `turn-end`));
                }
                continue;
            }
            const variation = open.at(-1);
            if (next === `` || next === `)`) {
                const [head, ...rest] = line.turns;
                if (head === undefined || (next === `)` && variation === undefined)) return this.failed(this.syntax(line.next, `turn-number`));
                if (next === `` && variation !== undefined) return this.failed(this.syntax(line.next, `variation-end`));
                if (variation === undefined) return { ok: true, value: [head, ...rest] };
                this.at += 1;
                open.pop();
                variation.replaces.variations.push([head, ...rest]);
                turn = variation.replaces;
                continue;
            }
            if (line.ended !== null) return this.failed({ kind: `after-final`, ...this.place(this.at), turn: line.ended });
            const read = this.readV2Turn(line.next);
            if (!read.ok) return read;
            turn = read.value;
        }
    }

    private readV2Turn(expected: number): Read<OpenTurn> {
        this.peek();
        const numberAt = this.at;
        const found = this.readUnsigned();
        if (found === null) return this.failed(this.syntax(expected, `turn-number`, numberAt));
        if (found !== expected) return this.failed({ kind: `turn-number`, ...this.place(numberAt), expected, found });
        if (this.peek() !== `.`) return this.failed(this.syntax(expected, `dot`));
        this.at += 1;
        const first = this.readMove(expected, false);
        if (!first.ok) return first;
        if (first.value.kind !== `stone`) return this.failed(this.syntax(expected, `coordinate`));
        const second = this.readMove(expected, true);
        if (!second.ok) return second;
        return { ok: true, value: { number: expected, first: first.value, second: second.value, variations: [] } };
    }

    private readMove(turn: number, final: boolean): Read<HtttxStone | HtttxFinal> {
        if (this.peek() !== `[`) return this.failed(this.syntax(turn, `coordinate`));
        this.at += 1;
        let cell: NotationCell | null = null;
        if (final && this.peek() === `/`) {
            this.at += 1;
            if (this.peek() !== `]`) return this.failed(this.syntax(turn, `bracket`));
            this.at += 1;
        } else {
            const read = this.readCell(turn, false);
            if (!read.ok) return read;
            cell = read.value;
        }
        let info: HtttxInfo | null = null;
        if (this.peek() === `{`) {
            const read = this.readInfo(turn);
            if (!read.ok) return read;
            info = read.value;
        }
        const visuals: HtttxVisual[] = [];
        while (this.peek() === `<`) {
            const read = this.readVisual(turn);
            if (!read.ok) return read;
            if (read.value !== null) visuals.push(read.value);
        }
        return { ok: true, value: cell === null ? { kind: `final`, info, visuals } : { kind: `stone`, cell, info, visuals } };
    }

    // After its `[`, up to and past its `]`; v1 takes leading zeros and -0, as explore.htttx.io does.
    private readCell(turn: number, lenient: boolean): Read<NotationCell> {
        if (lenient) this.skipSpace();
        const q = lenient ? this.readLenient() : this.readSigned(coordinateDigits);
        if (q === null) return this.failed(this.numberError(turn, `cell-number`));
        if (lenient) this.skipSpace();
        if (this.peek() !== `,`) return this.failed(this.syntax(turn, `comma`));
        this.at += 1;
        if (lenient) this.skipSpace();
        const r = lenient ? this.readLenient() : this.readSigned(coordinateDigits);
        if (r === null) return this.failed(this.numberError(turn, `cell-number`));
        if (lenient) this.skipSpace();
        if (this.peek() !== `]`) return this.failed(this.syntax(turn, `bracket`));
        this.at += 1;
        return { ok: true, value: wireToInternal({ q, r }) };
    }

    private readInfo(turn: number): Read<HtttxInfo> {
        this.at += 1;
        let clockMs: number | null = null;
        let evaluated = true;
        if (this.peek() === `@`) {
            this.at += 1;
            clockMs = this.readUnsigned(integerDigits);
            if (clockMs === null) return this.failed(this.numberError(turn, `integer`));
            evaluated = this.peek() === `:`;
            if (evaluated) this.at += 1;
        }
        let evaluation: HtttxEvaluation | null = null;
        if (evaluated) {
            const mark = this.peek();
            if (mark !== `%` && mark !== `#`) return this.failed(this.syntax(turn, `info`));
            this.at += 1;
            const value = this.readSigned(integerDigits);
            if (value === null) return this.failed(this.numberError(turn, `integer`));
            evaluation = mark === `%` ? { kind: `open`, value } : { kind: `closed`, turns: value };
        }
        if (this.peek() !== `}`) return this.failed(this.syntax(turn, `info-end`));
        this.at += 1;
        return { ok: true, value: { clockMs, evaluation } };
    }

    // A visual block whose sections do not all read as the grammar's is passed over whole, as null.
    private readVisual(turn: number): Read<HtttxVisual | null> {
        this.at += 1;
        let body = ``;
        for (;;) {
            const next = this.peek();
            if (next === `>`) break;
            if (next === `` || next === `<`) return this.failed(this.syntax(turn, `visual-end`));
            body += next;
            this.at += 1;
        }
        this.at += 1;
        const integer = `(0|-?[1-9][0-9]{0,${String(coordinateDigits - 1)}})`;
        const match = new RegExp(`^${integer},${integer}(?::#([A-Z]?))?(?::\\$([A-Z0-9]+))?$`, `u`).exec(body);
        if (match === null) return { ok: true, value: null };
        const [, q = `0`, r = `0`, letter, label] = match;
        const highlight = letter === undefined ? null : { letter: letter === `` ? null : letter };
        return { ok: true, value: { cell: wireToInternal({ q: Number(q), r: Number(r) }), highlight, label: label ?? null } };
    }

    // A whole number without a sign or leading zeros, as a turn number and a clock are written.
    private readUnsigned(digits = coordinateDigits): number | null {
        const start = this.at;
        const run = this.readRun();
        if (run === `` || run.length > digits || (run.length > 1 && run.startsWith(`0`))) {
            this.at = start;
            return null;
        }
        return Number(run);
    }

    // v2's signed integer: 0, or a minus at most, then a digit 1 to 9 and any digits.
    private readSigned(digits: number): number | null {
        const start = this.at;
        const negative = this.peek() === `-`;
        if (negative) this.at += 1;
        const run = this.readRun();
        if (run === `` || run.length > digits || (run.length > 1 && run.startsWith(`0`)) || (negative && run === `0`)) {
            this.at = start;
            return null;
        }
        return negative ? -Number(run) : Number(run);
    }

    // v1's coordinate: a minus at most, then digits, leading zeros and -0 read as the plain number.
    private readLenient(): number | null {
        const start = this.at;
        const negative = this.peek() === `-`;
        if (negative) this.at += 1;
        const run = this.readRun();
        const significant = run.replace(/^0+/u, ``);
        if (run === `` || significant.length > coordinateDigits) {
            this.at = start;
            return null;
        }
        const value = Number(significant === `` ? `0` : significant);
        // The trailing + 0 turns -0 into 0.
        return negative ? -value + 0 : value;
    }

    // Digits, past any whitespace between them where v2 reads it.
    private readRun(): string {
        let run = ``;
        while (/^[0-9]$/u.test(this.peek())) {
            run += this.text.charAt(this.at);
            this.at += 1;
        }
        return run;
    }

    // A number that is there but written wrong, with a leading zero, as -0, or too long, says so;
    // one that is missing names what belongs there.
    private numberError(turn: number, missing: `integer` | `cell-number`): HtttxError {
        const start = this.at;
        if (this.peek() === `-`) this.at += 1;
        const written = /^[0-9]$/u.test(this.peek());
        this.at = start;
        return this.syntax(turn, written ? `integer-form` : missing);
    }

    private failed(error: HtttxError): { readonly ok: false; readonly error: HtttxError } {
        return { ok: false, error };
    }

    private place(offset: number): { readonly line: number; readonly column: number } {
        const before = this.text.slice(0, offset).split(/\r\n|\r|\n/u);
        return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
    }

    syntaxAt(offset: number, turn: number | null, expected: HtttxExpected): HtttxError {
        return { kind: `syntax`, ...this.place(offset), turn, expected };
    }

    private syntax(turn: number | null, expected: HtttxExpected, offset?: number): HtttxError {
        if (offset === undefined) this.peek();
        return this.syntaxAt(offset ?? this.at, turn, expected);
    }
}
