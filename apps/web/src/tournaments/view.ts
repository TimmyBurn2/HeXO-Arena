import type { Side, TournamentDetail, TournamentGame } from '@hexo-arena/contract';
import { pagePath } from '@hexo-arena/contract';

// Where a round stands: over, under way, or still to come.
type RoundState = `done` | `live` | `next`;

/** One game from one bot's side, as a crosstable cell draws it. */
export type HexState = `won` | `lost` | `none` | `pending` | `live` | `missing`;

export interface HexView {
    readonly state: HexState;
    readonly gameId: string | null;
}

const over = (game: TournamentGame) => game.outcome !== `pending` && game.outcome !== `live`;

/** Each round's state, in order; the first is live from the start, as a running tournament begins with it, and every later one once a game of it has begun. */
export function roundStates(detail: TournamentDetail): { round: number; state: RoundState }[] {
    return detail.rounds.map((round, index) => {
        const games = round.pairings.flatMap((pairing) => pairing.games);
        const begun = games.some((game) => game.outcome !== `pending`) || (index === 0 && detail.status === `running`);
        const state: RoundState = games.every(over) ? `done` : begun ? `live` : `next`;
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

/** A game as one of its two bots met it; a bot is its key in the tournament. */
export function hexOf(game: TournamentGame, bot: number): HexView {
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
        // The bot that came, or stayed, scores the game it never had to
        // play; the dash is the absent one's alone.
        case `no_show`:
        case `forfeit`:
            return { state: game.missing.includes(bot) ? `missing` : game.point === bot ? `won` : `none`, gameId };
        case `not_played`:
            return { state: `missing`, gameId };
    }
}

/**
 * The two games one bot played against another, each named by its key,
 * as x and as o; null where the two never met, the diagonal included.
 */
export function meeting(detail: TournamentDetail, bot: number, opponent: number): Readonly<Record<Side, HexView>> | null {
    for (const round of detail.rounds) {
        for (const pairing of round.pairings) {
            const pair = [pairing.first.key, pairing.second.key];
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
    const points = (bot: number) => pairing.games.filter((game) => game.point === bot).length;
    return [points(pairing.first.key), points(pairing.second.key)];
}

// Whether a bot, by its key, played a game of the tournament, whatever came of it.
function playedAny(detail: TournamentDetail, bot: number): boolean {
    return detail.rounds.some((round) =>
        round.pairings.some((pairing) => pairing.games.some((game) => (game.outcome === `played` || game.outcome === `aborted`) && (pairing.first.key === bot || pairing.second.key === bot))),
    );
}

/**
 * The bots that entered but did not play to the end, with why: those that
 * never played, and those withdrawn after they had.
 */
export function absentees(detail: TournamentDetail): Record<`never` | `withdrew`, TournamentDetail[`entries`]> {
    const gone = detail.entries.filter((entry) => entry.state === `absent` || entry.state === `left_out` || entry.state === `withdrawn`);
    const withdrew = (entry: (typeof gone)[number]) => entry.state === `withdrawn` && playedAny(detail, entry.key);
    return { never: gone.filter((entry) => !withdrew(entry)), withdrew: gone.filter(withdrew) };
}

/** A tournament's page. */
export function tournamentPagePath(id: string): string {
    return pagePath(`tournament`, { id });
}

/** The lists a link may open the tournaments under Games on, past every one: the reader's own, or tests. */
export const tournamentListViews = [`yours`, `tests`] as const;

export type TournamentListView = (typeof tournamentListViews)[number];

/** The tournaments under Games, on one view and for one bot when named. */
export function gamesTournamentsPath(view: TournamentListView | null = null, bot: string | null = null): string {
    const params = new URLSearchParams();
    if (bot !== null) params.set(`bot`, bot);
    if (view !== null) params.set(`list`, view);
    const path = pagePath(`games-tournaments`, {});
    return params.size === 0 ? path : `${path}?${params.toString()}`;
}
