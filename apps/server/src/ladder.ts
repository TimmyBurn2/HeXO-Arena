import type { LeaderboardQuery } from '@hexo-arena/contract';
import type { RankedPlayer } from './rating-store';
import { WindowMemo } from './window-memo';

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
    readonly #memo: WindowMemo<readonly RankedPlayer[]>;

    constructor(deps: { rank: (filter: LadderFilter) => readonly RankedPlayer[]; now: () => number }) {
        this.#rank = deps.rank;
        this.#memo = new WindowMemo({ windowMs: ladderMemoMs, now: deps.now });
    }

    read(kind: LadderFilter[`kind`], activeSince: number | null): readonly RankedPlayer[] {
        const since = activeSince === null ? null : Math.floor(activeSince / 60) * 60;
        return this.#memo.read(`${kind} ${String(since)}`, () => this.#rank({ kind, activeSince: since }));
    }

    /** Forgets every read, so a changed rating shows on the next. */
    clear(): void {
        this.#memo.clear();
    }
}
