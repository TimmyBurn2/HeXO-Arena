import { describe, expect, it } from 'vitest';
import { htttxCell, htttxLineOf, htttxTags, readHtttx, turnsOfStones, writeHtttx, type HtttxCells, type HtttxDocument, type HtttxHeader, type HtttxRead, type HtttxV2Document } from '../src/notation';

// Engine cells along one row; x = q + r and y = -r, so (3,0) is [3,0] and (1,-1) is [0,1].
const turns = [
    [
        { x: 3, y: 0 },
        { x: 1, y: -1 },
    ],
    [{ x: -1, y: 0 }],
] as const;

const v1 = (header: HtttxHeader = {}, cells: readonly HtttxCells[] = []) => writeHtttx({ version: 1, tags: htttxTags(header), turns: cells });

function document(text: string): HtttxDocument {
    const read = readHtttx(text);
    if (!read.ok) throw new Error(`refused: ${JSON.stringify(read.error)}`);
    return read.document;
}

function refusal(read: HtttxRead): unknown {
    return read.ok ? `accepted` : read.error;
}

function v2(text: string): HtttxV2Document {
    const read = document(text);
    if (read.version !== 2) throw new Error(`read as version ${String(read.version)}`);
    return read;
}

// The examples of the v2 notation's README, verbatim.
const specExamples = [
    `version[2]
name[GameName 0]
platform[WebsiteXY 0]
playercross[BlueWhale 0]
playercircle[GreenSnake 0]
timecontrol[Fischer 60+5]
endreason[resign]
winner[cross]
datetime[2026-10-06 12:00:00];
1. [1,-1] [/];
`,
    `version[2];
1. [-1,0] [0,-1] ;
2. [1,0]  [2,0]  ;
3. [1,-2] [2,-3] ;
4. [3,0]  [4,0]  ;
5. [3,-4] [-2,1] ;
`,
    `version[2];
1. [-1,0] [0,-1] ;
2. [1,0]  [2,0]  ;
3. [1,-2] [2,-3] ;
4. [3,0]  [4,0]  ;
5. [1,-1] [2,-2] ;
6. [5,0]  [/]    ;
`,
    `version[2];
1. [-1,0] [0,-1] {@4500} ;
2. [1,0]  [2,0]  {@4050} ;
3. [1,-2] [2,-3] {@4200} ;
4. [3,0]  [4,0]  {@3550} ;
5. [1,-1] [2,-2] {@3100} ;
6. [5,0]  [/]    {@1050} ;
`,
    `version[2];
1. [-1,0] [0,-1] ;
2. [1,0]  [2,0]  ;
3. [1,-2] [2,-3] ;
4. [3,0]  [4,0]  <3,-4> <-2,1> ;
5. [1,-1] [2,-2] <5,0:#X>      ;
6. [5,0]  [/]    ;
`,
    `version[2];
1. [-1,0] {@4505} [0,-1] { @4500 : %-1 } ;
2. [1,0]  {@4055} [2,0]  { @4050 : %2  } ;
3. [1,-2] {@4205} [2,-3] { @4200 : %-5 } ;
4. [3,0]  {@3555} [4,0]  { @3550 : #-1 } ;
5. [1,-1] {@3105} [2,-2] { @3100 : #1  } ;
6. [5,0]  {@1050} [/] ;
`,
    `version[2];
1. [-1,0] {@4505} [0,-1] { @4500 : %-1 } ;
2. [1,0]  {@4055} [2,0]  { @4050 : %2  } ;
3. [1,-2] {@4205} [2,-3] { @4200 : %-5 } ;
4. [3,0]  {@3555} [4,0]  { @3550 : #-1 } ;
5. [1,-1] {@3105} [2,-2] { @3100 : #1  } ;
6. [5,0]  {@1050}
     <-1,0:$1 > <0,-1:$1> <1,0:$1> <2,0:$1>
     <1,-2:$2 > <2,-3:$2> <3,0:$2> <4,0:$2>
     <1,-1:$3 > <2,-2:$3> <5,0:$3>
   [/];
`,
    `version[2];
1. [-1,0] [0,-1]              ;
2. [1,0]  [2,0]
  ( 2. [1,-2]  [2,-2]     ;
    3. [-1,-1] [-1,-2]    ;
    4. [-1,1]  [1,-1]
      ( 4. [-1,-3] [/]; ) ; )

  ( 2. [-2,1]  [2,-3]     ;
    3. [-1,-1] [/]        ; ) ;

3. [1,-2] [2,-3]              ;
4. [3,0]  [4,0]               ;
5. [1,-1] [2,-2]              ;
6. [5,0]  [/]                 ;
`,
    `version[2];
1. [-1,0][0,-1]; 2. [1,0][2,0] (2. [1,-2][2,-2]; 3. [-1,-1][-1,-2];
4. [-1,1][1,-1] (4. [-1,-3][1,-1];);) (2. [-2,1][2,-3]; 3. [-1,-1][1,-1];);
3. [1,-2][2,-3]; 4. [3,0][4,0]<1,-1><5,0>; 5. [1,-1][2,-2]<1,-1:$1>;
6. [5,0][/]<0,0:#X:$1> ;
`,
];

