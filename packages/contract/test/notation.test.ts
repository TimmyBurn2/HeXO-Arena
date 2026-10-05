import { describe, expect, it } from 'vitest';
import { htttxCell, turnsOfStones, writeHtttx, type HtttxHeader } from '../src/notation';

// Engine cells along one row; x = q + r and y = -r, so (3,0) is [3,0] and (1,-1) is [0,1].
const turns = [
    [
        { x: 3, y: 0 },
        { x: 1, y: -1 },
    ],
    [{ x: -1, y: 0 }],
];

describe('writeHtttx', () => {
    it('writes the bare version and one numbered turn a line, as the analysis board always has', () => {
        expect(writeHtttx([])).toBe(`version[1];\n`);
        expect(writeHtttx(turns)).toBe(`version[1];\n1. [3,0][0,1];\n2. [-1,0];\n`);
    });

    it('writes every v1 key in one metadata segment after the version, in the order v1 lists them', () => {
        const header: HtttxHeader = {
            name: `Duel, game 3 of 10`,
            platform: `HeXO Arena`,
            startedAt: new Date(`2026-10-04T09:05:07.250Z`),
            cross: `devbot-b`,
            circle: `devbot-c`,
            timeControl: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 },
            result: { winner: `o`, reason: `six-in-a-row` },
        };
        expect(writeHtttx(turns, header).split(`\n`)[0]).toBe(
            `version[1]name[Duel, game 3 of 10]platform[HeXO Arena]utcdatetime[2026-10-04 09:05:07]playercross[devbot-b]playercircle[devbot-c]timecontrol[300+3]endreason[win]winner[circle];`,
        );
    });

    it('writes a clock for a match clock in whole seconds alone, which is all v1 can say', () => {
        const clock = (timeControl: NonNullable<HtttxHeader[`timeControl`]>) => writeHtttx([], { timeControl });
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
    ] as const)('writes a game %s won by %s with only the ending and winner v1 defines: %s', (winner, reason, written) => {
        expect(writeHtttx([], { result: { winner, reason } })).toBe(`version[1]${written};\n`);
    });

    it('keeps brackets, semicolons, and line breaks out of every value, and leaves out a value with nothing left', () => {
        const header: HtttxHeader = { name: `Cup [final];\r\n  round\t2`, platform: ` \n `, cross: `a]b`, circle: `c[d` };
        expect(writeHtttx([], header)).toBe(`version[1]name[Cup (final), round 2]playercross[a)b]playercircle[c(d];\n`);
    });

    it('writes a cell in the wire coordinates', () => {
        expect(htttxCell({ x: 0, y: 0 })).toBe(`[0,0]`);
        expect(htttxCell({ x: 2, y: -1 })).toBe(`[1,1]`);
        expect(htttxCell({ x: -2, y: 3 })).toBe(`[1,-3]`);
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
