import { describe, expect, it } from 'vitest';
import { createQuery } from '../src/db';
import { beginGeneration, isCurrentGeneration, retireGeneration } from '../src/site-state';
import { migratedDatabase } from './helpers';

function freshQuery() {
    const sqlite = migratedDatabase();
    return createQuery(sqlite);
}

describe('server generation', () => {
    it('claims a fresh generation on every boot', () => {
        const query = freshQuery();
        const first = beginGeneration(query);
        const second = beginGeneration(query);
        expect(second).toBeGreaterThan(first);
        expect(isCurrentGeneration(query, first)).toBe(false);
        expect(isCurrentGeneration(query, second)).toBe(true);
    });

    it('stops being current once retired, and the next boot claims past it', () => {
        const query = freshQuery();
        const generation = beginGeneration(query);
        retireGeneration(query, generation);
        expect(isCurrentGeneration(query, generation)).toBe(false);
        expect(beginGeneration(query)).toBeGreaterThan(generation + 1);
    });

    it('leaves a newer generation alone when an older process retires late', () => {
        const query = freshQuery();
        const older = beginGeneration(query);
        const newer = beginGeneration(query);
        retireGeneration(query, older);
        expect(isCurrentGeneration(query, newer)).toBe(true);
    });
});