const cell = (q: number, r: number) => ({ x: q + r, y: -r + 0 });

describe('writeHtttx for v1', () => {
    it('writes the bare version and one numbered turn a line, as the analysis board always has', () => {
        expect(v1()).toBe(`version[1];\n`);
        expect(v1({}, turns)).toBe(`version[1];\n1. [3,0][0,1];\n2. [-1,0];\n`);
    });

    it('writes every key in one metadata segment after the version, in the order the notation lists them', () => {
        const header: HtttxHeader = {
            name: `Duel, game 3 of 10`,
            platform: `HeXO Arena`,
            startedAt: new Date(`2026-10-04T09:05:07.250Z`),
            cross: `devbot-b`,
            circle: `devbot-c`,
            timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 },
            result: { winner: `o`, reason: `six-in-a-row` },
        };
        expect(v1(header, turns).split(`\n`)[0]).toBe(
            `version[1]name[Duel, game 3 of 10]platform[HeXO Arena]utcdatetime[2026-10-04 09:05:07]playercross[devbot-b]playercircle[devbot-c]timecontrol[300+3]endreason[win]winner[circle];`,
        );
    });

    it('writes a clock for a match clock in whole seconds alone, which is all the notation can say', () => {
        const clock = (timeControl: NonNullable<HtttxHeader[`timeControl`]>) => v1({ timeControl });
        expect(clock({ mode: `match`, mainTimeMs: 60_000, incrementMs: 0 })).toBe(`version[1]timecontrol[60+0];\n`);
        expect(clock({ mode: `turn`, turnTimeMs: 10_000 })).toBe(`version[1];\n`);
        expect(clock({ mode: `unlimited` })).toBe(`version[1];\n`);
        expect(clock({ mode: `match`, mainTimeMs: 60_000, incrementMs: 1_500 })).toBe(`version[1];\n`);
    });

    it.each([
        [`x`, `six-in-a-row`, `endreason[win]winner[cross]`],
        [`o`, `timeout`, `endreason[time]winner[circle]`],
        [`x`, `surrender`, `endreason[resign]winner[cross]`],
        [`o`, `disconnect`, `winner[circle]`],
        [`x`, `terminated`, `winner[cross]`],
        [null, `terminated`, `endreason[draw]`],
        [null, `aborted`, ``],
    ] as const)('writes a game %s won by %s with only the ending and winner the notation defines: %s', (winner, reason, written) => {
        expect(v1({ result: { winner, reason } })).toBe(`version[1]${written};\n`);
    });

    it('keeps brackets, semicolons, and line breaks out of every value from a header, and leaves out a value with nothing left', () => {
        const header: HtttxHeader = { name: `Cup [final];\r\n  round\t2`, platform: ` \n `, cross: `a]b`, circle: `c[d` };
        expect(v1(header)).toBe(`version[1]name[Cup (final), round 2]playercross[a)b]playercircle[c(d];\n`);
    });

    it('writes a cell in the wire coordinates', () => {
        expect(htttxCell({ x: 0, y: 0 })).toBe(`[0,0]`);
        expect(htttxCell({ x: 2, y: -1 })).toBe(`[1,1]`);
        expect(htttxCell({ x: -2, y: 3 })).toBe(`[1,-3]`);
    });
});

