import { useCallback, useEffect, useRef, useState } from 'react';
import { duelRunningPollMs, type BotListing, type DuelBotState, type DuelList, type DuelListQuery, type DuelQuota } from '@hexo-arena/contract';
import { fetchBots, fetchDuelBots, fetchDuels, limitedFor } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { noReservations, reservedBots } from '../play/reserved';

/** Runs `read` on the beat while the page is in view, and whenever it comes back into view; the caller reads first. */
export function useBeat(read: () => Promise<void>, ms: number): void {
    const latest = useRef(read);
    useEffect(() => {
        latest.current = read;
    });
    useEffect(() => {
        const timer = setInterval(() => {
            if (document.visibilityState === `visible`) void latest.current();
        }, ms);
        function onVisible() {
            if (document.visibilityState === `visible`) void latest.current();
        }
        document.addEventListener(`visibilitychange`, onVisible);
        return () => {
            clearInterval(timer);
            document.removeEventListener(`visibilitychange`, onVisible);
        };
    }, [ms]);
}

/** What a duel's setup reads beside the bot list: the running tournament's bots and each bot's duel state. */
export interface DuelStates {
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly DuelBotState[];
    readonly reload: () => void;
}

const noStates: readonly DuelBotState[] = [];

/** The tournament's hold and the bots' duel states, read on the bot lists' beat; a failed read leaves the last one standing. */
export function useDuelStates(): DuelStates {
    const [reserved, setReserved] = useState<ReadonlySet<string>>(noReservations);
    const [states, setStates] = useState<readonly DuelBotState[]>(noStates);
    const read = useCallback(async () => {
        const [held, found] = await Promise.all([reservedBots(), fetchDuelBots().catch(() => null)]);
        if (held !== null) setReserved(held.bots);
        if (found !== null) setStates(found);
    }, []);
    useEffect(() => {
        void read();
    }, [read]);
    useBeat(read, liveRefreshMs);
    return { reserved, states, reload: () => void read() };
}

/** What a duel's setup reads: the bots, and their duel states. */
export interface SetupReads {
    readonly bots: BotListing[] | null;
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly DuelBotState[];
    readonly failed: boolean;
    readonly limited: number | null;
    readonly reload: () => void;
}

/** The bot list a setup picks from, read again on the bot lists' beat, the duel states never holding it back. */
export function useSetupReads(): SetupReads {
    const [bots, setBots] = useState<BotListing[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [limited, setLimited] = useState<number | null>(null);
    const duelStates = useDuelStates();
    const read = useCallback(async () => {
        try {
            setBots(await fetchBots(false));
            setFailed(false);
        } catch (cause) {
            setFailed(true);
            setLimited(limitedFor(cause));
        }
    }, []);
    useEffect(() => {
        void read();
    }, [read]);
    useBeat(read, liveRefreshMs);
    return {
        bots,
        reserved: duelStates.reserved,
        states: duelStates.states,
        failed,
        limited,
        reload: () => {
            void read();
            duelStates.reload();
        },
    };
}

/** The reader's own duels and tests, read again on a running duel's beat; none while signed out. */
export interface MineRead {
    readonly list: DuelList | null;
    readonly failed: boolean;
}

/** The duels and tests the signed-in reader started or whose bots play them, with their quota. */
export function useMineDuels(signedIn: boolean): MineRead {
    const [list, setList] = useState<DuelList | null>(null);
    const [failed, setFailed] = useState(false);
    const read = useCallback(async () => {
        if (!signedIn) return;
        try {
            setList(await fetchDuels({ mine: `1` }));
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [signedIn]);
    useEffect(() => {
        void read();
    }, [read]);
    useBeat(read, duelRunningPollMs);
    return { list, failed };
}

/** Which duels a list shows: every one, the reader's, or tests alone. */
export type DuelFilter = `all` | `yours` | `tests`;

/** The lists a duels place reads: every duel for the live ones, the filter's for the recent ones, and the reader's quota. */
export interface ListReads {
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
    const [all, setAll] = useState<DuelList | null>(null);
    const [recent, setRecent] = useState<DuelList | null>(null);
    const [quota, setQuota] = useState<DuelQuota | null>(null);
    const [failed, setFailed] = useState(false);
    const read = useCallback(async () => {
        const base: DuelListQuery = bot === null ? {} : { bot };
        try {
            const [every, mine] = await Promise.all([fetchDuels(base), signedIn ? fetchDuels({ ...base, mine: `1` }) : Promise.resolve(null)]);
            setAll(every);
            setQuota(mine?.quota ?? null);
            setRecent(filter === `all` ? every : filter === `yours` ? mine : await fetchDuels({ ...base, kind: `test` }));
            setFailed(false);
        } catch {
            setFailed(true);
        }
    }, [filter, bot, signedIn]);
    useEffect(() => {
        void read();
    }, [read]);
    useBeat(read, duelRunningPollMs);
    return { all, recent, quota, failed, reload: () => void read() };
}
