import { useCallback, useSyncExternalStore } from 'react';
import type { BotListing, Me } from '@hexo-arena/contract';
import { fetchDuels } from '../api/client';
import { useAsync } from '../api/use-async';
import { NewDuel } from '../duels/NewDuel';
import { emptySetup, pickReason } from '../duels/setup';
import { useDuelStates } from '../duels/use-duels';
import { siteStatusStore } from '../site-status';

/**
 * Home's bot duel: two slots that open the same bot list as Bot duels, and
 * Start, which plays a duel or a test with the defaults; with fewer than
 * two bots ready, nothing.
 */
export function HomeDuel({ bots, me }: { bots: readonly BotListing[] | null; me: Me | undefined }) {
    const duelStates = useDuelStates();
    // Tests stay off Home, so its count of live duels leaves them out.
    const load = useCallback(async () => fetchDuels({ kind: `duel` }), []);
    const live = useAsync(load).data?.running.length ?? null;
    const paused = useSyncExternalStore(siteStatusStore.subscribe, siteStatusStore.read, siteStatusStore.read) === `paused`;
    const viewer = me?.kind === `user` ? me.name : null;
    const reads = { reserved: duelStates.reserved, states: duelStates.states, viewer };
    if (bots === null || me === undefined) return null;
    if (bots.filter((bot) => pickReason(bot, null, reads) === null).length < 2) return null;
    return <NewDuel compact bots={bots} reads={reads} me={me} quota={null} paused={paused} initial={emptySetup} liveCount={live} onRefused={duelStates.reload} />;
}
