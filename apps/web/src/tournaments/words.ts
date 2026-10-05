import type { DuelEstimate, GameTournament, TournamentDetail, TournamentSummary, TournamentYours } from '@hexo-arena/contract';
import { text } from '../text';

/**
 * The reader's own bot's part in a tournament, in a few words: entered
 * while it waits or once it is called off, its place so far or at the end,
 * or that it was withdrawn or never played.
 */
export function yoursText(tournament: Pick<TournamentSummary, `status`>, yours: TournamentYours): string {
    const words = text.tournaments.yours;
    const { place } = yours;
    switch (tournament.status) {
        case `scheduled`:
            return words.entered(yours.bot);
        case `called_off`:
        case `canceled`:
            return words.wasEntered(yours.bot);
        case `running`:
        case `finished`:
        case `stopped`:
        case `cut_short`:
            if (place.state === `withdrawn`) return words.withdrawn(yours.bot);
            if (place.rank === null) return words.didNotPlay(yours.bot);
            return tournament.status === `running` ? words.soFar(yours.bot, place.rank) : words.final(yours.bot, place.rank);
    }
}

/** A tournament game's caption: a duel's place among its games, else the tournament, the round, and the game within its pair's games. */
export function gameCaption(tournament: GameTournament, test = false): string {
    const game = tournament.leg === undefined ? tournament.game : (tournament.leg - 1) * 2 + tournament.game;
    const of = tournament.of ?? 2;
    if (tournament.format === `duel`) return text.duels.caption(test ? `test` : `duel`, game, of);
    return text.roundRobins.caption(tournament.name, tournament.round, game, of);
}

/** A bot's verdict from its own side of a test's estimate: the estimate favoring the rest reads weaker. */
export function verdictOf(estimate: DuelEstimate): keyof typeof text.roundRobins.estimates.verdicts {
    if (estimate.favored === `second`) return estimate.verdict === `stronger` ? `weaker` : estimate.verdict === `likely_stronger` ? `likely_weaker` : `too_close`;
    return estimate.verdict;
}

/** Who leads a tournament, won it, or led it when it stopped, in a few words; null before a point is scored. */
export function leadText(detail: Pick<TournamentDetail, `status` | `standings`>): string | null {
    const top = detail.standings.filter((line) => line.rank === 1);
    const points = top[0]?.points ?? 0;
    if (points === 0) return null;
    const bots = top.map((line) => line.bot);
    const words = text.roundRobins.page.status;
    switch (detail.status) {
        case `running`:
            return words.leads(bots, points);
        case `finished`:
            return text.drawer.tournamentWon(bots, points);
        case `stopped`:
        case `cut_short`:
        case `canceled`:
            return words.led(bots, points);
        case `scheduled`:
        case `called_off`:
            return null;
    }
}
