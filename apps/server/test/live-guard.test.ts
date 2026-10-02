import { liveGuardAheadTurns, liveGuardMinStones } from '@hexo-arena/contract';
import type { Player, Stone } from '@hexo-arena/rules';
import { describe, expect, it } from 'vitest';
import { LiveGuard } from '../src/live-guard';

// A small seeded generator, so every run builds the same boards.
function rng(seed: number): (bound: number) => number {
    let state = seed >>> 0;
    return (bound) => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
        return Math.floor((state / 2 ** 32) * bound);
    };
}

// Stones in play order, each next to an earlier one, x owning the origin
// and the sides taking two stones a turn.
function playedStones(count: number, seed: number): Stone[] {
    const next = rng(seed);
    const stones: Stone[] = [{ x: 0, y: 0, player: 0 }];
    const taken = new Set([`0,0`]);
    while (stones.length < count) {
        const near = stones[next(stones.length)] ?? { x: 0, y: 0 };
        const x = near.x + next(5) - 2;
        const y = near.y + next(5) - 2;
        if (taken.has(`${String(x)},${String(y)}`)) continue;
        taken.add(`${String(x)},${String(y)}`);
        const ply = stones.length;
        stones.push({ x, y, player: Math.ceil(ply / 2) % 2 === 1 ? 1 : 0 });
    }
    return stones;
}

// A sixth of a turn, a mirror, a color swap, and a shift, all at once.
function disguised(stones: readonly Stone[]): Stone[] {
    return stones.map(({ x, y, player }) => {
        const [turnedX, turnedY] = [x + y, -x];
        return { x: turnedY + 40, y: turnedX - 17, player: (1 - player) as Player };
    });
}

function liveAfter(guard: LiveGuard, gameId: string, stones: readonly Stone[], turns: number): void {
    for (let turn = turns; turn >= 0; turn -= 1) guard.update(gameId, stones.slice(0, stones.length - 2 * turn));
}

describe('LiveGuard', () => {
    const game = playedStones(61, 7);

    it('holds a live position, the two before it, and any up to the turns ahead, however disguised', () => {
        const guard = new LiveGuard();
        liveAfter(guard, `g1`, game, 2);
        const ahead = playedStones(61 + 2 * liveGuardAheadTurns, 7);
        for (const stones of [game, game.slice(0, -2), game.slice(0, -4), ahead, disguised(game), disguised(ahead.slice(0, -6))]) {
            expect(guard.holds(stones), String(stones.length)).toBe(true);
        }
    });

    it('lets through a position past the turns ahead, before the guarded ones, or unrelated', () => {
        const guard = new LiveGuard();
        liveAfter(guard, `g1`, game, 2);
        expect(guard.holds(playedStones(61 + 2 * liveGuardAheadTurns + 2, 7))).toBe(false);
        expect(guard.holds(game.slice(0, -6))).toBe(false);
        expect(guard.holds(playedStones(61, 8))).toBe(false);
    });

    it('guards no position too small to tell a game apart', () => {
        const guard = new LiveGuard();
        const opening = playedStones(liveGuardMinStones - 2, 3);
        guard.update(`g1`, opening);
        expect(guard.holds(opening)).toBe(false);
        guard.update(`g1`, playedStones(liveGuardMinStones, 3));
        expect(guard.holds(playedStones(liveGuardMinStones + 4, 3))).toBe(true);
    });

    it('keeps only the latest positions of each game and forgets a finished one', () => {
        const guard = new LiveGuard();
        liveAfter(guard, `g1`, game, 5);
        expect(guard.holds(game.slice(0, -6))).toBe(false);
        expect(guard.holds(game)).toBe(true);
        guard.remove(`g1`);
        expect(guard.holds(game)).toBe(false);
    });

    it('clears a 401-stone request against 200 live games of about as many stones in a few milliseconds', () => {
        const guard = new LiveGuard();
        for (let index = 0; index < 200; index += 1) liveAfter(guard, `g${String(index)}`, playedStones(395 + (index % 6), 100 + index), 2);
        const request = playedStones(401, 99);
        const times: number[] = [];
        for (let run = 0; run < 25; run += 1) {
            const started = performance.now();
            expect(guard.holds(request)).toBe(false);
            times.push(performance.now() - started);
        }
        times.sort((a, b) => a - b);
        const median = times[Math.floor(times.length / 2)] ?? Number.POSITIVE_INFINITY;
        // The target is 5 ms; the bound leaves room for a loaded machine.
        expect(median).toBeLessThan(25);
    });
});
