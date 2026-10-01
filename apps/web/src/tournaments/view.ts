import type { Side, TournamentDetail, TournamentGame } from '@hexo-arena/contract';

/** Where a round stands: over, under way, or still to come. */
export type RoundState = `done` | `live` | `next`;

/** One game from one bot's side, as a crosstable cell draws it. */
export type HexState = `won` | `lost` | `none` | `pending` | `live` | `missing`;

export interface HexView {
    readonly state: HexState;
    readonly gameId: string | null;
}

const over = (game: TournamentGame) => game.outcome !== `pending` && game.outcome !== `live`;

/** Each round's state, in order. */
export function roundStates(detail: TournamentDetail): { round: number; state: RoundState }[] {
    return detail.rounds.map((round) => {
        const games = round.pairings.flatMap((pairing) => pairing.games);
        const state: RoundState = games.every(over) ? `done` : games.some((game) => game.outcome !== `pending`) ? `live` : `next`;
        return { round: round.round, state };
    });
}

/** The first round not yet over, or null once every round is. */
export function currentRound(detail: TournamentDetail): number | null {
    return roundStates(detail).find((round) => round.state !== `done`)?.round ?? null;
}

/** Whether the current round has begun, or waits out the gap after the one before. */
export function roundBegun(detail: TournamentDetail): boolean {
    const round = currentRound(detail);
    return roundStates(detail).find((entry) => entry.round === round)?.state === `live`;
}

// A game as one of its two bots met it.
function hexOf(game: TournamentGame, bot: string): HexView {
    const gameId = game.gameId;
    switch (game.outcome) {
        case `pending`:
            return { state: `pending`, gameId };
        case `live`:
            return { state: `live`, gameId };
        case `played`:
            return { state: game.point === null ? `none` : game.point === bot ? `won` : `lost`, gameId };
        case `aborted`:
            return { state: `none`, gameId };
        case `no_show`:
        case `forfeit`:
        case `not_played`:
            return { state: `missing`, gameId };
    }
}

/**
 * The two games one bot played against another, as x and as o; null where
 * the two never met, the diagonal included.
 */
export function meeting(detail: TournamentDetail, bot: string, opponent: string): Readonly<Record<Side, HexView>> | null {
    for (const round of detail.rounds) {
        for (const pairing of round.pairings) {
            const pair = [pairing.first, pairing.second];
            if (!pair.includes(bot) || !pair.includes(opponent) || bot === opponent) continue;
            const asX = pairing.games.find((game) => game.x === bot);
            const asO = pairing.games.find((game) => game.x !== bot);
            if (asX === undefined || asO === undefined) return null;
            return { x: hexOf(asX, bot), o: hexOf(asO, bot) };
        }
    }
    return null;
}

/** Each bot's points in one pairing, as the round lists show them. */
export function pairingScore(pairing: TournamentDetail[`rounds`][number][`pairings`][number]): readonly [number, number] {
    const points = (bot: string) => pairing.games.filter((game) => game.point === bot).length;
    return [points(pairing.first), points(pairing.second)];
}

/** The bots that entered but did not play to the end, with why. */
export function absentees(detail: TournamentDetail): TournamentDetail[`entries`] {
    return detail.entries.filter((entry) => entry.state === `absent` || entry.state === `left_out` || entry.state === `withdrawn`);
}
