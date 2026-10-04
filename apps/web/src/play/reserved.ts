import { fetchTournament, fetchTournaments } from '../api/client';
import type { Holder } from './setup';

/** No bot held by a tournament. */
export const noReservations: ReadonlySet<string> = new Set();

/**
 * The bots the operator's running tournament holds, and the tournament; null when
 * the read failed, which leaves the last set standing, since a bot list
 * stands without it.
 */
export async function reservedBots(): Promise<{ bots: ReadonlySet<string>; tournament: Holder | null } | null> {
    try {
        const running = (await fetchTournaments()).running.find((tournament) => tournament.origin === `operator`);
        if (running === undefined) return { bots: noReservations, tournament: null };
        const detail = await fetchTournament(running.id);
        return {
            bots: new Set(detail.entries.filter((entry) => entry.state === `playing`).map((entry) => entry.bot)),
            tournament: { id: running.id, name: running.name },
        };
    } catch {
        return null;
    }
}
