import {
    acceptsCovers,
    botConcurrentGameCap,
    defaultHumanOpeningPlies,
    humanSeedRating,
    nameKeyOf,
    openingPliesSchema,
    type Accepts,
    type BotListing,
    type Level,
    type OpeningPlies,
    type TimeControl,
} from '@hexo-arena/contract';
import { coveredModes, turnWindowOf } from './accepts';
import { readStored, writeStored } from '../stored';

/** The six clocks a game starts with most often, in reading order. */
export const presets = [
    { id: `t10`, clock: { mode: `turn`, turnTimeMs: 10_000 } },
    { id: `t20`, clock: { mode: `turn`, turnTimeMs: 20_000 } },
    { id: `t60`, clock: { mode: `turn`, turnTimeMs: 60_000 } },
    { id: `m5`, clock: { mode: `match`, mainTimeMs: 300_000, incrementMs: 3_000 } },
    { id: `m10`, clock: { mode: `match`, mainTimeMs: 600_000, incrementMs: 5_000 } },
    { id: `u`, clock: { mode: `unlimited` } },
] as const satisfies readonly { id: string; clock: TimeControl }[];

export type Preset = (typeof presets)[number];

/** The bounds of a clock set by hand; the turn clock also keeps to what the bot accepts. */
export const custom = {
    turnStepSeconds: 5,
    turnFloorSeconds: 5,
    mainMinutes: { min: 1, max: 30 },
    incrementSeconds: { min: 0, max: 30 },
} as const;

/** Whether a bot can start a game now, or why not. */
export type Readiness = `ready` | `busy` | `tournament` | `offline` | `closed` | `nothing`;

/** The running tournament, which holds its bots until it ends. */
export interface Holder {
    readonly id: string;
    readonly name: string;
}

const unreserved: ReadonlySet<string> = new Set();

/** A bot's readiness; one the running tournament reserves takes no other game until it ends. */
export function readinessOf(bot: BotListing, reserved: ReadonlySet<string> = unreserved): Readiness {
    if (!bot.online) return `offline`;
    if (!bot.openForChallenges) return `closed`;
    const covered = coveredModes(bot.accepts);
    if (!covered.turn && !covered.match && !covered.unlimited) return `nothing`;
    if (reserved.has(bot.name)) return `tournament`;
    return bot.liveGames >= botConcurrentGameCap ? `busy` : `ready`;
}

/** The bots the page lists: named bots that are not ready first, then the ready ones and the busy ones, each by rating. */
export interface Roster {
    named: BotListing[];
    ready: BotListing[];
    busy: BotListing[];
    // Offline, closed, or accepting nothing, and not named: counted, not listed.
    others: number;
}

const byRating = (a: BotListing, b: BotListing) => b.rating - a.rating || a.name.localeCompare(b.name);
/** The roster, pinning each named bot that is not ready in the order named, once; busy bots include those a tournament holds. */
export function rosterOf(bots: readonly BotListing[], named: readonly string[], reserved: ReadonlySet<string> = unreserved): Roster {
    const state = (bot: BotListing) => readinessOf(bot, reserved);
    const listed = (bot: BotListing) => state(bot) === `ready` || state(bot) === `busy` || state(bot) === `tournament`;
    const keys = [...new Set(named.map(nameKeyOf))];
    const pinned = keys.flatMap((key) => bots.filter((bot) => nameKeyOf(bot.name) === key && !listed(bot)));
    return {
        named: pinned,
        ready: bots.filter((bot) => state(bot) === `ready`).sort(byRating),
        busy: bots.filter((bot) => state(bot) === `busy` || state(bot) === `tournament`).sort(byRating),
        others: bots.filter((bot) => !pinned.includes(bot) && !listed(bot)).length,
    };
}

/**
 * The bot the page opens on: the one the link names, if listed;
 * else the last one played in this browser, if ready;
 * else the ready bot nearest the player's rating, a visitor counting as a new player;
 * else a busy one, so the card says why nothing can start.
 */
export function preselect(
    bots: readonly BotListing[],
    named: string | null,
    last: string | null,
    rating: number | null,
    reserved: ReadonlySet<string> = unreserved,
): BotListing | null {
    const find = (name: string | null) => (name === null ? undefined : bots.find((bot) => nameKeyOf(bot.name) === nameKeyOf(name)));
    const linked = find(named);
    if (linked !== undefined) return linked;
    const previous = find(last);
    if (previous !== undefined && readinessOf(previous, reserved) === `ready`) return previous;
    const target = rating ?? humanSeedRating;
    const ready = bots.filter((bot) => readinessOf(bot, reserved) === `ready`);
    const nearest = [...ready].sort((a, b) => Math.abs(a.rating - target) - Math.abs(b.rating - target) || b.rating - a.rating)[0];
    return nearest ?? rosterOf(bots, [], reserved).busy[0] ?? null;
}

/** Whether the bot accepts the clock; a bot with nothing declared accepts none. */
export function accepts(bot: BotListing | null, clock: TimeControl): boolean {
    return bot !== null && acceptsCovers(bot.accepts, clock);
}

/**
 * The clock for a bot: the one given, if it takes it; else the last clock
 * started in this browser, if it takes that; else the first preset it takes.
 */
export function clockFor(bot: BotListing, given: TimeControl | null, last: TimeControl | null): TimeControl {
    if (given !== null && accepts(bot, given)) return given;
    if (last !== null && accepts(bot, last)) return last;
    return presets.find((preset) => accepts(bot, preset.clock))?.clock ?? presets[0].clock;
}

