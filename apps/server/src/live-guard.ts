import { liveGuardAheadTurns, liveGuardMinStones, liveGuardPositions } from '@hexo-arena/contract';
import { containmentProbe, containmentTarget, targetContains, type ContainmentProbe, type Stone } from '@hexo-arena/rules';

// A requested position runs on from a live one by at most this many stones.
const aheadStones = 2 * liveGuardAheadTurns;

/**
 * The positions no analyzer may read: each live game's latest few, held
 * prepared so a request is cleared against every live game at once.
 * A request is refused when, under some turn, mirror, color swap, and
 * shift, it holds every stone of one of them and at most the stones of the
 * turns ahead besides.
 */
export class LiveGuard {
    // Each game's positions, newest first; each holds the ones after it,
    // since a game only adds stones.
    readonly #games = new Map<string, ContainmentProbe[]>();

    /** A game's position after its latest turn; the ones before it shift back. */
    update(gameId: string, stones: readonly Stone[]): void {
        const earlier = this.#games.get(gameId) ?? [];
        if (stones.length < liveGuardMinStones) return;
        this.#games.set(gameId, [containmentProbe(stones), ...earlier].slice(0, liveGuardPositions));
    }

    /** Forgets a game, as it finishes. */
    remove(gameId: string): void {
        this.#games.delete(gameId);
    }

    /** Whether the stones are, or run on from, a live game's guarded position. */
    holds(stones: readonly Stone[]): boolean {
        const size = stones.length;
        const target = containmentTarget(stones);
        for (const probes of this.#games.values()) {
            const near = probes.filter((probe) => probe.size <= size && size - probe.size <= aheadStones);
            if (near.length === 0) continue;
            // The oldest position lies inside every later one, so a request
            // that misses it misses them all.
            const oldest = probes.at(-1);
            if (oldest !== undefined && !targetContains(target, oldest)) continue;
            if (near.some((probe) => targetContains(target, probe))) return true;
        }
        return false;
    }
}