describe('readHtttx on the v2 examples of the notation', () => {
    it.each(specExamples.map((text, index) => [index + 1, text] as const))('reads example %i and writes it back to text that reads to the same document', (_, text) => {
        const read = v2(text);
        expect(document(writeHtttx(read))).toEqual(read);
    });

    it('keeps tags outside the recommended set, and values the notation would not write, as written', () => {
        expect(v2(specExamples[0] ?? ``).tags).toEqual([
            { key: `name`, value: `GameName 0` },
            { key: `platform`, value: `WebsiteXY 0` },
            { key: `playercross`, value: `BlueWhale 0` },
            { key: `playercircle`, value: `GreenSnake 0` },
            { key: `timecontrol`, value: `Fischer 60+5` },
            { key: `endreason`, value: `resign` },
            { key: `winner`, value: `cross` },
            { key: `datetime`, value: `2026-10-06 12:00:00` },
        ]);
    });

    it('reads a game ended by the final move, its cells in engine coordinates', () => {
        const [turn] = v2(specExamples[0] ?? ``).line;
        expect(turn).toEqual({
            number: 1,
            first: { kind: `stone`, cell: { x: 0, y: 1 }, info: null, visuals: [] },
            second: { kind: `final`, info: null, visuals: [] },
            variations: [],
        });
    });

    it('reads clocks and open and closed evaluations on each stone they follow', () => {
        const line = v2(specExamples[5] ?? ``).line;
        expect(line[0].first.info).toEqual({ clockMs: 4505, evaluation: null });
        expect(line[0].second.info).toEqual({ clockMs: 4500, evaluation: { kind: `open`, value: -1 } });
        expect(line[3]?.second.info).toEqual({ clockMs: 3550, evaluation: { kind: `closed`, turns: -1 } });
        expect(line[4]?.second.info).toEqual({ clockMs: 3100, evaluation: { kind: `closed`, turns: 1 } });
        expect(line[5]?.second).toEqual({ kind: `final`, info: null, visuals: [] });
    });

    it('reads highlights and labels, a bare cell as neither and a label with whitespace before its bracket', () => {
        expect(v2(specExamples[4] ?? ``).line[3]?.second.visuals).toEqual([
            { cell: cell(3, -4), highlight: null, label: null },
            { cell: cell(-2, 1), highlight: null, label: null },
        ]);
        expect(v2(specExamples[4] ?? ``).line[4]?.second.visuals).toEqual([{ cell: cell(5, 0), highlight: { letter: `X` }, label: null }]);
        const labels = v2(specExamples[6] ?? ``).line[5]?.first.visuals ?? [];
        expect(labels).toHaveLength(11);
        expect(labels[0]).toEqual({ cell: cell(-1, 0), highlight: null, label: `1` });
        expect(labels[10]).toEqual({ cell: cell(5, 0), highlight: null, label: `3` });
        expect(v2(specExamples[8] ?? ``).line[5]?.second.visuals).toEqual([{ cell: cell(0, 0), highlight: { letter: `X` }, label: `1` }]);
    });

    it('reads variations under the turn they replace, nested ones under theirs, each from the replaced turn number', () => {
        const [, second] = v2(specExamples[7] ?? ``).line;
        expect(second?.variations).toHaveLength(2);
        const [deep, short] = second?.variations ?? [];
        expect(deep?.map((turn) => turn.number)).toEqual([2, 3, 4]);
        expect(deep?.[2]?.variations).toEqual([
            [{ number: 4, first: { kind: `stone`, cell: cell(-1, -3), info: null, visuals: [] }, second: { kind: `final`, info: null, visuals: [] }, variations: [] }],
        ]);
        expect(short?.map((turn) => turn.second.kind)).toEqual([`stone`, `final`]);
    });

    it('reads the compact example to the same variations as the spaced one', () => {
        const compact = v2(specExamples[8] ?? ``).line[1]?.variations;
        expect(compact?.map((line) => line.map((turn) => turn.number))).toEqual([[2, 3, 4], [2, 3]]);
    });
});

