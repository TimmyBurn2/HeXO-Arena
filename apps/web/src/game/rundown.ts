import { useEffect, useState } from 'react';
import { nameKeyOf, type FinishedGameEntry, type GamePlayer, type GamePlayers, type PlayerRecord, type Side } from '@hexo-arena/contract';
import { fetchFinishedGames, fetchPlayerRecord } from '../api/client';

/** One result as a player's form shows it. */
export type FormResult = `won` | `lost` | `none`;

/** The results a player's form shows at most. */
export const formLength = 5;

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

/** Both seats' sides; a guest's, never kept, is null. */
export type RundownSides = Readonly<Record<Side, RundownSide | null>>;

async function sideOf(name: string, kind: GamePlayer[`kind`]): Promise<RundownSide | null> {
    if (kind === `guest`) return null;
    const [record, page] = await Promise.all([fetchPlayerRecord(name), fetchFinishedGames({ player: name })]);
    return { record, form: formOf(page.games, name) };
}

/**
 * Both seats' records and forms through the reads every player page
 * uses, while `wanted`; null until both land or when either fails, since
 * the rundown is extra to the game.
 */
export function useRundown(players: GamePlayers, wanted: boolean): RundownSides | null {
    const [sides, setSides] = useState<{ key: string; sides: RundownSides } | null>(null);
    const { x, o } = players;
    const key = `${x.kind}:${x.name} ${o.kind}:${o.name}`;
    useEffect(() => {
        if (!wanted) return;
        let cancelled = false;
        Promise.all([sideOf(x.name, x.kind), sideOf(o.name, o.kind)]).then(
            ([xSide, oSide]) => {
                if (!cancelled) setSides({ key, sides: { x: xSide, o: oSide } });
            },
            () => undefined,
        );
        return () => {
            cancelled = true;
        };
    }, [key, wanted, x.name, x.kind, o.name, o.kind]);
    return sides?.key === key ? sides.sides : null;
}
