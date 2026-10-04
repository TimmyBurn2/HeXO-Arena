import {
    acceptsCovers,
    botConcurrentGameCap,
    defaultDuelGames,
    defaultOpeningPlies,
    defaultTestGames,
    duelGameCounts,
    duelGamesOptions,
    duelPerBotCap,
    nameKeyOf,
    openingPliesSchema,
    scheduledIncrementMs,
    scheduledMainMs,
    scheduledTurnMs,
    testGameCounts,
    type BotListing,
    type DuelBotState,
    type DuelDetail,
    type DuelGames,
    type DuelKind,
    type Level,
    type OpeningPlies,
    type TimeControl,
} from '@hexo-arena/contract';
import { coveredModes, turnWindowOf } from '../play/accepts';
import { clockFromParam, clockParam, ownedBy, presets, sameClock } from '../play/setup';
import { readStored, writeStored } from '../stored';

/** One of the two places a duel's setup holds a bot in. */
export type SlotKey = `first` | `second`;

export const otherSlot = (slot: SlotKey): SlotKey => (slot === `first` ? `second` : `first`);

/** What the setup reads beside the bot list: the running tournament's bots, each bot's duel state, and who is looking. */
export interface DuelReads {
    readonly reserved: ReadonlySet<string>;
    readonly states: readonly DuelBotState[];
    readonly viewer: string | null;
}

/** Why a bot cannot take a slot now; a slot takes a bot with none. */
export type PickReason = `offline` | `closed` | `nothing` | `tournament` | `busy` | `duels` | `refused` | `pair` | `clock`;

/** The reasons a bot not ready now stands under: Ready now hides these, and the list's foot counts them. */
export const notReady: ReadonlySet<PickReason> = new Set([`offline`, `closed`, `nothing`]);

/** The clocks a duel can take of both bots: a turn window inside the scheduled bounds, in whole seconds, and whether a match clock is in. */
export interface DuelClocks {
    readonly turn: readonly [number, number] | null;
    readonly match: boolean;
}

function stateOf(bot: BotListing, reads: DuelReads): DuelBotState | undefined {
    return reads.states.find((state) => nameKeyOf(state.name) === nameKeyOf(bot.name));
}

// A scheduled game takes turn clocks of 5 to 60 s, in the 5 s steps a clock set by hand takes.
const turnStep = 5;

function windowOf(bot: BotListing): readonly [number, number] | null {
    const window = turnWindowOf(bot.accepts);
    return window === null ? null : [window[0] / 1000, window[1] / 1000];
}

/** The clocks two bots both take for a duel, or one bot alone when the other slot is empty. */
export function duelClocks(first: BotListing, second: BotListing | null): DuelClocks {
    const bounds: [number, number] = [scheduledTurnMs.min / 1000, scheduledTurnMs.max / 1000];
    const windows = [first, ...(second === null ? [] : [second])].map(windowOf);
    let turn: [number, number] | null = bounds;
    for (const window of windows) {
        turn = window === null || turn === null ? null : [Math.max(turn[0], window[0]), Math.min(turn[1], window[1])];
    }
    if (turn !== null) turn = [Math.ceil(turn[0] / turnStep) * turnStep, Math.floor(turn[1] / turnStep) * turnStep];
    const match = coveredModes(first.accepts).match && (second === null || coveredModes(second.accepts).match);
    return { turn: turn !== null && turn[0] <= turn[1] ? turn : null, match };
}

/** Whether two bots take any clock a duel can run. */
export function shareClock(first: BotListing, second: BotListing | null): boolean {
    const clocks = duelClocks(first, second);
    return clocks.turn !== null || clocks.match;
}

/**
 * Why a bot cannot take a slot beside the bot in the other one, or null
 * when it can: being open and its owner's switch bind only bots the viewer
 * does not own, who starts the duel.
 */
export function pickReason(bot: BotListing, other: BotListing | null, reads: DuelReads): PickReason | null {
    const own = ownedBy(bot, reads.viewer);
    if (!bot.online) return `offline`;
    if (!bot.openForChallenges && !own) return `closed`;
    if (!shareClock(bot, null)) return `nothing`;
    if (reads.reserved.has(bot.name)) return `tournament`;
    if (bot.liveGames >= botConcurrentGameCap) return `busy`;
    const state = stateOf(bot, reads);
    if (state !== undefined && state.dueling.length >= duelPerBotCap) return `duels`;
    if (state !== undefined && !state.duelsByOthers && !own) return `refused`;
    if (other !== null && state !== undefined && state.dueling.some((name) => nameKeyOf(name) === nameKeyOf(other.name))) return `pair`;
    if (other !== null && !shareClock(bot, other)) return `clock`;
    return null;
}

