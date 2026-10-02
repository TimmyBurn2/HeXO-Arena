import { describe, expect, it } from 'vitest';
import { gameTurnCap } from '@hexo-arena/contract';
import { originSetup, type Setup } from '@hexo-arena/rules';
import { cellText, playLine, readGame, writeGame, writeTurns, type NotationRead, type PlayedLine } from '../src/analysis/notation';
import { drawLine, workedText, workedTurns } from './analysis-lines';

function read(text: string, start?: Setup): PlayedLine {
    const result = readGame(text, start);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.error)}`);
    return result.value;
}

function refusal<T>(result: NotationRead<T>): unknown {
    return result.ok ? `accepted` : result.error;
}

const roundTrip = (text: string) => writeGame(read(text).turns);

// Two finished games from another site, reduced to their cells.
const shortGame = `version[1];\n1. [3,0][1,2];\n2. [2,1][-1,1];\n3. [1,0][-1,2];\n4. [0,2][0,1];\n5. [0,3][-1,3];\n6. [1,1][0,-1];\n7. [3,1][-1,4];\n8. [0,-2][0,-3];\n`;
const longGame = [
    `version[1];`,
    `1. [0,-1][1,-1];`,
    `2. [2,-1][1,0];`,
    `3. [3,-2][0,1];`,
    `4. [-1,0][-1,-1];`,
    `5. [-1,-2][-1,1];`,
    `6. [-2,1][-2,0];`,
    `7. [-3,0][2,0];`,
    `8. [-2,-1][0,-2];`,
    `9. [1,-3][-3,1];`,
    `10. [-3,2][-4,3];`,
    `11. [-5,4][4,4];`,
    `12. [-3,3][-2,2];`,
    `13. [-2,3][-2,-2];`,
    `14. [-3,-1][-4,4];`,
    `15. [3,4][-4,-1];`,
    `16. [2,4][-4,2];`,
    `17. [-4,5][-4,1];`,
    `18. [-3,4][-5,3];`,
    `19. [1,1][2,1];`,
    `20. [3,1][-5,5];`,
    `21. [-6,6][-5,1];`,
    `22. [-1,2][-3,5];`,
    `23. [0,2][-5,2];`,
    `24. [-3,6][-3,7];`,
    ``,
].join(`\n`);

// x builds a row along q from the origin and completes it with the first stone of turn 6.
const firstStoneWin = `version[1];\n1. [3,-3][5,-5];\n2. [1,0][2,0];\n3. [5,-3][7,-5];\n4. [3,0][4,0];\n5. [7,-3][9,-5];\n6. [5,0];\n`;

describe('the HTTTX writer', () => {
    it('writes the worked example byte for byte', () => {
        expect(writeGame(workedTurns)).toBe(workedText);
    });

    it('writes the same turns compactly for a link', () => {
        expect(writeTurns(workedTurns.slice(0, 2))).toBe(`1.[1,0][1,-2];2.[-1,1][0,2];`);
    });

    it('writes a cell as q then r', () => {
        expect(cellText({ x: -1, y: 2 })).toBe(`[1,-2]`);
        expect(cellText({ x: 0, y: 0 })).toBe(`[0,0]`);
    });

    it('writes an empty line as the header alone', () => {
        expect(writeGame([])).toBe(`version[1];\n`);
    });
});

describe('the HTTTX reader', () => {
    it('reads the worked example to its engine cells, o to move', () => {
        const line = read(workedText);
        expect(line.turns).toEqual(workedTurns);
        expect(line.end.toMove).toBe(1);
        expect(line.win).toBeNull();
    });

    it('reads two real games and writes them back byte for byte, each won by x', () => {
        for (const text of [shortGame, longGame]) {
            const line = read(text);
            expect(writeGame(line.turns)).toBe(text);
            expect(line.win?.player).toBe(0);
        }
    });

    it('reads the spec example, metadata and no version, and writes it strictly', () => {
        const example = [
            `name[GameName 0]platform[WebsiteXY 0]playercross[BlueWhale 0]playercircle[GreenSnake 0]timecontrol[Fischer 60+5]endreason[win]winner[cross]datetime[2026-03-18 23:20:14];`,
            `1. [-1,0][0,1];`,
            `2. [-1,1][-2,2];`,
            `3. [1,-1][-5,5];`,
            `4. [-1,2][1,0];`,
            `5. [5,0][-3,2];`,
        ].join(`\n`);
        expect(roundTrip(example)).toBe(`version[1];\n1. [-1,0][0,1];\n2. [-1,1][-2,2];\n3. [1,-1][-5,5];\n4. [-1,2][1,0];\n5. [5,0][-3,2];\n`);
    });

    it('reads keys split by whitespace, threat marks, and compact text, keeping none of the extras', () => {
        expect(roundTrip(`version[1]\nname[Test game] platform[HeXO Arena];\n1. [1,0][0,1];\n`)).toBe(`version[1];\n1. [1,0][0,1];\n`);
        expect(roundTrip(`version[1];\n1. [1,0][0,1];\n2. [2,0][3,0]!!;\n`)).toBe(`version[1];\n1. [1,0][0,1];\n2. [2,0][3,0];\n`);
        expect(roundTrip(`1.[1,0][0,1];2.[-1,0][-1,1];`)).toBe(`version[1];\n1. [1,0][0,1];\n2. [-1,0][-1,1];\n`);
        expect(roundTrip(`version[1];\r\n1.  [ 1 , 0 ] [0,1] ;\r\n`)).toBe(`version[1];\n1. [1,0][0,1];\n`);
    });

    it('keeps a last turn written without its semicolon', () => {
        expect(roundTrip(`version[1];\n1. [1,0][0,1];\n2. [2,0][3,0]`)).toBe(`version[1];\n1. [1,0][0,1];\n2. [2,0][3,0];\n`);
    });

    it('reads metadata alone as a game with no turns', () => {
        expect(read(`version[1];`).turns).toEqual([]);
    });

    it('ignores keys other than version, whose value must be 1', () => {
        expect(read(`Version[2];\n1. [1,0][0,1];\n`).turns).toHaveLength(1);
        expect(refusal(readGame(`version[2];\n1. [1,0][0,1];\n`))).toEqual({ kind: `version`, version: `2` });
    });

    it('refuses empty text', () => {
        expect(refusal(readGame(`   \n`))).toEqual({ kind: `empty` });
    });

    it('refuses turn numbers out of order or with gaps', () => {
        expect(refusal(readGame(`version[1];\n2. [2,0][3,0];\n1. [1,0][0,1];\n`))).toEqual({ kind: `turn-number`, expected: 1, found: 2 });
        expect(refusal(readGame(`version[1];\n1. [1,0][0,1];\n7. [2,0][3,0];\n`))).toEqual({ kind: `turn-number`, expected: 2, found: 7 });
    });

    it('refuses a doubled semicolon, where a turn number should be', () => {
        expect(refusal(readGame(`version[1];\n1. [1,0][0,1];;\n`))).toEqual({ kind: `syntax`, line: 2, column: 15, turn: 2, expected: `turn-number` });
    });

    it('names the line, column, and turn of a syntax error', () => {
        expect(refusal(readGame(`version[1];\n1. [1,0][0,1];\n2. [2,0]x[3,0];\n`))).toEqual({ kind: `syntax`, line: 3, column: 9, turn: 2, expected: `turn-end` });
        expect(refusal(readGame(`version[1];\r\n1.  move [ 1 , 0 ] then [0,1] ;\r\n`))).toEqual({ kind: `syntax`, line: 2, column: 5, turn: 1, expected: `coordinate` });
        expect(refusal(readGame(`version[1];\nx. [1,0][0,1];\n`))).toEqual({ kind: `syntax`, line: 2, column: 1, turn: 1, expected: `turn-number` });
    });

    it('refuses a sign but a minus, a spaced minus, and leading zeros in a turn number', () => {
        for (const text of [`1. [+1,0][0,1];`, `1. [- 1,0][0,1];`]) {
            expect(refusal(readGame(text))).toMatchObject({ kind: `syntax`, expected: `integer` });
        }
        expect(refusal(readGame(`01. [1,0][0,1];`))).toMatchObject({ kind: `syntax`, expected: `turn-number` });
    });

    it('reads leading zeros and -0 in a coordinate as the plain number, and writes them back plainly', () => {
        const read = readGame(`1. [001,-00][-0,02];`);
        expect(read.ok && read.value.turns).toEqual([
            [
                { x: 1, y: 0 },
                { x: 2, y: -2 },
            ],
        ]);
        expect(read.ok && Object.is(read.value.turns[0]?.[0].y, -0)).toBe(false);
        expect(read.ok && writeGame(read.value.turns)).toBe(`version[1];\n1. [1,0][0,2];\n`);
        expect(refusal(readGame(`1. [0001234567890,0][0,1];`))).toMatchObject({ kind: `syntax`, expected: `integer` });
    });

    it('refuses a missing dot and a second dot', () => {
        expect(refusal(readGame(`1 [1,0][0,1];`))).toMatchObject({ kind: `syntax`, expected: `dot` });
        expect(refusal(readGame(`1. [1,0].[0,1];`))).toMatchObject({ kind: `syntax`, expected: `turn-end` });
    });

    it('refuses a turn of no cells or of three', () => {
        expect(refusal(readGame(`version[1];\n1. ;\n`))).toEqual({ kind: `coordinate-count`, turn: 1, count: 0 });
        expect(refusal(readGame(`version[1];\n1. [1,0][0,1][2,0];\n`))).toEqual({ kind: `coordinate-count`, turn: 1, count: 3 });
    });

    it('refuses a turn the rules refuse, naming its number and cell', () => {
        expect(refusal(readGame(`version[1];\n1. [0,0][100,-50];\n`))).toEqual({
            kind: `illegal`,
            turn: 1,
            cell: { x: 0, y: 0 },
            rejection: { kind: `cell-occupied` },
        });
        expect(refusal(readGame(`version[1];\n1. [1,0][100,-50];\n`))).toEqual({
            kind: `illegal`,
            turn: 1,
            cell: { x: 50, y: 50 },
            rejection: { kind: `outside-placement-radius` },
        });
    });

    it('refuses a one-stone turn that completes no six', () => {
        expect(refusal(readGame(`version[1];\n1. [1,0][0,1];\n2. [2,0];\n`))).toEqual({
            kind: `illegal`,
            turn: 2,
            cell: { x: 2, y: 0 },
            rejection: { kind: `turn-unfinished` },
        });
    });

    it('reads and writes a winning one-stone last turn, and refuses anything after the six', () => {
        const line = read(firstStoneWin);
        expect(line.win?.player).toBe(0);
        expect(line.turns.at(-1)).toEqual([{ x: 5, y: 0 }]);
        expect(writeGame(line.turns)).toBe(firstStoneWin);
        expect(refusal(readGame(`${firstStoneWin}7. [1,1][2,2];\n`))).toMatchObject({ kind: `illegal`, turn: 7, rejection: { kind: `game-finished` } });
        expect(refusal(readGame(firstStoneWin.replace(`6. [5,0];`, `6. [5,0][6,0];`)))).toEqual({
            kind: `illegal`,
            turn: 6,
            cell: { x: 6, y: 0 },
            rejection: { kind: `game-finished` },
        });
    });

    it('refuses more turns than a game may have', () => {
        const turns = drawLine(gameTurnCap + 1);
        expect(read(writeGame(turns.slice(0, gameTurnCap))).turns).toHaveLength(gameTurnCap);
        expect(refusal(readGame(writeGame(turns)))).toEqual({ kind: `too-many-turns`, limit: gameTurnCap });
    });

    it('plays turns after a set-up board for its player to move, counting from 1', () => {
        const start: Setup = {
            stones: [
                { x: 0, y: 0, player: 1 },
                { x: 1, y: 0, player: 0 },
            ],
            toMove: 0,
        };
        const line = read(`1. [2,0][3,0];`, start);
        expect(line.end.stones.slice(2).map((stone) => stone.player)).toEqual([0, 0]);
        expect(refusal(readGame(`1. [0,0][3,0];`, start))).toMatchObject({ kind: `illegal`, turn: 1, rejection: { kind: `cell-occupied` } });
    });
});

describe('playLine', () => {
    it('plays turns by the rules and names the first refused', () => {
        const played = playLine(originSetup, workedTurns);
        expect(played.ok && played.value.end.stones).toHaveLength(9);
        const refused = playLine(originSetup, [workedTurns[0] ?? [{ x: 1, y: 0 }], [{ x: 9, y: 9 }, { x: 0, y: -1 }]]);
        expect(refusal(refused)).toEqual({ kind: `illegal`, turn: 2, cell: { x: 9, y: 9 }, rejection: { kind: `outside-placement-radius` } });
    });
});