describe('readHtttx on v2 beyond the examples', () => {
    it('reads whitespace anywhere outside a tag value, inside a number too, and keeps it inside a value', () => {
        const read = v2(`version[2] name[ a  b ] ;\n1 . [ - 1 , 0 ]\n[0,\n-1] { @ 4 5 : % - 1 } ;`);
        expect(read.tags).toEqual([{ key: `name`, value: ` a  b ` }]);
        expect(refusal(readHtttx(`version[2];\n1 0 . [ - 1 , 0 ][0,-1];`))).toMatchObject({ kind: `turn-number`, expected: 1, found: 10 });
        const [turn] = v2(`version[2];\n1 . [ - 1 , 0 ]\n[0,\n-1] { @ 4 5 : % - 1 } ;`).line;
        expect(turn.first.cell).toEqual(cell(-1, 0));
        expect(turn.second.info).toEqual({ clockMs: 45, evaluation: { kind: `open`, value: -1 } });
    });

    it('reads #0, a closed evaluation that names no side, and any open value beyond the recommended range', () => {
        expect(v2(`version[2];1.[1,0][0,1]{#0};`).line[0].second.info?.evaluation).toEqual({ kind: `closed`, turns: 0 });
        expect(v2(`version[2];1.[1,0][0,1]{%-250};`).line[0].second.info?.evaluation).toEqual({ kind: `open`, value: -250 });
    });

    it('keeps any capital as a highlight letter and a bare # as none, and passes over a visual with a section it does not know', () => {
        const visuals = v2(`version[2];1.[1,0][0,1]<1,0:#R><2,0:#><3,0:#N:$AB12><4,0:&arrow><5,0:#x><6,0:$a><7,0:#XY><01,0><-0,0><8,0:$A:#X>;`).line[0].second.visuals;
        expect(visuals).toEqual([
            { cell: cell(1, 0), highlight: { letter: `R` }, label: null },
            { cell: cell(2, 0), highlight: { letter: null }, label: null },
            { cell: cell(3, 0), highlight: { letter: `N` }, label: `AB12` },
        ]);
    });

    it('reads the final move with its own info and visuals, and variations after it', () => {
        const [turn] = v2(`version[2];1.[1,1][/]{@1000}<1,1><1,0>(1.[2,0][0,2];);`).line;
        expect(turn.second).toEqual({ kind: `final`, info: { clockMs: 1000, evaluation: null }, visuals: [{ cell: cell(1, 1), highlight: null, label: null }, { cell: cell(1, 0), highlight: null, label: null }] });
        expect(turn.variations).toHaveLength(1);
    });

    it('writes our own document with every kind of note and nesting, which reads back the same', () => {
        const ours = v2(
            `version[2]name[Study]event[Club night];1.[-1,0]{#3}<0,0:#O>[0,-1]{@0:#-12}(1.[1,0]{%100}[0,1]{@60000:%0}<2,0:#N:$A>(1.[2,0][/]{%-100};);2.[2,0][3,0];3.[4,0][/];)(1.[0,1][1,-1];);2.[1,1][/];`,
        );
        expect(writeHtttx(ours)).toBe(
            `version[2]name[Study]event[Club night];\n1. [-1,0]{#3}<0,0:#O>[0,-1]{@0:#-12}\n  (1. [1,0]{%100}[0,1]{@60000:%0}<2,0:#N:$A> (1. [2,0][/]{%-100};); 2. [2,0][3,0]; 3. [4,0][/];)\n  (1. [0,1][1,-1];);\n2. [1,1][/];\n`,
        );
        expect(document(writeHtttx(ours))).toEqual(ours);
    });

    it.each([
        [`a metadata segment with no turns`, `version[2];`, { kind: `syntax`, line: 1, column: 12, turn: 1, expected: `turn-number` }],
        [`the version after another tag`, `name[x]version[2];1.[1,0][0,1];`, { kind: `syntax`, line: 1, column: 1, turn: null, expected: `version-first` }],
        [`a -0`, `version[2];\n1. [-0,1][0,1];`, { kind: `syntax`, line: 2, column: 5, turn: 1, expected: `integer-form` }],
        [`a leading zero`, `version[2];\n1. [1,0][01,1];`, { kind: `syntax`, line: 2, column: 10, turn: 1, expected: `integer-form` }],
        [`a letter for a coordinate`, `version[2];\n1. [1,a][0,1];`, { kind: `syntax`, line: 2, column: 7, turn: 1, expected: `cell-number` }],
        [`a leading zero in a turn number`, `version[2];\n01. [1,0][0,1];`, { kind: `syntax`, line: 2, column: 1, turn: 1, expected: `turn-number` }],
        [`a clock with a sign`, `version[2];\n1. [1,0][0,1]{@-5};`, { kind: `syntax`, line: 2, column: 16, turn: 1, expected: `integer-form` }],
        [`an evaluation with no number`, `version[2];\n1. [1,0][0,1]{%};`, { kind: `syntax`, line: 2, column: 16, turn: 1, expected: `integer` }],
        [`a turn of one stone`, `version[2];\n1. [1,0];`, { kind: `syntax`, line: 2, column: 9, turn: 1, expected: `coordinate` }],
        [`the final move first`, `version[2];\n1. [/][1,0];`, { kind: `syntax`, line: 2, column: 5, turn: 1, expected: `cell-number` }],
        [`a last turn without its semicolon`, `version[2];\n1. [1,0][0,1]`, { kind: `syntax`, line: 2, column: 14, turn: 1, expected: `turn-end` }],
        [`empty info`, `version[2];\n1. [1,0][0,1]{};`, { kind: `syntax`, line: 2, column: 15, turn: 1, expected: `info` }],
        [`info in the wrong order`, `version[2];\n1. [1,0][0,1]{%1:@2};`, { kind: `syntax`, line: 2, column: 17, turn: 1, expected: `info-end` }],
        [`two evaluations`, `version[2];\n1. [1,0][0,1]{@2:%1:#1};`, { kind: `syntax`, line: 2, column: 20, turn: 1, expected: `info-end` }],
        [`an unclosed visual`, `version[2];\n1. [1,0][0,1]<1,0;`, { kind: `syntax`, line: 2, column: 19, turn: 1, expected: `visual-end` }],
        [`an unclosed variation`, `version[2];\n1. [1,0][0,1] (1. [2,0][0,2];;`, { kind: `syntax`, line: 2, column: 30, turn: 2, expected: `turn-number` }],
        [`a variation the text ends inside`, `version[2];\n1. [1,0][0,1] (1. [2,0][0,2];`, { kind: `syntax`, line: 2, column: 30, turn: 2, expected: `variation-end` }],
        [`an empty variation`, `version[2];\n1. [1,0][0,1] ();`, { kind: `syntax`, line: 2, column: 16, turn: 1, expected: `turn-number` }],
        [`a closing parenthesis with no variation open`, `version[2];\n1. [1,0][0,1];)`, { kind: `syntax`, line: 2, column: 15, turn: 2, expected: `turn-number` }],
    ] as const)('refuses %s, naming where', (_, text, error) => {
        expect(refusal(readHtttx(text))).toEqual(error);
    });

    it('refuses a variation that does not start from the turn it replaces, and turns out of order', () => {
        expect(refusal(readHtttx(`version[2];\n1. [1,0][0,1];\n2. [2,0][3,0] (3. [4,0][5,0];);`))).toEqual({ kind: `turn-number`, line: 3, column: 16, expected: 2, found: 3 });
        expect(refusal(readHtttx(`version[2];\n1. [1,0][0,1];\n3. [2,0][3,0];`))).toEqual({ kind: `turn-number`, line: 3, column: 1, expected: 2, found: 3 });
    });

    it('refuses a turn after the final move, in the main line and in a variation', () => {
        expect(refusal(readHtttx(`version[2];\n1. [1,0][/];\n2. [2,0][3,0];`))).toEqual({ kind: `after-final`, line: 3, column: 1, turn: 1 });
        expect(refusal(readHtttx(`version[2];\n1. [1,0][0,1] (1. [2,0][/]; 2. [3,0][4,0];);`))).toEqual({ kind: `after-final`, line: 2, column: 29, turn: 1 });
    });

    it('refuses threat marks by name', () => {
        expect(refusal(readHtttx(`version[2];\n1. [1,0][0,1]!!;`))).toEqual({ kind: `threat-mark`, line: 2, column: 14, turn: 1 });
    });

    it('refuses every version but 1 and 2 by name, and a second version tag that disagrees', () => {
        expect(refusal(readHtttx(`version[3];1.[1,0][0,1];`))).toEqual({ kind: `version`, version: `3` });
        expect(refusal(readHtttx(`version[2]version[1];1.[1,0][0,1];`))).toEqual({ kind: `version`, version: `1` });
    });

    it('refuses an integer longer than a number holds exactly, and a coordinate past any board', () => {
        expect(refusal(readHtttx(`version[2];1.[1,0][0,1]{@1234567890123456};`))).toMatchObject({ kind: `syntax`, expected: `integer-form` });
        expect(v2(`version[2];1.[1,0][0,1]{@123456789012345};`).line[0].second.info?.clockMs).toBe(123456789012345);
        expect(refusal(readHtttx(`version[2];1.[1234567890,0][0,1];`))).toMatchObject({ kind: `syntax`, expected: `integer-form` });
    });

    it('reads a hundred thousand nested variations without running out of stack', () => {
        const depth = 100_000;
        const text = `version[2];1.[1,0][0,1]${`(1.[1,0][0,1]`.repeat(depth)}${`;)`.repeat(depth)};`;
        const read = v2(text);
        let line = read.line;
        let nested = 0;
        for (let inner = line[0].variations[0]; inner !== undefined; inner = line[0].variations[0]) {
            line = inner;
            nested += 1;
        }
        expect(nested).toBe(depth);
    });
});

