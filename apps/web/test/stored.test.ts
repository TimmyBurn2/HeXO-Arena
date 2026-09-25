// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readStored, writeStored } from '../src/stored';

afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
});

describe('stored preferences', () => {
    it('round-trip a value', () => {
        writeStored(`k`, `v`);
        expect(readStored(`k`)).toBe(`v`);
    });

    it('read nothing and write nothing when storage refuses', () => {
        vi.spyOn(Storage.prototype, `getItem`).mockImplementation(() => {
            throw new Error(`blocked`);
        });
        vi.spyOn(Storage.prototype, `setItem`).mockImplementation(() => {
            throw new Error(`blocked`);
        });
        expect(readStored(`k`)).toBe(null);
        expect(() => {
            writeStored(`k`, `v`);
        }).not.toThrow();
    });
});
