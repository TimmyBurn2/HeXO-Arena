import { useCallback } from 'react';
import { duelRunningPollMs, type BotListing, type DuelBotState, type DuelList, type DuelListQuery, type DuelQuota } from '@hexo-arena/contract';
import { fetchBots, fetchDuelBots, fetchDuels } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { useAsync } from '../api/use-async';
import { useReserved } from '../play/reserved';

// What a duel's setup reads beside the bot list: the running tournament's bots and each bot's duel state.
interface DuelStates {
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly DuelBotState[];
    readonly reload: () => void;
}

const noStates: readonly DuelBotState[] = [];

/** The tournament's hold and the bots' duel states, read on the bot lists' beat; a failed read leaves the last one standing. */
export function useDuelStates(): DuelStates {
    const reserved = useReserved();
    const states = useAsync(fetchDuelBots, { every: liveRefreshMs });
    return {
        reserved: reserved.bots,
        states: states.data ?? noStates,
        reload: () => {
            reserved.reload();
            states.reload();
        },
    };
}

// What a duel's setup reads: the bots, and their duel states.
interface SetupReads {
    readonly bots: BotListing[] | null;
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly DuelBotState[];
    readonly failed: boolean;
    readonly limited: number | null;
    readonly reload: () => void;
}

const loadBots = async () => fetchBots(false);

/** The bot list a setup picks from, read again on the bot lists' beat, the duel states never holding it back. */
export function useSetupReads(): SetupReads {
    const bots = useAsync(loadBots, { every: liveRefreshMs });
    const duelStates = useDuelStates();
    return {
        bots: bots.data,
        reserved: duelStates.reserved,
        states: duelStates.states,
        failed: bots.error,
        limited: bots.limited,
        reload: () => {
            bots.reload();
            duelStates.reload();
        },
    };
}

/** The reader's own duels and tests, read again on a running duel's beat; none while signed out. */
export interface MineRead {
    readonly list: DuelList | null;
    readonly failed: boolean;
}

const loadMine = async () => fetchDuels({ mine: `1` });

/** The duels and tests the signed-in reader started or whose bots play them, with their quota. */
export function useMineDuels(signedIn: boolean): MineRead {
    const read = useAsync(loadMine, { enabled: signedIn, every: duelRunningPollMs });
    return { list: read.data, failed: read.error };
}

/** Which duels a list shows: every one, the reader's, or tests alone. */
export type DuelFilter = `all` | `yours` | `tests`;

// The lists a duels place reads: every duel for the live ones, the filter's for the recent ones, and the reader's quota.
interface ListReads {
    readonly all: DuelList | null;
    readonly recent: DuelList | null;
    readonly quota: DuelQuota | null;
    readonly failed: boolean;
    readonly reload: () => void;
}

/**
 * The duels a place lists, for one bot when named, read again on a running
 * duel's beat while the page is in view.
 */
export function useDuelLists(filter: DuelFilter, bot: string | null, signedIn: boolean): ListReads {
    const load = useCallback(async () => {
        const base: DuelListQuery = bot === null ? {} : { bot };
        const [all, mine] = await Promise.all([fetchDuels(base), signedIn ? fetchDuels({ ...base, mine: `1` }) : Promise.resolve(null)]);
        const recent = filter === `all` ? all : filter === `yours` ? mine : await fetchDuels({ ...base, kind: `test` });
        return { all, recent, quota: mine?.quota ?? null };
    }, [filter, bot, signedIn]);
    const read = useAsync(load, { every: duelRunningPollMs });
    return { all: read.data?.all ?? null, recent: read.data?.recent ?? null, quota: read.data?.quota ?? null, failed: read.error, reload: read.reload };
}
