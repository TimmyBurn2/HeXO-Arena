import { describe, expect, it } from 'vitest';
import { turnClocks } from '../src/turn-clocks';

const start = 1_000;

describe('turnClocks', () => {
    it('takes each turn of a match clock from its mover\'s budget and adds the increment after it', () => {
        const clock = { mode: `match` as const, mainTimeMs: 60_000, incrementMs: 2_000 };
        const turns = [
            { side: `o` as const, at: start + 5 },
            { side: `x` as const, at: start + 15 },
            { side: `o` as const, at: start + 16 },
        ];
        expect(turnClocks(clock, start, turns)).toEqual([57_000, 52_000, 58_000]);
    });

    it('holds a spent match budget at the increment alone', () => {
        const clock = { mode: `match` as const, mainTimeMs: 60_000, incrementMs: 3_000 };
        expect(turnClocks(clock, start, [{ side: `x`, at: start + 90 }])).toEqual([3_000]);
    });

    it('gives a turn clock what each turn left of its own time, never below 0', () => {
        const clock = { mode: `turn` as const, turnTimeMs: 10_000 };
        const turns = [
            { side: `o` as const, at: start + 4 },
            { side: `x` as const, at: start + 4 },
            { side: `o` as const, at: start + 20 },
        ];
        expect(turnClocks(clock, start, turns)).toEqual([6_000, 10_000, 0]);
    });

    it('counts a turn stored before the one it follows as taking no time', () => {
        const clock = { mode: `turn` as const, turnTimeMs: 10_000 };
        expect(turnClocks(clock, start, [{ side: `o`, at: start - 3 }])).toEqual([10_000]);
    });

    it('gives an unlimited clock none', () => {
        expect(turnClocks({ mode: `unlimited` }, start, [{ side: `o`, at: start + 1 }])).toBeNull();
    });
});