/** A duel between two bots one person owns is a test. */
export function kindOf(first: BotListing, second: BotListing): DuelKind {
    return first.ownerName !== null && first.ownerName === second.ownerName ? `test` : `duel`;
}

/** The lengths a kind offers, and its default. */
export function gameCountsOf(kind: DuelKind): readonly DuelGames[] {
    return kind === `test` ? testGameCounts : duelGameCounts;
}

/**
 * A clock a duel can run: the last one started here while both bots take
 * it, else the first preset both take, else the shortest turn clock both
 * take; a match clock both take is always a preset.
 */
export function defaultDuelClock(first: BotListing, second: BotListing, last: TimeControl | null): TimeControl | null {
    const takes = (clock: TimeControl) => takenByBoth(clock, first, second);
    if (last !== null && takes(last)) return last;
    const preset = duelPresets.find((candidate) => takes(candidate.clock));
    if (preset !== undefined) return preset.clock;
    const turn = duelClocks(first, second).turn;
    return turn === null ? null : { mode: `turn`, turnTimeMs: turn[0] * 1000 };
}

/** Play's presets but Unlimited, which a duel never runs. */
export const duelPresets = presets.filter((preset) => preset.clock.mode !== `unlimited`);

/** Whether a clock is one a duel may run: inside the scheduled bounds, never unlimited. */
export function scheduled(clock: TimeControl): boolean {
    if (clock.mode === `turn`) return clock.turnTimeMs >= scheduledTurnMs.min && clock.turnTimeMs <= scheduledTurnMs.max;
    if (clock.mode === `match`) {
        return clock.mainTimeMs >= scheduledMainMs.min && clock.mainTimeMs <= scheduledMainMs.max && clock.incrementMs >= scheduledIncrementMs.min && clock.incrementMs <= scheduledIncrementMs.max;
    }
    return false;
}

/** Whether both bots take a clock a duel may run. */
export function takenByBoth(clock: TimeControl, first: BotListing, second: BotListing): boolean {
    return scheduled(clock) && acceptsCovers(first.accepts, clock) && acceptsCovers(second.accepts, clock);
}

/** The bot that refuses a clock, the first named first; null when both take it. */
export function refusedBy(clock: TimeControl, first: BotListing, second: BotListing): BotListing | null {
    if (!acceptsCovers(first.accepts, clock)) return first;
    if (!acceptsCovers(second.accepts, clock)) return second;
    return null;
}

/** The clock picked, while both bots take it; else the default for the pair. */
export function clockForPair(first: BotListing, second: BotListing, picked: TimeControl | null, last: TimeControl | null): TimeControl | null {
    if (picked !== null && takenByBoth(picked, first, second)) return picked;
    return defaultDuelClock(first, second, last);
}

/** Whether a preset is the clock given. */
export function isPreset(clock: TimeControl): boolean {
    return duelPresets.some((preset) => sameClock(preset.clock, clock));
}

/** Openings a length allows: the bare origin only for a single game or one pair. */
export function openingAllowed(opening: OpeningPlies, games: number): boolean {
    return opening > 1 || games <= 2;
}

/** Why a duel can or cannot be rated, for the Rated line. */
export type RatedReason =
    | { readonly kind: `may`; readonly own: string }
    | { readonly kind: `neither` }
    | { readonly kind: `strength`; readonly bot: string; readonly label: string }
    | { readonly kind: `both` }
    | { readonly kind: `owner`; readonly owner: string };

/**
 * Whether the duel may be rated, and why not: a test never is, a starter
 * owning neither bot never rates one, and either bot at a strength other
 * than its rated one makes it unrated.
 */
export function ratedReason(first: BotListing, second: BotListing, levels: Readonly<Record<SlotKey, Level | null>>, viewer: string | null): RatedReason {
    if (kindOf(first, second) === `test`) {
        return ownedBy(first, viewer) ? { kind: `both` } : { kind: `owner`, owner: first.ownerName ?? `` };
    }
    const own = [first, second].find((bot) => ownedBy(bot, viewer));
    if (own === undefined) return { kind: `neither` };
    const level = levels.first ?? levels.second;
    if (level !== null) return { kind: `strength`, bot: levels.first === null ? second.name : first.name, label: level.label };
    return { kind: `may`, own: own.name };
}

/** Where this browser keeps the lengths last picked for a duel and a test, and the Rated switch. */
export const duelStorageKey = `hexo-arena.duels.v1`;

export interface DuelChoices {
    readonly duelGames: DuelGames;
    readonly testGames: DuelGames;
    // Off until the person turns it on here.
    readonly rated: boolean;
}

