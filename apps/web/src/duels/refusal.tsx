import type { ReactNode } from 'react';
import { acceptsCovers, nameKeyOf, type BotListing, type TimeControl } from '@hexo-arena/contract';
import { ApiError, fetchBots, fetchDuelBots, fetchDuels, limitedFor } from '../api/client';
import { reservedBots } from '../play/reserved';
import { ownedBy } from '../play/setup';
import { Link } from '../router/Link';
import { text } from '../text';
import { duelPagePath, pickReason, type DuelReads, type PickReason, type SlotKey } from './setup';

/** The bot a refusal is about, and why it cannot play where the reads tell. */
export interface Refused {
    readonly bot: string;
    readonly why: PickReason | null;
}

/**
 * The bot a refusal names, as the reads beside the bot list tell it: each
 * code's gate checked on both bots, the second named when neither shows
 * why, since the reads may lag the server's.
 */
export function refusedBot(code: string, pair: readonly [BotListing, BotListing], terms: { clock: TimeControl; levelled: SlotKey | null }, reads: DuelReads): Refused {
    const [one, two] = pair;
    const why = (subject: BotListing) => pickReason(subject, null, reads);
    const pick = (test: (subject: BotListing) => boolean): Refused => {
        const found = pair.find(test) ?? two;
        return { bot: found.name, why: why(found) };
    };
    switch (code) {
        case `duel_refused`:
            return pick((subject) => why(subject) === `refused`);
        case `clock_not_accepted`:
            return pick((subject) => !acceptsCovers(subject.accepts, terms.clock));
        case `not_open`:
            return pick((subject) => !subject.online || (!subject.openForChallenges && !ownedBy(subject, reads.viewer)));
        case `unknown_level`:
            return { bot: terms.levelled === `first` ? one.name : two.name, why: null };
        case `bot_busy`:
            return pick((subject) => {
                const reason = why(subject);
                return reason === `busy` || reason === `duels` || reason === `tournament`;
            });
        default:
            return { bot: two.name, why: null };
    }
}

/** The bot list and the reads beside it, fetched to tell what a refusal is about; null when a read fails. */
export async function refusalReads(viewer: string | null): Promise<{ bots: readonly BotListing[]; reads: DuelReads } | null> {
    try {
        const [bots, states, held] = await Promise.all([fetchBots(false), fetchDuelBots(), reservedBots()]);
        return { bots, reads: { reserved: held?.bots ?? new Set(), states, viewer } };
    } catch {
        return null;
    }
}

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

/** A refusal to start a duel or a test as its line, by its code, naming the bot it is about where the code names one. */
export async function refusalLine(cause: unknown, pair: { first: string; second: string }, named: (code: string) => Refused, fallback: string): Promise<ReactNode> {
    const errors = text.duels.errors;
    const wait = limitedFor(cause);
    if (wait !== null) return text.states.tooMany(wait);
    if (!(cause instanceof ApiError)) return fallback;
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
            return errors.duel_refused(named(cause.code).bot);
        case `clock_not_accepted`:
            return errors.clock_not_accepted(named(cause.code).bot);
        case `bot_busy`: {
            const refused = named(cause.code);
            const why = refused.why;
            return why === `busy` || why === `duels` || why === `tournament` ? errors.busyBecause[why](refused.bot) : errors.bot_busy(refused.bot);
        }
        case `unknown_level`:
            return errors.unknown_level(named(cause.code).bot);
        case `daily_pair_cap`:
            return errors.daily_pair_cap(pair.first, pair.second);
        case `daily_bot_cap`:
            return errors.daily_bot_cap;
        case `not_open`:
            return errors.not_open(named(cause.code).bot);
        case `delisted`:
        case `banned`:
        case `not_found`:
            return errors.gone(named(cause.code).bot);
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

// The codes whose line names one of the two bots, which only the bot list tells.
const naming: ReadonlySet<string> = new Set([`duel_refused`, `clock_not_accepted`, `bot_busy`, `unknown_level`, `not_open`]);

/** Whether a refusal's line names a bot, so the bot list is worth reading to tell which. */
export function namesABot(cause: unknown): boolean {
    return cause instanceof ApiError && cause.code !== null && naming.has(cause.code);
}
