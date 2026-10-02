import type { LeaderboardQuery } from '@hexo-arena/contract';
import type { RankedPlayer } from './rating-store';

/** One ladder read, as the rating store answers it. */
export interface LadderFilter {
    readonly kind: LeaderboardQuery[`kind`];
    readonly activeSince: number | null;
}

/** How long one read of the ladder serves every caller. */
export const ladderMemoMs = 10_000;

/**
 * The rankable players, read at most once in {@link ladderMemoMs} per kind
 * and activity cutoff whoever asks: the leaderboard, the shells' roster,
 * and every player record's rank share the one read.
 * The cutoff is floored to the minute, so callers a second apart share it;
 * a player whose last game finished within that minute of the cutoff stays listed.
 */
export class Ladder {
    readonly #rank: (filter: LadderFilter) => readonly RankedPlayer[];
    readonly #now: () => number;
    readonly #memo = new Map<string, { at: number; players: readonly RankedPlayer[] }>();

    constructor(deps: { rank: (filter: LadderFilter) => readonly RankedPlayer[]; now: () => number }) {
        this.#rank = deps.rank;
        this.#now = deps.now;
    }

    read(kind: LadderFilter[`kind`], activeSince: number | null): readonly RankedPlayer[] {
        const since = activeSince === null ? null : Math.floor(activeSince / 60) * 60;
        const key = `${kind} ${String(since)}`;
        const at = this.#now();
        const held = this.#memo.get(key);
        // A clock that stepped back reads afresh rather than trusting a future entry.
        if (held !== undefined && at >= held.at && at - held.at < ladderMemoMs) return held.players;
        const players = this.#rank({ kind, activeSince: since });
        this.#memo.set(key, { at, players });
        for (const [stale, entry] of this.#memo) if (at - entry.at >= ladderMemoMs) this.#memo.delete(stale);
        return players;
    }

    /** Forgets every read, so a changed rating shows on the next. */
    clear(): void {
        this.#memo.clear();
    }
}
