import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '../src/zip';
import { readZip } from './zip-reader';

describe('crc32', () => {
    it('matches the check value every CRC-32 implementation agrees on, and the empty input', () => {
        expect(crc32(new TextEncoder().encode(`123456789`))).toBe(0xcbf43926);
        expect(crc32(new Uint8Array())).toBe(0);
    });
});

describe('zipStore', () => {
    const modified = new Date(`2026-10-04T09:05:07Z`);

    it('stores each file uncompressed behind a local header, listed in a central directory the end record points at', () => {
        const zip = zipStore([
            { name: `01-alpha-vs-beta.htttx`, data: `version[1];\n1. [1,0][0,1];\n`, modified },
            { name: `games.csv`, data: `number,pair\r\n1,1\r\n`, modified },
            { name: `bytes.bin`, data: new Uint8Array([0, 1, 2, 255]), modified },
        ]);
        const entries = readZip(zip);
        expect(entries.map((entry) => [entry.name, entry.method])).toEqual([
            [`01-alpha-vs-beta.htttx`, 0],
            [`games.csv`, 0],
            [`bytes.bin`, 0],
        ]);
        expect(entries[0]?.text).toBe(`version[1];\n1. [1,0][0,1];\n`);
        expect(entries[1]?.text).toBe(`number,pair\r\n1,1\r\n`);
        expect([...(entries[2]?.data ?? [])]).toEqual([0, 1, 2, 255]);
        expect(zip.subarray(0, 4).toString(`hex`)).toBe(`504b0304`);
    });

    it('writes the time in MS-DOS form in UTC, to the even second', () => {
        const [entry] = readZip(zipStore([{ name: `a.txt`, data: `a`, modified }]));
        expect(entry?.dosTime).toBe((9 << 11) | (5 << 5) | 3);
        expect(entry?.dosDate).toBe(((2026 - 1980) << 9) | (10 << 5) | 4);
    });

    it('writes an archive of no files as the end record alone', () => {
        const zip = zipStore([]);
        expect(zip).toHaveLength(22);
        expect(readZip(zip)).toEqual([]);
    });

    it('takes only printable ASCII names that do not start at the root', () => {
        expect(() => zipStore([{ name: `caf${String.fromCharCode(0xe9)}.txt`, data: ``, modified }])).toThrow();
        expect(() => zipStore([{ name: `/etc/passwd`, data: ``, modified }])).toThrow();
        expect(() => zipStore([{ name: `line\nbreak`, data: ``, modified }])).toThrow();
    });
});
