import { acceptsCovers, scheduledIncrementMs, scheduledMainMs, scheduledTurnMs, type BotListing, type TimeControl } from '@hexo-arena/contract';
import { coveredModes, turnWindowOf } from '../play/accepts';
import { presets, sameClock } from '../play/setup';

/** One of the two places a duel's setup holds a bot in. */
export type SlotKey = `first` | `second`;

export const otherSlot = (slot: SlotKey): SlotKey => (slot === `first` ? `second` : `first`);

// The clocks a field can take of every bot: a turn window inside the scheduled bounds, in whole seconds, and whether a match clock is in.
interface FieldClocks {
    readonly turn: readonly [number, number] | null;
    readonly match: boolean;
}

// A scheduled game takes turn clocks of 5 to 60 s, in the 5 s steps a clock set by hand takes.
const turnStep = 5;

function windowOf(bot: BotListing): readonly [number, number] | null {
    const window = turnWindowOf(bot.accepts);
    return window === null ? null : [window[0] / 1000, window[1] / 1000];
}

/** The clocks every bot of a field takes for a scheduled game: a duel's two, or a round robin's. */
export function fieldClocks(field: readonly BotListing[]): FieldClocks {
    const bounds: [number, number] = [scheduledTurnMs.min / 1000, scheduledTurnMs.max / 1000];
    let turn: [number, number] | null = bounds;
    for (const window of field.map(windowOf)) {
        turn = window === null || turn === null ? null : [Math.max(turn[0], window[0]), Math.min(turn[1], window[1])];
    }
    if (turn !== null) turn = [Math.ceil(turn[0] / turnStep) * turnStep, Math.floor(turn[1] / turnStep) * turnStep];
    const match = field.every((bot) => coveredModes(bot.accepts).match);
    return { turn: turn !== null && turn[0] <= turn[1] ? turn : null, match };
}

/** Whether two bots take any clock a scheduled game can run, or one bot alone when the other is missing. */
export function shareClock(first: BotListing, second: BotListing | null): boolean {
    const clocks = fieldClocks(second === null ? [first] : [first, second]);
    return clocks.turn !== null || clocks.match;
}

/** Two bots one person owns play a test. */
export function kindOf(first: BotListing, second: BotListing): `duel` | `test` {
    return first.ownerName !== null && first.ownerName === second.ownerName ? `test` : `duel`;
}

/**
 * A clock a field can run: the last one started here while every bot
 * takes it, else the first preset every bot takes, else the shortest turn
 * clock every bot takes; a match clock all take is always a preset.
 */
export function defaultFieldClock(field: readonly BotListing[], last: TimeControl | null): TimeControl | null {
    const takes = (clock: TimeControl) => takenByAll(clock, field);
    if (last !== null && takes(last)) return last;
    const preset = duelPresets.find((candidate) => takes(candidate.clock));
    if (preset !== undefined) return preset.clock;
    const turn = fieldClocks(field).turn;
    return turn === null ? null : { mode: `turn`, turnTimeMs: turn[0] * 1000 };
}

/** Play's presets but Unlimited, which a scheduled game never runs. */
export const duelPresets = presets.filter((preset) => preset.clock.mode !== `unlimited`);

// Whether a clock is one a scheduled game may run: inside the scheduled bounds, never unlimited.
function scheduled(clock: TimeControl): boolean {
    if (clock.mode === `turn`) return clock.turnTimeMs >= scheduledTurnMs.min && clock.turnTimeMs <= scheduledTurnMs.max;
    if (clock.mode === `match`) {
        return clock.mainTimeMs >= scheduledMainMs.min && clock.mainTimeMs <= scheduledMainMs.max && clock.incrementMs >= scheduledIncrementMs.min && clock.incrementMs <= scheduledIncrementMs.max;
    }
    return false;
}

/** Whether every bot of a field takes a clock a scheduled game may run. */
export function takenByAll(clock: TimeControl, field: readonly BotListing[]): boolean {
    return scheduled(clock) && field.every((bot) => acceptsCovers(bot.accepts, clock));
}

/** The bots of a field that refuse a clock, in the field's order. */
export function refusersOf(clock: TimeControl, field: readonly BotListing[]): BotListing[] {
    return field.filter((bot) => !acceptsCovers(bot.accepts, clock));
}

/** Whether a preset is the clock given. */
export function isPreset(clock: TimeControl): boolean {
    return duelPresets.some((preset) => sameClock(preset.clock, clock));
}

/** The bots a picker lists: by rating, the highest first, then by name. */
export function byRating(a: BotListing, b: BotListing): number {
    return b.rating - a.rating || a.name.localeCompare(b.name);
}
