import { describe, expect, it } from 'vitest';
import { analysisStoneCap } from '@hexo-arena/contract';
import type { Stone } from '@hexo-arena/rules';
import { boatToMove, readBoat, readBoatSetup, writeBoat } from '../src/analysis/boat';
import type { NotationRead } from '../src/analysis/notation';

function stones(text: string): readonly Stone[] {
    const result = readBoat(text);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    return result.value;
}

function refusal<T>(result: NotationRead<T>): unknown {
    return result.ok ? `accepted` : result.error;
}

const roundTrip = (text: string) => writeBoat(stones(text));

// The worked example's nine stones after its fourth turn, in engine x,y.
const worked: Stone[] = [
    { x: 0, y: 0, player: 0 },
    { x: 1, y: 0, player: 1 },
    { x: -1, y: 2, player: 1 },
    { x: 0, y: -1, player: 0 },
    { x: 2, y: -2, player: 0 },
    { x: -2, y: 1, player: 1 },
    { x: 3, y: -1, player: 1 },
    { x: 1, y: -1, player: 0 },
    { x: -1, y: 0, player: 0 },
];

describe('the boat writer', () => {
    it('writes the worked example byte for byte', () => {
        expect(writeBoat(worked)).toBe(`....x/..xx.o/.xxo/o/.o`);
    });

    it('writes an empty row as nothing between slashes, and no board as nothing', () => {
        expect(writeBoat([
            { x: 3, y: 5, player: 0 },
            { x: 3, y: 7, player: 1 },
        ])).toBe(`x//o`);
        expect(writeBoat([])).toBe(``);
    });
});

describe('the boat reader', () => {
    it('puts the first character at the origin, each row one step down-right', () => {
        expect(stones(`x.o/.xo`)).toEqual([
            { x: 0, y: 0, player: 0 },
            { x: 2, y: 0, player: 1 },
            { x: 1, y: 1, player: 0 },
            { x: 2, y: 1, player: 1 },
        ]);
    });

    it('reads the worked example back to the same board, shifted', () => {
        const read = stones(`....x/..xx.o/.xxo/o/.o`);
        const shifted = worked.map((stone) => ({ ...stone, x: stone.x + 2, y: stone.y + 2 }));
        expect(read).toHaveLength(worked.length);
        expect(read).toEqual(expect.arrayContaining(shifted));
    });

    it('keeps the cases explore.htttx.io writes back unchanged', () => {
        for (const text of [`x//o`, `xxoo`, `....x/..xx.o/.xxo/o/.o`]) expect(roundTrip(text)).toBe(text);
        expect(roundTrip(`/x`)).toBe(`x`);
    });

    it('reads highlights as plain stones and empty cells', () => {
        expect(roundTrip(`x.o/.xo/..X#`)).toBe(`x.o/.xo/..x`);
        expect(stones(`O#x`)).toEqual([
            { x: 0, y: 0, player: 1 },
            { x: 2, y: 0, player: 0 },
        ]);
    });

    it('refuses any other character, naming where it stands', () => {
        expect(refusal(readBoat(`x.o/.x1`))).toEqual({ kind: `boat-character`, index: 6, character: `1` });
        expect(refusal(readBoat(`x . o`))).toEqual({ kind: `boat-character`, index: 1, character: ` ` });
    });
});

describe('the player to move on a boat board', () => {
    it('is o when x has more stones, and x otherwise', () => {
        expect(boatToMove(worked)).toBe(1);
        expect(boatToMove(stones(`xo`))).toBe(0);
        expect(boatToMove(stones(`xoo`))).toBe(0);
    });

    it('can be named instead', () => {
        const named = readBoatSetup(`xo`, 1);
        expect(named.ok && named.value.toMove).toBe(1);
        const found = readBoatSetup(`xxo`, null);
        expect(found.ok && found.value.toMove).toBe(1);
    });
});

describe('a boat board to play from', () => {
    it('refuses a board with no stones, a six already on it, or more stones than an analyzer reads', () => {
        expect(refusal(readBoatSetup(`../`, null))).toEqual({ kind: `setup`, problem: { kind: `no-stones` } });
        expect(refusal(readBoatSetup(`oxxxxxx`, 1))).toMatchObject({ kind: `setup`, problem: { kind: `six-on-board` } });
        const crowded = `xo`.repeat(Math.ceil(analysisStoneCap / 2));
        expect(refusal(readBoatSetup(crowded, null))).toEqual({ kind: `setup`, problem: { kind: `too-many-stones`, count: crowded.length } });
        expect(readBoatSetup(crowded.slice(0, analysisStoneCap), null).ok).toBe(true);
    });

    it('passes on a character the boat reader refuses', () => {
        expect(refusal(readBoatSetup(`x?`, null))).toEqual({ kind: `boat-character`, index: 1, character: `?` });
    });
});
