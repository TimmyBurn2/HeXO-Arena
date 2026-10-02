import { gameTurnCap } from '@hexo-arena/contract';
import { originSetup, playTurn, type Coord, type Setup, type TurnCells } from '@hexo-arena/rules';
import { readBoatSetup } from './boat';
import { readAddress } from './links';
import { playLine, readGame, type NotationRead, type PlayedLine } from './notation';

/**
 * What pasted text or a pasted link loads:
 * a line from the origin, with a lone first stone of an unfinished turn when the source had one;
 * a set-up board and a line after it; a stored game of this site;
 * or a page of another site that only that site can read, so the reader asks for its HTTTX copy instead.
 */
export type Imported =
    | { readonly kind: `line`; readonly line: PlayedLine; readonly pending: Coord | null }
    | { readonly kind: `setup`; readonly start: Setup; readonly line: PlayedLine }
    | { readonly kind: `game`; readonly gameId: string; readonly turn: number | null }
    | { readonly kind: `elsewhere`; readonly site: `did-science`; readonly page: `game` | `sandbox` };

const tytoHost = `hexo.tyto.cc`;
const didScienceHost = `hexo.did.science`;

/**
 * Read pasted text by its form: a link, HTTTX game text, or a boat position.
 * Links of this site's `origin` open its games and analysis links;
 * hexo.tyto.cc analysis links are decoded here, with no request;
 * hexo.did.science games and sandboxes are recognized but held on that site.
 * Nothing loads on an error.
 */