const firstChoices: DuelChoices = { duelGames: defaultDuelGames, testGames: defaultTestGames, rated: false };

function countIn(value: unknown, counts: readonly DuelGames[], fallback: DuelGames): DuelGames {
    return counts.find((count) => count === value) ?? fallback;
}

export function readChoices(): DuelChoices {
    const raw = readStored(duelStorageKey);
    if (raw === null) return firstChoices;
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== `object` || value === null) return firstChoices;
        return {
            duelGames: countIn(Reflect.get(value, `duelGames`), duelGameCounts, defaultDuelGames),
            testGames: countIn(Reflect.get(value, `testGames`), testGameCounts, defaultTestGames),
            rated: Reflect.get(value, `rated`) === true,
        };
    } catch {
        return firstChoices;
    }
}

/** Remember a pick of the length or the Rated switch, with or without a duel started. */
export function writeChoices(changes: Partial<DuelChoices>): DuelChoices {
    const next = { ...readChoices(), ...changes };
    writeStored(duelStorageKey, JSON.stringify(next));
    return next;
}

/** The opening a duel starts with unless the starter picks another. */
export const defaultDuelOpening: OpeningPlies = defaultOpeningPlies;

/**
 * A setup as a link carries it: the two bots, each one's strength by id,
 * null at its rated one, and the length, clock, and opening, null for the
 * setup's own defaults.
 */
export interface DuelSetup {
    readonly first: string | null;
    readonly second: string | null;
    readonly levels: Readonly<Record<SlotKey, string | null>>;
    readonly games: DuelGames | null;
    readonly clock: TimeControl | null;
    readonly opening: OpeningPlies | null;
}

/** A setup with both slots empty and every default. */
export const emptySetup: DuelSetup = { first: null, second: null, levels: { first: null, second: null }, games: null, clock: null, opening: null };

/** The Bot duels place, its setup opened as given. */
export function setupPath(setup: DuelSetup): string {
    const params = new URLSearchParams();
    if (setup.first !== null) params.set(`first`, setup.first);
    if (setup.second !== null) params.set(`second`, setup.second);
    if (setup.levels.first !== null) params.set(`firstLevel`, setup.levels.first);
    if (setup.levels.second !== null) params.set(`secondLevel`, setup.levels.second);
    if (setup.games !== null) params.set(`games`, String(setup.games));
    if (setup.clock !== null) params.set(`clock`, clockParam(setup.clock));
    if (setup.opening !== null) params.set(`opening`, String(setup.opening));
    const query = params.toString();
    return query === `` ? `/play/duels` : `/play/duels?${query}`;
}

/** The setup a link names; what it names wrongly falls back to the default, and a bot no longer listed leaves its slot empty later. */
export function setupFromParams(params: URLSearchParams): DuelSetup {
    const opening = openingPliesSchema.safeParse(params.has(`opening`) ? Number(params.get(`opening`)) : undefined);
    return {
        first: params.get(`first`),
        second: params.get(`second`),
        levels: { first: params.get(`firstLevel`), second: params.get(`secondLevel`) },
        games: duelGamesOptions.find((count) => String(count) === params.get(`games`)) ?? null,
        clock: clockFromParam(params.get(`clock`)),
        opening: opening.success ? opening.data : null,
    };
}

/** The setup a duel over opens again: the same bots, strengths, and terms. */
export function againPath(duel: Pick<DuelDetail, `first` | `second` | `terms`>): string {
    return setupPath({
        first: duel.first.name,
        second: duel.second.name,
        levels: { first: duel.first.level?.id ?? null, second: duel.second.level?.id ?? null },
        games: duel.terms.games,
        clock: duel.terms.timeControl,
        opening: duel.terms.openingPlies,
    });
}

/** The Bot duels place, opened on a bot when one is named. */
export function duelsPath(first: string | null = null): string {
    return setupPath({ ...emptySetup, first });
}

/** The lists a link may open Bot duels on, past every duel: the reader's own, or tests. */
export const duelListViews = [`yours`, `tests`] as const;

/** Bot duels with its recent list on one view. */
export function duelListPath(view: (typeof duelListViews)[number]): string {
    return `/play/duels?${new URLSearchParams({ list: view }).toString()}`;
}

/** A duel's page. */
export function duelPagePath(id: string): string {
    return `/play/duels/${encodeURIComponent(id)}`;
}

/** The bots a picker lists for a slot: by rating, the highest first, then by name. */
export function byRating(a: BotListing, b: BotListing): number {
    return b.rating - a.rating || a.name.localeCompare(b.name);
}
