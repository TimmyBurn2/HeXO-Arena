import { describe, expect, it } from 'vitest';
import { WindowMemo } from '../src/window-memo';

function countingMemo(options: { windowMs: number; cap?: number }) {
    let now = 1_000_000;
    const memo = new WindowMemo<string>({ ...options, now: () => now });
    const builds: string[] = [];
    const read = (key: string) =>
        memo.read(key, () => {
            builds.push(key);
            return `${key}@${String(now)}`;
        });
    return {
        memo,
        builds,
        read,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe('the window memo', () => {
    it('builds a key once within its window and again once the window has passed', () => {
        const { builds, read, advance } = countingMemo({ windowMs: 1_000 });
        expect(read(`a`)).toBe(`a@1000000`);
        advance(999);
        expect(read(`a`)).toBe(`a@1000000`);
        advance(1);
        expect(read(`a`)).toBe(`a@1001000`);
        expect(builds).toEqual([`a`, `a`]);
    });

    it('starts a new window when the clock steps back', () => {
        const { builds, read, advance } = countingMemo({ windowMs: 1_000 });
        read(`a`);
        advance(-1);
        read(`a`);
        expect(builds).toEqual([`a`, `a`]);
    });

    it('answers a null without remembering it', () => {
        let now = 0;
        const memo = new WindowMemo<string>({ windowMs: 1_000, now: () => now });
        let builds = 0;
        const read = () =>
            memo.read(`missing`, () => {
                builds += 1;
                return null;
            });
        expect(read()).toBeNull();
        now += 1;
        expect(read()).toBeNull();
        expect(builds).toBe(2);
    });

    it('lets the oldest key go first past its cap', () => {
        const { builds, read, advance } = countingMemo({ windowMs: 1_000, cap: 2 });
        read(`a`);
        advance(1);
        read(`b`);
        advance(1);
        read(`c`);
        read(`b`);
        read(`a`);
        expect(builds).toEqual([`a`, `b`, `c`, `a`]);
    });

    it('forgets one key, the keys a test picks, or every key', () => {
        const { memo, builds, read } = countingMemo({ windowMs: 1_000 });
        for (const key of [`a`, `list:1`, `list:2`]) read(key);
        memo.delete(`a`);
        memo.forget((key) => key.startsWith(`list:`));
        for (const key of [`a`, `list:1`, `list:2`]) read(key);
        memo.clear();
        read(`a`);
        expect(builds).toEqual([`a`, `list:1`, `list:2`, `a`, `list:1`, `list:2`, `a`]);
    });
});
