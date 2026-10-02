import { describe, expect, it } from 'vitest';
import { gameTurnCap } from '@hexo-arena/contract';
import type { TurnCells } from '@hexo-arena/rules';
import { readImport, type Imported } from '../src/analysis/import-text';
import { lineLink, setupLink } from '../src/analysis/links';
import { readGame, type NotationRead } from '../src/analysis/notation';
import { drawLine, workedText, workedTurns } from './analysis-lines';

const origin = `https://arena.example`;

function imported(text: string): Imported {
    const result = readImport(text, origin);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    return result.value;
}

function refusal(text: string): unknown {
    const result: NotationRead<Imported> = readImport(text, origin);
    return result.ok ? `accepted` : result.error;
}

function turnsOf(value: Imported): readonly TurnCells[] | null {
    return value.kind === `line` || value.kind === `setup` ? value.line.turns : null;
}

// A finished game from another site, as HTTTX text and as the analysis
// link hexo.tyto.cc's own encoder writes for the same stones.
const shortGame = `version[1];\n1. [3,0][1,2];\n2. [2,1][-1,1];\n3. [1,0][-1,2];\n4. [0,2][0,1];\n5. [0,3][-1,3];\n6. [1,1][0,-1];\n7. [3,1][-1,4];\n8. [0,-2][0,-3];\n`;
const shortGameTyto = `https://hexo.tyto.cc/analysis#c=BgAGAwYBAAECAAIDBAMCAQYFBAUEAQECCAEGBwMEBQY`;
const shortGameTytoDecimal = `https://hexo.tyto.cc/analysis#a=3.0_3.-2_3.-1_0.-1_1.0_1.-2_2.-2_1.-1_3.-3_2.-3_2.-1_-1.1_4.-1_3.-4_-2.2_-3.3`;

function shortGameTurns(): readonly TurnCells[] {
    const read = readGame(shortGame);
    if (!read.ok) throw new Error(`the fixture game is refused`);
    return read.value.turns;
}

describe('pasted text', () => {
    it('reads HTTTX game text as a line from the origin', () => {
        expect(imported(workedText)).toMatchObject({ kind: `line`, pending: null, line: { turns: workedTurns } });
        expect(imported(`  name[A game];\n1. [1,0][0,1];\n`)).toMatchObject({ kind: `line` });
        expect(turnsOf(imported(`1.[1,0][1,-2];`))).toEqual(workedTurns.slice(0, 1));
    });

    it('reads boat text as a set-up board with the default player to move', () => {
        const value = imported(`....x/..xx.o/.xxo/o/.o\n`);
        expect(value).toMatchObject({ kind: `setup`, start: { toMove: 1 }, line: { turns: [] } });
        expect(value.kind === `setup` && value.start.stones).toHaveLength(9);
    });

    it('refuses empty text and text of no known form', () => {
        expect(refusal(` \n `)).toEqual({ kind: `empty` });
        expect(refusal(`hello world`)).toEqual({ kind: `unknown-text` });
    });

    it('passes on what the readers refuse', () => {
        expect(refusal(`version[1];\n1. [1,0][0,1];\n2. [2,0];\n`)).toMatchObject({ kind: `illegal`, turn: 2 });
        expect(refusal(`opening[3];\n1. [1,0];`)).toMatchObject({ kind: `illegal`, turn: 1, rejection: { kind: `turn-unfinished` } });
        expect(refusal(`x.o/.x1`)).toEqual({ kind: `boat-character`, index: 6, character: `1` });
    });
});

describe('links of this site', () => {
    it('open a stored game, at the turn the game page named', () => {
        expect(imported(`${origin}/game/g_7f3a`)).toEqual({ kind: `game`, gameId: `g_7f3a`, turn: null });
        expect(imported(`${origin}/game/g_7f3a/?turn=9`)).toEqual({ kind: `game`, gameId: `g_7f3a`, turn: 9 });
        expect(imported(`${origin}/analysis?game=g_7f3a&turn=4`)).toEqual({ kind: `game`, gameId: `g_7f3a`, turn: 4 });
    });

    it('open the line or board an analysis link holds', () => {
        expect(turnsOf(imported(`${origin}${lineLink(workedTurns)}`))).toEqual(workedTurns);
        const setup = imported(`${origin}${setupLink({ stones: [{ x: 0, y: 0, player: 1 }], toMove: 0 }, [])}`);
        expect(setup).toMatchObject({ kind: `setup`, start: { toMove: 0 } });
        expect(imported(`${origin}/analysis`)).toMatchObject({ kind: `line`, line: { turns: [] }, pending: null });
    });

    it('refuse a page that holds no board, or another origin', () => {
        expect(refusal(`${origin}/ladder`)).toEqual({ kind: `unknown-link` });
        expect(refusal(`https://elsewhere.example/game/g_7f3a`)).toEqual({ kind: `unknown-link` });
        expect(refusal(`${origin}/game/..%2F..`)).toEqual({ kind: `link-field`, field: `game` });
    });
});

