import type { ReactNode } from 'react';
import { nameKeyOf } from '@hexo-arena/contract';
import { ApiError, fetchDuels, limitedFor } from '../api/client';
import type { BotReason } from '../play/readiness';
import { Link } from '../router/Link';
import { text } from '../text';
import { duelPagePath } from './setup';

// The next UTC midnight in the reader's own clock, as the daily cap's line names it.
function nextDayLocal(): string {
    const now = new Date();
    const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return new Intl.DateTimeFormat(undefined, { timeStyle: `short` }).format(new Date(midnight));
}

// The page of the duel two bots are playing, else the place's list of the first's duels.
async function runningDuelOf(first: string, second: string): Promise<string> {
    try {
        const list = await fetchDuels({ bot: first });
        const running = list.running.find((duel) => [duel.first.name, duel.second.name].every((name) => [first, second].some((bot) => nameKeyOf(bot) === nameKeyOf(name))));
        if (running !== undefined) return duelPagePath(running.id);
    } catch {
        // The place's list stands in when the read fails.
    }
    return `/play/duels?bot=${encodeURIComponent(first)}`;
}

/**
 * A refusal to start a duel or a test as its line, by its code, naming the
 * bot the server names, the second where it names neither; a busy bot says
 * why where the reads beside the bot list tell.
 */
export async function refusalLine(cause: unknown, pair: { first: string; second: string }, why: (bot: string) => BotReason | null, fallback: string): Promise<ReactNode> {
    const errors = text.duels.errors;
    const wait = limitedFor(cause);
    if (wait !== null) return text.states.tooMany(wait);
    if (!(cause instanceof ApiError)) return fallback;
    const bot = cause.bot ?? pair.second;
    switch (cause.code) {
        case `duel_live`: {
            const watch = await runningDuelOf(pair.first, pair.second);
            return errors.duel_live(pair.first, pair.second, (words) => <Link to={watch}>{words}</Link>);
        }
        case `duel_busy`:
            return errors.duel_busy;
        case `daily_duel_cap`:
            return errors.daily_duel_cap(nextDayLocal());
        case `duel_refused`:
            return errors.duel_refused(bot);
        case `clock_not_accepted`:
            return errors.clock_not_accepted(bot);
        case `bot_busy`: {
            const reason = why(bot);
            return reason === `busy` || reason === `events` || reason === `tournament` ? errors.busyBecause[reason](bot) : errors.bot_busy(bot);
        }
        case `unknown_level`:
            return errors.unknown_level(bot);
        case `daily_pair_cap`:
            return errors.daily_pair_cap(pair.first, pair.second);
        case `daily_bot_cap`:
            return errors.daily_bot_cap;
        case `not_open`:
            return errors.not_open(bot);
        case `delisted`:
        case `banned`:
        case `not_found`:
            return errors.gone(bot);
        case `unrated_only`:
            return errors.unrated_only;
        case `test_only`:
            return errors.test_only;
        case `paused`:
            return errors.paused;
        default:
            return fallback;
    }
}
