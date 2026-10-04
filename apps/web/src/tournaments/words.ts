import type { TournamentSummary, TournamentYours } from '@hexo-arena/contract';
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
        case `called_off`:
        case `canceled`:
            return words.entered(yours.bot);
        case `running`:
        case `finished`:
            if (place.state === `withdrawn`) return words.withdrawn(yours.bot);
            if (place.rank === null) return words.didNotPlay(yours.bot);
            return tournament.status === `running` ? words.soFar(yours.bot, place.rank) : words.final(yours.bot, place.rank);
    }
}
