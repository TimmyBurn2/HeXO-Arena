import { describe, expect, it } from 'vitest';
import { Ladder, ladderMemoMs, type LadderFilter } from '../src/ladder';
import type { RankedPlayer } from '../src/rating-store';

function countingLadder(start: number) {
    const reads: LadderFilter[] = [];
    let now = start;
    const ladder = new Ladder({
        rank: (filter) => {
            reads.push(filter);
            const player: RankedPlayer = { name: `ann`, kind: `human`, rating: 1500 + reads.length, games: 1, lastPlayedAt: 0, botId: null, ownerName: null };
            return [player];
        },
        now: () => now,
    });
    return {
        ladder,
        reads,
        advance: (ms: number) => {
            now += ms;
        },
    };
}

describe('the ladder memo', () => {
    it('runs the query once for fifty reads inside the window', () => {
        const { ladder, reads, advance } = countingLadder(1_000_000);
        for (let read = 0; read < 50; read += 1) {
            ladder.read(`all`, 1_000);
            advance(100);
        }
        expect(reads).toHaveLength(1);
    });

    it('runs the query again once the window has passed', () => {
        const { ladder, reads, advance } = countingLadder(1_000_000);
        ladder.read(`all`, null);
        advance(ladderMemoMs);
        expect(ladder.read(`all`, null)[0]?.rating).toBe(1502);
        expect(reads).toHaveLength(2);
    });

    it('shares one read between cutoffs in the same minute, and reads it floored', () => {
        const { ladder, reads } = countingLadder(1_000_000);
        ladder.read(`bots`, 6_000);
        ladder.read(`bots`, 6_059);
        ladder.read(`bots`, 6_060);
        expect(reads).toEqual([
            { kind: `bots`, activeSince: 6_000 },
            { kind: `bots`, activeSince: 6_060 },
        ]);
    });

    it('keeps each kind and the whole history apart', () => {
        const { ladder, reads } = countingLadder(1_000_000);
        ladder.read(`all`, 6_000);
        ladder.read(`humans`, 6_000);
        ladder.read(`all`, null);
        ladder.read(`all`, 6_000);
        expect(reads).toHaveLength(3);
    });

    it('reads afresh after a clear', () => {
        const { ladder, reads } = countingLadder(1_000_000);
        ladder.read(`all`, null);
        ladder.clear();
        expect(ladder.read(`all`, null)[0]?.rating).toBe(1502);
        expect(reads).toHaveLength(2);
    });
});
