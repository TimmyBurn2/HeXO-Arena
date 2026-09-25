import { describe, expect, it } from 'vitest';
import type { Accepts } from '@hexarena/contract';
import { summarizeAccepts } from '../src/components/player';

const accepts = (overrides: Partial<Accepts>): Accepts => ({
    turnMs: [5000, 60000],
    match: true,
    unlimited: true,
    ...overrides,
});

describe('summarizeAccepts', () => {
    it('compress the declaration into one line', () => {
        expect(summarizeAccepts(accepts({}))).toBe(`turn 5-60s, match, unlimited`);
    });

    it('show only what is declared', () => {
        expect(summarizeAccepts(accepts({ turnMs: null, match: false }))).toBe(`unlimited`);
        expect(summarizeAccepts(accepts({ turnMs: [10000, 30000], unlimited: false }))).toBe(
            `turn 10-30s, match`,
        );
    });

    it('say nothing when nothing is declared', () => {
        expect(summarizeAccepts(accepts({ turnMs: null, match: false, unlimited: false }))).toBe(``);
        expect(summarizeAccepts(undefined)).toBe(``);
    });
});