describe('readHtttx on v1', () => {
    it('reads text with no version, or version 1, as v1, its tags but the version kept', () => {
        expect(document(`1.[1,0][0,1];`)).toEqual({ version: 1, tags: [], turns: [[cell(1, 0), cell(0, 1)]] });
        expect(document(`name[A]version[1] ;\n1. [1,0][0,1];\n2. [5,0];`)).toEqual({ version: 1, tags: [{ key: `name`, value: `A` }], turns: [[cell(1, 0), cell(0, 1)], [cell(5, 0)]] });
    });

    it('reads as forgivingly as before: no last semicolon, leading zeros, -0, and whitespace between tokens', () => {
        expect(document(`version[1];\r\n1.  [ 001 , -0 ] [0,1] ;\r\n2. [2,0][3,0]`)).toEqual({ version: 1, tags: [], turns: [[cell(1, 0), cell(0, 1)], [cell(2, 0), cell(3, 0)]] });
    });

    it('refuses threat marks, naming the mark, where they stand', () => {
        expect(refusal(readHtttx(`version[1];\n1. [1,0][0,1];\n2. [2,0][3,0]!!;\n`))).toEqual({ kind: `threat-mark`, line: 3, column: 14, turn: 2 });
        expect(refusal(readHtttx(`1. [1,0][0,1] !;`))).toEqual({ kind: `threat-mark`, line: 1, column: 15, turn: 1 });
    });

    it('names line and column for a turn out of order and a turn of no or three cells', () => {
        expect(refusal(readHtttx(`version[1];\n1. [1,0][0,1];\n7. [2,0][3,0];\n`))).toEqual({ kind: `turn-number`, line: 3, column: 1, expected: 2, found: 7 });
        expect(refusal(readHtttx(`version[1];\n1. ;\n`))).toEqual({ kind: `coordinate-count`, line: 2, column: 1, turn: 1, count: 0 });
        expect(refusal(readHtttx(`version[1];\n1. [1,0][0,1][2,0];\n`))).toEqual({ kind: `coordinate-count`, line: 2, column: 1, turn: 1, count: 3 });
    });

    it('refuses empty text', () => {
        expect(refusal(readHtttx(` \n`))).toEqual({ kind: `empty` });
    });

    it('writes what it reads back to the same document', () => {
        const read = document(`name[A];1.[1,0][0,1];2.[5,0];`);
        expect(document(writeHtttx(read))).toEqual(read);
    });
});

describe('htttxLineOf', () => {
    it('puts each turn\'s info on its last stone, and a turn of one stone on the stone before the final move', () => {
        const info = { clockMs: 1_000, evaluation: null };
        expect(htttxLineOf([])).toBeNull();
        const line = htttxLineOf([
            { cells: [cell(1, 0), cell(0, 1)], info },
            { cells: [cell(5, 0)], info },
        ]);
        if (line === null) throw new Error(`no line`);
        expect(writeHtttx({ version: 2, tags: [], line })).toBe(`version[2];\n1. [1,0][0,1]{@1000};\n2. [5,0]{@1000}[/];\n`);
    });
});

describe('turnsOfStones', () => {
    it('leaves the origin out and pairs the stones after it, the last alone where the game ended on it', () => {
        const stones = [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 0, y: 1 },
            { x: 0, y: 2 },
            { x: 5, y: 0 },
        ];
        expect(turnsOfStones(stones)).toEqual([
            [stones[1], stones[2]],
            [stones[3], stones[4]],
            [stones[5]],
        ]);
        expect(turnsOfStones(stones.slice(0, 1))).toEqual([]);
    });
});
