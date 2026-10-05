import { nameKeyOf, tournamentBotsMax, tournamentPerBotCap, type BotListing, type TournamentBotState } from '@hexo-arena/contract';
import { fieldClocks, shareClock } from '../duels/setup';
import { text } from '../text';
import { ownedBy, readinessOf } from './setup';

/** What a bot event's setup reads beside the bot list: the bots the running weekly holds, each bot's event state, and who is looking. */
export interface SetupReads {
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly TournamentBotState[];
    readonly viewer: string | null;
}

/**
 * Why a bot cannot join a bot event now; one with none joins. The first
 * five are the readiness every setup checks; then its events at their cap,
 * its owner's switch, no clock in common with the field, and a field
 * already full.
 */
export type BotReason = `offline` | `closed` | `nothing` | `tournament` | `busy` | `events` | `refused` | `clock` | `full`;

/** The reasons a bot not ready now stands under: a picker's Ready now hides these, and its foot counts them. */
export const notReadyNow: ReadonlySet<BotReason> = new Set([`offline`, `closed`, `nothing`]);

// Whether a field takes any clock a scheduled game can run, every bot of it.
function fieldShares(field: readonly BotListing[]): boolean {
    const clocks = fieldClocks(field);
    return clocks.turn !== null || clocks.match;
}

/** The bots of a field a bot leaves no clock in common with, to name in its reason; every one when only the field as a whole leaves none. */
export function clockClashes(bot: BotListing, field: readonly BotListing[]): BotListing[] {
    const others = field.filter((each) => nameKeyOf(each.name) !== nameKeyOf(bot.name));
    if (others.length === 0 || fieldShares([...others, bot])) return [];
    const clashes = others.filter((each) => !shareClock(bot, each));
    return clashes.length === 0 ? others : clashes;
}

/**
 * Why a bot cannot join a bot event beside the bots of its field, or null
 * when it can: being open and its owner's switch bind only the bots the
 * viewer, who sets the event up, does not own. A bot in the field is asked
 * against the others.
 */
export function eventReadiness(bot: BotListing, field: readonly BotListing[], reads: SetupReads): BotReason | null {
    const now = readinessOf(bot, reads.reserved, reads.viewer, shareClock(bot, null));
    if (now !== `ready`) return now;
    const own = ownedBy(bot, reads.viewer);
    const others = field.filter((each) => nameKeyOf(each.name) !== nameKeyOf(bot.name));
    const state = reads.states.find((each) => nameKeyOf(each.name) === nameKeyOf(bot.name));
    if (state !== undefined && state.running >= tournamentPerBotCap) return `events`;
    if (state !== undefined && !state.duelsByOthers && !own) return `refused`;
    if (clockClashes(bot, field).length > 0) return `clock`;
    if (others.length === field.length && field.length >= tournamentBotsMax) return `full`;
    return null;
}

/** A field of one person's bots alone is a test. */
export function isTest(field: readonly BotListing[]): boolean {
    const owner = field[0]?.ownerName ?? null;
    return owner !== null && field.every((bot) => bot.ownerName === owner);
}

/** A reason a bot cannot join, as the pickers and plates say it: a clash names the bots its clocks clash with. */
export function reasonText(reason: BotReason, clashes: readonly string[]): string {
    const words = text.duels.picker.reasons;
    return reason === `clock` ? words.clock(clashes) : words[reason];
}
