import { useCallback } from 'react';
import { nameKeyOf, type FinishedGameEntry, type GamePlayer, type GamePlayers, type PlayerRecord, type Side } from '@hexo-arena/contract';
import { fetchFinishedGames, fetchPlayerRecord } from '../api/client';
import { useAsync } from '../api/use-async';

/** One result as a player's form shows it. */
export type FormResult = `won` | `lost` | `none`;

// The results a player's form shows at most.
const formLength = 5;

/**
 * A player's latest results from their own seat, newest first; voided and
 * aborted games count in no record, so they are left out here too.
 */
export function formOf(games: readonly FinishedGameEntry[], name: string): FormResult[] {
    const key = nameKeyOf(name);
    const results: FormResult[] = [];
    for (const game of games) {
        if (results.length === formLength) break;
        if (game.voided || game.reason === `aborted`) continue;
        const side: Side | null = nameKeyOf(game.players.x.name) === key ? `x` : nameKeyOf(game.players.o.name) === key ? `o` : null;
        if (side === null) continue;
        results.push(game.winner === null ? `none` : game.winner === side ? `won` : `lost`);
    }
    return results;
}

/** One seat's side of a rundown: the record its rating and deviation come from, and its form. */
export interface RundownSide {
    readonly record: PlayerRecord;
    readonly form: readonly FormResult[];
}

/** Both seats' sides; a guest's, or a deleted player's, who has no record to read, is null. */
export type RundownSides = Readonly<Record<Side, RundownSide | null>>;

async function sideOf(player: GamePlayer): Promise<RundownSide | null> {
    if (player.kind === `guest` || player.deleted === true) return null;
    const [record, page] = await Promise.all([fetchPlayerRecord(player.name), fetchFinishedGames({ player: player.name })]);
    return { record, form: formOf(page.games, player.name) };
}

/**
 * Both seats' records and forms through the reads every player page
 * uses, while `wanted`; null until both land or when either fails, since
 * the rundown is extra to the game.
 */
export function useRundown(players: GamePlayers, wanted: boolean): RundownSides | null {
    const { x, o } = players;
    // A snapshot names its players afresh, so the read follows who sits, not the objects naming them,
    // and its sides belong to the players they were read for.
    const load = useCallback(async () => {
        const [xSide, oSide] = await Promise.all([sideOf(x), sideOf(o)]);
        return { x: xSide, o: oSide };
    }, [x.kind, x.name, o.kind, o.name]);
    return useAsync(load, { enabled: wanted, keep: false }).data;
}