export function readImport(text: string, origin: string): NotationRead<Imported> {
    const trimmed = text.trim();
    if (trimmed === ``) return { ok: false, error: { kind: `empty` } };
    if (/^https?:\/\//iu.test(trimmed)) return readLink(trimmed, origin);
    if (/^(?:[0-9]|[A-Za-z]+\s*\[)/u.test(trimmed)) {
        const line = readGame(trimmed);
        return line.ok ? { ok: true, value: { kind: `line`, line: line.value, pending: null } } : line;
    }
    if (/^[xoXO.#/]/u.test(trimmed)) {
        const start = readBoatSetup(trimmed, null);
        if (!start.ok) return start;
        const line = playLine(start.value, []);
        return line.ok ? { ok: true, value: { kind: `setup`, start: start.value, line: line.value } } : line;
    }
    return { ok: false, error: { kind: `unknown-text` } };
}

function readLink(text: string, origin: string): NotationRead<Imported> {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return { ok: false, error: { kind: `unknown-link` } };
    }
    const path = url.pathname.replace(/\/+$/u, ``);
    if (url.origin === origin) return readOwnLink(url, path);
    if (url.hostname === tytoHost && (path === `` || path === `/analysis`)) return readTytoFragment(url.hash);
    if (url.hostname === didScienceHost) {
        if (/^\/games\/[^/]+$/u.test(path)) return { ok: true, value: { kind: `elsewhere`, site: `did-science`, page: `game` } };
        if (/^\/sandbox\/[^/]+$/u.test(path)) return { ok: true, value: { kind: `elsewhere`, site: `did-science`, page: `sandbox` } };
    }
    return { ok: false, error: { kind: `unknown-link` } };
}

function readOwnLink(url: URL, path: string): NotationRead<Imported> {
    const game = /^\/game\/([^/]+)$/u.exec(path);
    if (game !== null) {
        const query = new URLSearchParams({ game: decodeSegment(game[1] ?? ``) });
        const turn = url.searchParams.get(`turn`);
        if (turn !== null) query.set(`turn`, turn);
        return readOwnAnalysis(`?${query.toString()}`, ``);
    }
    if (path === `/analysis`) return readOwnAnalysis(url.search, url.hash);
    return { ok: false, error: { kind: `unknown-link` } };
}

function readOwnAnalysis(search: string, hash: string): NotationRead<Imported> {
    const address = readAddress(search, hash);
    if (!address.ok) return address;
    const value = address.value;
    switch (value.kind) {
        case `blank`: {
            const line = playLine(originSetup, []);
            return line.ok ? { ok: true, value: { kind: `line`, line: line.value, pending: null } } : line;
        }
        case `line`:
            return { ok: true, value: { kind: `line`, line: value.line, pending: null } };
        case `setup`:
        case `game`:
            return { ok: true, value };
        default:
            return assertNever(value);
    }
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

// hexo.tyto.cc keeps its line in the fragment: `#c=` holds every stone
// after the origin as two zigzag varints in base64url, HXN's primitives
// with no header; the older `#a=` writes them as `q.r` joined by `_`.
// Its q,r are its board's own axes, +r down-right, which are this site's
// engine x,y, so the cells need no conversion.
function readTytoFragment(hash: string): NotationRead<Imported> {
    const read = hash.startsWith(`#c=`) ? tytoCompact : hash.startsWith(`#a=`) ? tytoDecimal : null;
    if (read === null) return { ok: false, error: { kind: `unknown-link` } };
    const stones = read(hash.slice(3));
    if (stones === null) return { ok: false, error: { kind: `link-data` } };
    return lineOfStones(stones);
}

// Pairs of stones make turns; a lone last stone either completes six,
// a one-stone winning turn, or is the first half of an unfinished turn.
function lineOfStones(stones: readonly Coord[]): NotationRead<Imported> {
    const turns: TurnCells[] = [];
    for (let at = 0; at + 1 < stones.length; at += 2) {
        const [first, second] = [stones[at], stones[at + 1]];
        if (first !== undefined && second !== undefined) turns.push([first, second]);
    }
    const lone = stones.length % 2 === 1 ? stones.at(-1) : undefined;
    if (turns.length + (lone === undefined ? 0 : 1) > gameTurnCap) return { ok: false, error: { kind: `too-many-turns`, limit: gameTurnCap } };
    const line = playLine(originSetup, turns);
    if (!line.ok) return line;
    if (lone === undefined) return { ok: true, value: { kind: `line`, line: line.value, pending: null } };
    const last = playTurn(line.value.end, [lone]);
    if (last.ok) {
        const won: PlayedLine = { turns: [...turns, [lone]], end: last.setup, win: last.win };
        return { ok: true, value: { kind: `line`, line: won, pending: null } };
    }
    if (last.rejection.kind === `turn-unfinished`) return { ok: true, value: { kind: `line`, line: line.value, pending: lone } };
    return { ok: false, error: { kind: `illegal`, turn: turns.length + 1, cell: lone, rejection: last.rejection } };
}

// Varints past this many bits leave the integers numbers hold exactly.
const maxVarintBits = 49;

function tytoCompact(data: string): Coord[] | null {
    const bytes = base64UrlBytes(data);
    if (bytes === null) return null;
    const values: number[] = [];
    let value = 0;
    let shift = 0;
    for (const byte of bytes) {
        value += (byte & 0x7f) * 2 ** shift;
        shift += 7;
        if (shift > maxVarintBits) return null;
        if ((byte & 0x80) === 0) {
            values.push(value % 2 === 0 ? value / 2 : -(value + 1) / 2);
            value = 0;
            shift = 0;
        }
    }
    if (shift !== 0 || values.length % 2 !== 0) return null;
    const stones: Coord[] = [];
    for (let at = 0; at < values.length; at += 2) stones.push({ x: values[at] ?? 0, y: values[at + 1] ?? 0 });
    return stones;
}

// Chat apps wrap long links and percent-encode the break, so whitespace
// is dropped after decoding, as the site itself does; its decoder also
// takes the standard alphabet and padding, so this one does too.
function base64UrlBytes(data: string): Uint8Array | null {
    let text: string;
    try {
        text = decodeURIComponent(data).replace(/\s+/gu, ``);
    } catch {
        return null;
    }
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/u.test(text)) return null;
    const standard = text.replace(/=+$/u, ``).replace(/-/gu, `+`).replace(/_/gu, `/`);
    if (standard.length % 4 === 1) return null;
    let binary: string;
    try {
        binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, `=`));
    } catch {
        return null;
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function tytoDecimal(data: string): Coord[] | null {
    let text: string;
    try {
        text = decodeURIComponent(data);
    } catch {
        return null;
    }
    const stones: Coord[] = [];
    for (const token of text.split(`_`)) {
        if (token === ``) continue;
        const match = /^(-?\d{1,9})\.(-?\d{1,9})$/u.exec(token);
        if (match === null) return null;
        // The trailing + 0 turns a written -0 into 0.
        stones.push({ x: Number(match[1]) + 0, y: Number(match[2]) + 0 });
    }
    return stones;
}

function assertNever(value: never): never {
    throw new Error(`unexpected address ${JSON.stringify(value)}`);
}
