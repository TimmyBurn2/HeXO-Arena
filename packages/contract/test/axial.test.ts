import { describe, expect, it } from 'vitest';
import {
    internalToWire,
    playerOf,
    sideOf,
    wireToInternal,
} from '../src/axial';

// A tiny deterministic LCG: property samples must be reproducible without
// taking a dependency for one test file.
function lcg(seed: number): () => number {
    let state = seed;
    return () => {
        state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
        return state / 4_294_967_296;
    };
}

function internalDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return (Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy)) / 2;
}

function wireDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const bound = 64;

describe('axial conversion', () => {
    it('round-trips every wire coordinate in a two-bound square', () => {
        for (let q = -bound; q <= bound; q += 1) {
            for (let r = -bound; r <= bound; r += 1) {
                const wire = { q, r };
                expect(internalToWire(wireToInternal(wire))).toEqual(wire);
            }
        }
    });

    it('round-trips every engine coordinate in a two-bound square', () => {
        for (let x = -bound; x <= bound; x += 1) {
            for (let y = -bound; y <= bound; y += 1) {
                const internal = { x, y };
                expect(wireToInternal(internalToWire(internal))).toEqual(internal);
            }
        }
    });

    it('round-trips far random coordinates beyond any board ever reached', () => {
        const next = lcg(42);
        for (let i = 0; i < 1_000; i += 1) {
            const q = Math.floor((next() - 0.5) * 2_000_001);
            const r = Math.floor((next() - 0.5) * 2_000_001);
            const wire = { q, r };
            expect(internalToWire(wireToInternal(wire))).toEqual(wire);
        }
    });

    it('preserves hex distance, so legality and win lines survive the wire', () => {
        const next = lcg(7);
        for (let i = 0; i < 1_000; i += 1) {
            const first = { q: Math.floor(next() * 100) - 50, r: Math.floor(next() * 100) - 50 };
            const second = { q: Math.floor(next() * 100) - 50, r: Math.floor(next() * 100) - 50 };
            expect(internalDistance(wireToInternal(first), wireToInternal(second))).toBe(
                wireDistance(first, second),
            );
        }
    });

    it('maps the origin to the origin and each side to its player', () => {
        expect(wireToInternal({ q: 0, r: 0 })).toEqual({ x: 0, y: 0 });
        expect(internalToWire({ x: 0, y: 0 })).toEqual({ q: 0, r: 0 });
        expect(sideOf(0)).toBe(`x`);
        expect(sideOf(1)).toBe(`o`);
        expect(playerOf(`x`)).toBe(0);
        expect(playerOf(`o`)).toBe(1);
    });
});