/** The turn clocks a bot takes by hand, in whole steps: the accepted window, never under the floor. */
export function turnBounds(accepts: Accepts | undefined): { min: number; max: number } | null {
    const window = turnWindowOf(accepts);
    if (window === null) return null;
    const step = custom.turnStepSeconds;
    const min = Math.max(custom.turnFloorSeconds, Math.ceil(window[0] / 1000 / step) * step);
    const max = Math.floor(window[1] / 1000 / step) * step;
    return max < min ? null : { min, max };
}

/** The preset a clock is, if any. */
export function presetOf(clock: TimeControl): Preset | undefined {
    return presets.find((preset) => sameClock(preset.clock, clock));
}

export function sameClock(a: TimeControl, b: TimeControl): boolean {
    if (a.mode === `turn` && b.mode === `turn`) return a.turnTimeMs === b.turnTimeMs;
    if (a.mode === `match` && b.mode === `match`) return a.mainTimeMs === b.mainTimeMs && a.incrementMs === b.incrementMs;
    return a.mode === `unlimited` && b.mode === `unlimited`;
}

/**
 * A clock as the address carries it: a preset's id, `turn-25` for 25 s a
 * turn, or `match-7-4` for 7 min plus 4 s.
 */
export function clockParam(clock: TimeControl): string {
    const preset = presetOf(clock);
    if (preset !== undefined) return preset.id;
    if (clock.mode === `turn`) return `turn-${String(clock.turnTimeMs / 1000)}`;
    if (clock.mode === `match`) return `match-${String(clock.mainTimeMs / 60_000)}-${String(clock.incrementMs / 1000)}`;
    return `u`;
}

/** The clock an address names, within the bounds a hand-set clock keeps; null for anything else. */
export function clockFromParam(param: string | null): TimeControl | null {
    if (param === null) return null;
    const preset = presets.find((candidate) => candidate.id === param);
    if (preset !== undefined) return preset.clock;
    const turn = /^turn-(\d{1,4})$/u.exec(param);
    if (turn !== null) {
        const seconds = Number(turn[1]);
        return seconds >= custom.turnFloorSeconds && seconds % custom.turnStepSeconds === 0 ? { mode: `turn`, turnTimeMs: seconds * 1000 } : null;
    }
    const match = /^match-(\d{1,2})-(\d{1,2})$/u.exec(param);
    if (match !== null) {
        const minutes = Number(match[1]);
        const increment = Number(match[2]);
        const inBounds =
            minutes >= custom.mainMinutes.min &&
            minutes <= custom.mainMinutes.max &&
            increment >= custom.incrementSeconds.min &&
            increment <= custom.incrementSeconds.max;
        return inBounds ? { mode: `match`, mainTimeMs: minutes * 60_000, incrementMs: increment * 1000 } : null;
    }
    return null;
}

/** A strength the person picked, by the bot it was picked for and the level's id. */
export interface PickedLevel {
    readonly bot: string;
    readonly id: string;
}

/**
 * The level a game against the bot plays at: the one picked for this bot,
 * if it still declares it and it is not its default; null for the default.
 */
export function levelFor(bot: BotListing, picked: PickedLevel | null): Level | null {
    if (picked === null || bot.levels === null || nameKeyOf(picked.bot) !== nameKeyOf(bot.name) || picked.id === bot.levels.default) return null;
    return bot.levels.list.find((level) => level.id === picked.id) ?? null;
}

/** The opening an address names, or the default. */
export function openingFromParam(param: string | null): OpeningPlies {
    const parsed = openingPliesSchema.safeParse(param === null ? undefined : Number(param));
    return parsed.success ? parsed.data : defaultHumanOpeningPlies;
}

/** The setup as the page's address carries it, so a sign-in returns to it and a link shares it; a level but the default included. */
export function playPath(bot: string | null, clock: TimeControl | null, opening: OpeningPlies, level: Level | null = null): string {
    const params = new URLSearchParams();
    if (bot !== null) params.set(`bot`, bot);
    if (clock !== null) params.set(`clock`, clockParam(clock));
    if (level !== null) params.set(`level`, level.id);
    if (opening !== defaultHumanOpeningPlies) params.set(`opening`, String(opening));
    const query = params.toString();
    return query === `` ? `/play` : `/play?${query}`;
}

/** The Play page opened on a bot, as the bot page and the Bots rows link to it. */
export function playBotPath(bot: string): string {
    return playPath(bot, null, defaultHumanOpeningPlies);
}

/** Where this browser keeps the last opponent and clock a game started with. */
export const playStorageKey = `hexo-arena.play.v1`;

export interface Played {
    opponent: string | null;
    clock: TimeControl | null;
}

export function readPlayed(): Played {
    const raw = readStored(playStorageKey);
    if (raw === null) return { opponent: null, clock: null };
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== `object` || value === null) return { opponent: null, clock: null };
        const opponent: unknown = Reflect.get(value, `opponent`);
        const clock: unknown = Reflect.get(value, `clock`);
        return {
            opponent: typeof opponent === `string` ? opponent : null,
            clock: typeof clock === `string` ? clockFromParam(clock) : null,
        };
    } catch {
        return { opponent: null, clock: null };
    }
}

/** Remember a started game's opponent and clock; the opening is left out, so a one-off never follows a player. */
export function writePlayed(opponent: string, clock: TimeControl): void {
    writeStored(playStorageKey, JSON.stringify({ opponent, clock: clockParam(clock) }));
}
