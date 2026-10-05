import { fetchTournament, fetchTournaments } from '../api/client';
import { liveRefreshMs } from '../api/refresh';
import { useAsync } from '../api/use-async';
import type { Holder } from './setup';

/** No bot held by a tournament. */
export const noReservations: ReadonlySet<string> = new Set();

/** The bots the operator's running tournament holds, and that tournament. */
export interface Reservations {
    readonly bots: ReadonlySet<string>;
    readonly tournament: Holder | null;
}

/** The bots the operator's running tournament holds, and the tournament. */
export async function reservedBots(): Promise<Reservations> {
    const running = (await fetchTournaments()).running.find((tournament) => tournament.origin === `operator`);
    if (running === undefined) return { bots: noReservations, tournament: null };
    const detail = await fetchTournament(running.id);
    return {
        bots: new Set(detail.entries.filter((entry) => entry.state === `playing`).map((entry) => entry.bot)),
        tournament: { id: running.id, name: running.name },
    };
}

/**
 * The running tournament's hold, read on the bot lists' beat; a failed read
 * leaves the last set standing, since a bot list stands without it.
 */
export function useReserved(): Reservations & { readonly reload: () => void } {
    const read = useAsync(reservedBots, { every: liveRefreshMs });
    return { bots: read.data?.bots ?? noReservations, tournament: read.data?.tournament ?? null, reload: read.reload };
}
