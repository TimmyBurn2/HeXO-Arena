import { describe, expect, it } from 'vitest';
import { analysisPagePath, gameTurnCap } from '@hexo-arena/contract';
import type { Setup, TurnCells } from '@hexo-arena/rules';
import { readBoatSetup } from '../src/analysis/boat';
import { gameLink, lineLink, readAddress, setupLink, type AnalysisAddress } from '../src/analysis/links';
import type { NotationRead } from '../src/analysis/notation';

function address(link: string): NotationRead<AnalysisAddress> {
    const url = new URL(link, `http://localhost`);
    expect(url.pathname).toBe(analysisPagePath);
    return readAddress(url.search, url.hash);
}

function opened(link: string): AnalysisAddress {
    const result = address(link);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    return result.value;
}

function refusal(link: string): unknown {
    const result = address(link);
    return result.ok ? `accepted` : result.error;
}

const twoTurns: TurnCells[] = [
    [
        { x: 1, y: 0 },
        { x: -1, y: 2 },
    ],
    [
        { x: 0, y: -1 },
        { x: 2, y: -2 },
    ],
];

const workedBoat = `....x/..xx.o/.xxo/o/.o`;

function boatBoard(text: string): Setup {
    const read = readBoatSetup(text, null);
    if (!read.ok) throw new Error(`refused: ${JSON.stringify(read.error)}`);
    return read.value;
}

describe('analysis links', () => {
    it('write a line from the origin in the fragment, compactly', () => {
        expect(lineLink(twoTurns)).toBe(`/analysis#t=1.[1,0][1,-2];2.[-1,1][0,2];`);
    });

    it('write a set-up board, its player to move, and the line after it', () => {
        const turns: TurnCells[] = [
            [
                { x: 4, y: 1 },
                { x: 6, y: 1 },
            ],
        ];
        expect(setupLink(boatBoard(workedBoat), turns)).toBe(`/analysis#b=${workedBoat}&m=o&t=1.[5,-1][7,-1];`);
        expect(setupLink(boatBoard(`xo`), [])).toBe(`/analysis#b=xo&m=x`);
    });

    it('write a stored game in the query, its turn when named', () => {
        expect(gameLink(`g_7f3a`, 12)).toBe(`/analysis?game=g_7f3a&turn=12`);
        expect(gameLink(`g_7f3a`, null)).toBe(`/analysis?game=g_7f3a`);
    });
});

describe('readAddress', () => {
    it('opens a blank board without state', () => {
        expect(opened(`/analysis`)).toEqual({ kind: `blank` });
        expect(opened(`/analysis#`)).toEqual({ kind: `blank` });
        expect(opened(`/analysis#zoom=2`)).toEqual({ kind: `blank` });
    });

    it('reads back a line link to the same turns', () => {
        const read = opened(lineLink(twoTurns));
        expect(read.kind === `line` && read.line.turns).toEqual(twoTurns);
        const empty = opened(lineLink([]));
        expect(empty.kind === `line` && empty.line.turns).toEqual([]);
    });

    it('reads a fragment a chat app percent-encoded', () => {
        const read = opened(`/analysis#t=1.%5B1,0%5D%5B1,-2%5D%3B`);
        expect(read.kind === `line` && read.line.turns).toEqual(twoTurns.slice(0, 1));
    });

    it('reads back a set-up link to the same board, player to move, and turns', () => {
        const start = boatBoard(workedBoat);
        const turns: TurnCells[] = [
            [
                { x: 4, y: 1 },
                { x: 6, y: 1 },
            ],
        ];
        const read = opened(setupLink({ ...start, toMove: 0 }, turns));
        expect(read).toMatchObject({ kind: `setup`, start: { stones: start.stones, toMove: 0 } });
        expect(read.kind === `setup` && read.line.turns).toEqual(turns);
        expect(read.kind === `setup` && read.line.end.stones.slice(-2).map((stone) => stone.player)).toEqual([0, 0]);
    });

    it('takes the boat default for a set-up link with no player to move', () => {
        expect(opened(`/analysis#b=xxo`)).toMatchObject({ kind: `setup`, start: { toMove: 1 } });
    });

    it('opens a stored game, the query winning over a fragment', () => {
        expect(opened(`/analysis?game=g_7f3a&turn=12#t=1.[1,0][1,-2];`)).toEqual({ kind: `game`, gameId: `g_7f3a`, turn: 12 });
    });

    it('drops a turn that is not a whole number up to the cap', () => {
        for (const turn of [`-1`, `2.5`, `x`, `12345`, String(gameTurnCap + 1)]) {
            expect(opened(`/analysis?game=g_7f3a&turn=${turn}`)).toEqual({ kind: `game`, gameId: `g_7f3a`, turn: null });
        }
        expect(opened(`/analysis?game=g_7f3a&turn=${String(gameTurnCap)}`)).toMatchObject({ turn: gameTurnCap });
    });

    it('refuses a malformed game id, player to move, or encoding', () => {
        expect(refusal(`/analysis?game=../../etc`)).toEqual({ kind: `link-field`, field: `game` });
        expect(refusal(`/analysis?game=`)).toEqual({ kind: `link-field`, field: `game` });
        expect(refusal(`/analysis#b=xo&m=z`)).toEqual({ kind: `link-field`, field: `m` });
        expect(refusal(`/analysis#t=%E0%A4%A`)).toEqual({ kind: `link-field`, field: `t` });
    });

    it('passes on what the notation and the rules refuse', () => {
        expect(refusal(`/analysis#t=1.[0,0][1,0];`)).toMatchObject({ kind: `illegal`, turn: 1, rejection: { kind: `cell-occupied` } });
        expect(refusal(`/analysis#b=xxxxxx&m=o`)).toMatchObject({ kind: `setup`, problem: { kind: `six-on-board` } });
        expect(refusal(`/analysis#b=x1`)).toEqual({ kind: `boat-character`, index: 1, character: `1` });
    });
});