describe('hexo.tyto.cc links', () => {
    it('decode a compact line the site wrote to the same turns as its HTTTX text', () => {
        const value = imported(shortGameTyto);
        expect(turnsOf(value)).toEqual(shortGameTurns());
        expect(value.kind === `line` && value.line.win?.player).toBe(0);
    });

    it('decode the older decimal form and the play path alike', () => {
        expect(turnsOf(imported(shortGameTytoDecimal))).toEqual(shortGameTurns());
        expect(turnsOf(imported(shortGameTyto.replace(`/analysis#`, `/#`)))).toEqual(shortGameTurns());
    });

    it('read varints of several bytes and the site\'s own sample', () => {
        // [100,-70] and [-200,3] on the site's axes, one turn far from the origin.
        expect(refusal(`https://hexo.tyto.cc/analysis#c=yAGLAY8DBg`)).toEqual({
            kind: `illegal`,
            turn: 1,
            cell: { x: 100, y: -70 },
            rejection: { kind: `outside-placement-radius` },
        });
        expect(turnsOf(imported(`https://hexo.tyto.cc/analysis#c=AgEAAgIAAQAEAAcA`))).toEqual([
            [
                { x: 1, y: -1 },
                { x: 0, y: 1 },
            ],
            [
                { x: 1, y: 0 },
                { x: -1, y: 0 },
            ],
            [
                { x: 2, y: 0 },
                { x: -4, y: 0 },
            ],
        ]);
    });

    it('take a link a chat app wrapped and percent-encoded, padded or not', () => {
        const wrapped = `${shortGameTyto.slice(0, 50)}%20${shortGameTyto.slice(50)}`;
        expect(turnsOf(imported(wrapped))).toEqual(shortGameTurns());
        expect(turnsOf(imported(`${shortGameTyto}=`))).toEqual(shortGameTurns());
    });

    it('keep a lone last stone as the first half of an unfinished turn', () => {
        // The origin, o at [1,0] and [0,1] on the site's axes, then x's first stone at [-1,0].
        const value = imported(`https://hexo.tyto.cc/analysis#c=AgAAAgEA`);
        expect(value).toMatchObject({ kind: `line`, pending: { x: -1, y: 0 } });
        expect(turnsOf(value)).toHaveLength(1);
    });

    it('open an empty line as a new board', () => {
        expect(imported(`https://hexo.tyto.cc/analysis#c=`)).toMatchObject({ kind: `line`, line: { turns: [] }, pending: null });
    });

    it('refuse data the site could not have written', () => {
        for (const data of [`#c=gA`, `#c=AgEA_`, `#c=Ag`, `#c=!!`, `#a=1.0_x.2`, `#a=1.0_.5`]) {
            expect(refusal(`https://hexo.tyto.cc/analysis${data}`)).toEqual({ kind: `link-data` });
        }
        expect(refusal(`https://hexo.tyto.cc/#g=abc`)).toEqual({ kind: `unknown-link` });
        expect(refusal(`https://hexo.tyto.cc/proof/abc#c=AgEA`)).toEqual({ kind: `unknown-link` });
    });

    it('refuse a line longer than a game may be', () => {
        const turns = drawLine(gameTurnCap + 1);
        const encoded = encodeTyto(turns.flat());
        expect(refusal(`https://hexo.tyto.cc/analysis#c=${encoded}`)).toEqual({ kind: `too-many-turns`, limit: gameTurnCap });
    });
});

describe('hexo.did.science links', () => {
    it('are recognized as games and sandboxes that site holds', () => {
        expect(imported(`https://hexo.did.science/games/abc123`)).toEqual({ kind: `elsewhere`, site: `did-science`, page: `game` });
        expect(imported(`https://hexo.did.science/sandbox/xyz`)).toEqual({ kind: `elsewhere`, site: `did-science`, page: `sandbox` });
        expect(refusal(`https://hexo.did.science/leaderboard`)).toEqual({ kind: `unknown-link` });
    });
});

// The compact form as described: zigzag, then 7-bit groups low first with a
// continuation bit, then base64url without padding.
function encodeTyto(stones: readonly { readonly x: number; readonly y: number }[]): string {
    const bytes: number[] = [];
    for (const value of stones.flatMap((stone) => [stone.x, stone.y])) {
        let zigzag = value >= 0 ? 2 * value : -2 * value - 1;
        while (zigzag > 0x7f) {
            bytes.push((zigzag & 0x7f) | 0x80);
            zigzag = Math.floor(zigzag / 128);
        }
        bytes.push(zigzag);
    }
    return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, `-`).replace(/\//gu, `_`).replace(/=+$/u, ``);
}
