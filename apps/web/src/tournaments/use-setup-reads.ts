import type { BotListing, TournamentBotState } from '@hexo-arena/contract';
import { fetchBots, fetchTournamentBots } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { useAsync } from '../api/use-async';
import { useReserved } from '../play/reserved';

// What a duel's or round robin's setup reads beside the bot list: the running weekly's bots and each bot's state.
interface BotStates {
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly TournamentBotState[];
    readonly reload: () => void;
}

const noStates: readonly TournamentBotState[] = [];

/** The weekly's hold and the bots' tournament states, read on the bot lists' beat; a failed read leaves the last one standing. */
export function useBotStates(): BotStates {
    const reserved = useReserved();
    const states = useAsync(fetchTournamentBots, { every: liveRefreshMs });
    return {
        reserved: reserved.bots,
        states: states.data ?? noStates,
        reload: () => {
            reserved.reload();
            states.reload();
        },
    };
}

// What a setup reads: the bots, and their tournament states.
interface SetupReads {
    readonly bots: BotListing[] | null;
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly TournamentBotState[];
    readonly failed: boolean;
    readonly limited: number | null;
    readonly reload: () => void;
}

const loadBots = async () => fetchBots(false);

/** The bot list a setup picks from, read again on the bot lists' beat, the bots' states never holding it back. */
export function useSetupReads(): SetupReads {
    const bots = useAsync(loadBots, { every: liveRefreshMs });
    const botStates = useBotStates();
    return {
        bots: bots.data,
        reserved: botStates.reserved,
        states: botStates.states,
        failed: bots.error,
        limited: bots.limited,
        reload: () => {
            bots.reload();
            botStates.reload();
        },
    };
}
