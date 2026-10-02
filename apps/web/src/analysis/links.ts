import { analysisPagePath, gameTurnCap, playerOf, sideOf } from '@hexo-arena/contract';
import { originSetup, type Player, type Setup, type TurnCells } from '@hexo-arena/rules';
import { readBoatSetup, writeBoat } from './boat';
import { playLine, readGame, writeTurns, type NotationRead, type PlayedLine } from './notation';

/**
 * What an analysis address opens: a new board, a line from the origin,
 * a set-up board and a line after it, or a stored game, at a turn when one is named.
 */
export type AnalysisAddress =
    | { readonly kind: `blank` }
    | { readonly kind: `line`; readonly line: PlayedLine }
    | { readonly kind: `setup`; readonly start: Setup; readonly line: PlayedLine }
    | { readonly kind: `game`; readonly gameId: string; readonly turn: number | null };

// Boards and lines travel in the fragment, which browsers never send, so
// the server neither sees nor logs them; a stored game travels in the
// query, so the page shell can name it.
const lineField = `t`;
const boatField = `b`;
const toMoveField = `m`;
const gameParam = `game`;
const turnParam = `turn`;

/** A link that opens a line from the origin, ending at its last turn. */
export function lineLink(turns: readonly TurnCells[]): string {
    return `${analysisPagePath}#${lineField}=${writeTurns(turns)}`;
}

/** A link that opens a set-up board, its player to move, and a line after it. */
export function setupLink(start: Setup, turns: readonly TurnCells[]): string {
    const line = turns.length === 0 ? `` : `&${lineField}=${writeTurns(turns)}`;
    return `${analysisPagePath}#${boatField}=${writeBoat(start.stones)}&${toMoveField}=${sideOf(start.toMove)}${line}`;
}

/** A link that opens a stored game, at a turn when one is named. */
export function gameLink(gameId: string, turn: number | null): string {
    const at = turn === null ? `` : `&${turnParam}=${String(turn)}`;
    return `${analysisPagePath}?${gameParam}=${encodeURIComponent(gameId)}${at}`;
}

/**
 * Read an analysis address from a location's query and fragment.
 * A stored game in the query wins over anything in the fragment;
 * a turn that is not a whole number up to the turn cap is dropped, as the game page drops one.
 * Unknown fragment fields are ignored, so a later field does not break an older reader.
 */
export function readAddress(search: string, hash: string): NotationRead<AnalysisAddress> {
    const query = new URLSearchParams(search);
    const gameId = query.get(gameParam);
    if (gameId !== null) {
        if (!/^[A-Za-z0-9_-]{1,100}$/u.test(gameId)) return { ok: false, error: { kind: `link-field`, field: gameParam } };
        return { ok: true, value: { kind: `game`, gameId, turn: turnOf(query.get(turnParam)) } };
    }
    const fields = fragmentFields(hash);
    if (!fields.ok) return fields;
    const boat = fields.value.get(boatField);
    const turns = fields.value.get(lineField);
    if (boat !== undefined) {
        const toMove = toMoveNamed(fields.value.get(toMoveField));
        if (!toMove.ok) return toMove;
        const start = readBoatSetup(boat, toMove.value);
        if (!start.ok) return start;
        const line = readLine(turns, start.value);
        return line.ok ? { ok: true, value: { kind: `setup`, start: start.value, line: line.value } } : line;
    }
    if (turns !== undefined) {
        const line = readLine(turns, originSetup);
        return line.ok ? { ok: true, value: { kind: `line`, line: line.value } } : line;
    }
    return { ok: true, value: { kind: `blank` } };
}

// Chat apps may percent-encode a pasted fragment, so every value is decoded once.
function fragmentFields(hash: string): NotationRead<ReadonlyMap<string, string>> {
    const fields = new Map<string, string>();
    const body = hash.startsWith(`#`) ? hash.slice(1) : hash;
    if (body === ``) return { ok: true, value: fields };
    for (const part of body.split(`&`)) {
        const equals = part.indexOf(`=`);
        const name = equals === -1 ? part : part.slice(0, equals);
        if (fields.has(name)) continue;
        try {
            fields.set(name, decodeURIComponent(equals === -1 ? `` : part.slice(equals + 1)));
        } catch {
            return { ok: false, error: { kind: `link-field`, field: name } };
        }
    }
    return { ok: true, value: fields };
}

function readLine(text: string | undefined, start: Setup): NotationRead<PlayedLine> {
    return text === undefined || text.trim() === `` ? playLine(start, []) : readGame(text, start);
}

// Absent means the board's own default; anything but a side is refused.
function toMoveNamed(side: string | undefined): NotationRead<Player | null> {
    if (side === undefined) return { ok: true, value: null };
    if (side === `x` || side === `o`) return { ok: true, value: playerOf(side) };
    return { ok: false, error: { kind: `link-field`, field: toMoveField } };
}

function turnOf(raw: string | null): number | null {
    if (raw === null || !/^\d{1,4}$/u.test(raw)) return null;
    const turn = Number(raw);
    return turn <= gameTurnCap ? turn : null;
}
