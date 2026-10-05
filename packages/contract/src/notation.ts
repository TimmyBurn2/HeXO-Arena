import { internalToWire } from './axial';
import type { FinishReason, Side, TimeControl } from './stream';

/** A placed stone's cell in the engine's coordinates. */
export interface NotationCell {
    readonly x: number;
    readonly y: number;
}

/** What an HTTTX v1 file may say of its game beside the turns; v1 makes every key optional. */
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
    const { q, r } = internalToWire(cell);
    return `[${String(q)},${String(r)}]`;
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

// v1 writes integer seconds; a clock off whole seconds is left out rather than rounded.
function timeControlValue(clock: TimeControl): string | null {
    if (clock.mode !== `match` || clock.mainTimeMs % 1_000 !== 0 || clock.incrementMs % 1_000 !== 0) return null;
    return `${String(clock.mainTimeMs / 1_000)}+${String(clock.incrementMs / 1_000)}`;
}

// v1 names four endings; a disconnect, an illegal move, and an abort fit
// none of them, so those games say only who won, if anyone did.
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

function headerOf(header: HtttxHeader): string {
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
        .map(([key, value]) => [key, value === undefined || value === null ? `` : cleanValue(value)] as const)
        .filter(([, value]) => value !== ``)
        .map(([key, value]) => `${key}[${value}]`)
        .join(``);
}

/**
 * A game as strict HTTTX v1 text, which every known reader accepts:
 * `version[1]` and the header's keys in one metadata segment, then one
 * numbered turn a line from the origin, which v1 never writes.
 * Each turn holds two cells, a one-stone turn only where it completes six;
 * an opening's stones are the turns they are.
 */
export function writeHtttx(turns: readonly (readonly NotationCell[])[], header: HtttxHeader = {}): string {
    const lines = turns.map((cells, index) => `${String(index + 1)}. ${cells.map(htttxCell).join(``)};\n`);
    return `version[1]${headerOf(header)};\n${lines.join(``)}`;
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
