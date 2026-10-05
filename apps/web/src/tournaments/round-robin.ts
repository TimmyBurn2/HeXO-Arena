import {
    botConcurrentGameCap,
    defaultOpeningPlies,
    defaultRoundRobinGamesPerPair,
    duelPerBotCap,
    nameKeyOf,
    openingPliesSchema,
    pagePath,
    roundRobinGamesPerPair,
    roundRobinMaxBots,
    roundRobinTestGamesPerPair,
    tournamentGamesPerPairSchema,
    type BotListing,
    type OpeningPlies,
    type TimeControl,
    type TournamentDetail,
    type TournamentGamesPerPair,
} from '@hexo-arena/contract';
import { fieldClocks, shareClock, type DuelReads } from '../duels/setup';
import { clockFromParam, clockParam, ownedBy } from '../play/setup';
import { readStored, writeStored } from '../stored';

/** A bot picked for a round robin, by name, at a strength by id, null at its rated one. */
export interface PickedBot {
    readonly name: string;
    readonly level: string | null;
}

/**
 * A round robin's setup as a link carries it: the picked bots and their
 * strengths, and the games a pair plays, the clock, and the opening, null
 * for the setup's own defaults.
 */
export interface RoundRobinSetup {
    readonly bots: readonly PickedBot[];
    readonly games: TournamentGamesPerPair | null;
    readonly clock: TimeControl | null;
    readonly opening: OpeningPlies | null;
}

/** A setup with no bot and every default. */
export const emptyRoundRobin: RoundRobinSetup = { bots: [], games: null, clock: null, opening: null };

/** Play's Tournament place, its setup opened as given. */
export function roundRobinSetupPath(setup: RoundRobinSetup): string {
    const params = new URLSearchParams();
    if (setup.bots.length > 0) params.set(`bots`, setup.bots.map((bot) => bot.name).join(`,`));
    for (const bot of setup.bots) if (bot.level !== null) params.append(`level`, `${bot.name}:${bot.level}`);
    if (setup.games !== null) params.set(`games`, String(setup.games));
    if (setup.clock !== null) params.set(`clock`, clockParam(setup.clock));
    if (setup.opening !== null) params.set(`opening`, String(setup.opening));
    const query = params.toString();
    const path = pagePath(`play-tournament`, {});
    return query === `` ? path : `${path}?${query}`;
}

/** The setup a link names; what it names wrongly falls back to the default, and a bot no longer listed leaves the field later. */
export function roundRobinSetupFromParams(params: URLSearchParams): RoundRobinSetup {
    const levels = new Map(
        params.getAll(`level`).flatMap((entry) => {
            const at = entry.lastIndexOf(`:`);
            return at <= 0 ? [] : [[nameKeyOf(entry.slice(0, at)), entry.slice(at + 1)] as const];
        }),
    );
    const names = (params.get(`bots`) ?? ``).split(`,`).filter((name) => name !== ``);
    const unique = names.filter((name, index) => names.findIndex((other) => nameKeyOf(other) === nameKeyOf(name)) === index).slice(0, roundRobinMaxBots);
    const games = tournamentGamesPerPairSchema.safeParse(params.has(`games`) ? Number(params.get(`games`)) : undefined);
    const opening = openingPliesSchema.safeParse(params.has(`opening`) ? Number(params.get(`opening`)) : undefined);
    return {
        bots: unique.map((name) => ({ name, level: levels.get(nameKeyOf(name)) ?? null })),
        games: games.success ? games.data : null,
        clock: clockFromParam(params.get(`clock`)),
        opening: opening.success ? opening.data : null,
    };
}

/** The setup a round robin over opens again: the same bots, strengths, and terms. */
export function againSetupOf(detail: Pick<TournamentDetail, `entries` | `gamesPerPair` | `timeControl` | `openingPlies`>): RoundRobinSetup {
    return {
        bots: detail.entries.filter((entry) => entry.deleted !== true).map((entry) => ({ name: entry.bot, level: entry.level?.id ?? null })),
        games: detail.gamesPerPair,
        clock: detail.timeControl,
        opening: detail.openingPlies,
    };
}

/** Why a bot cannot join a round robin's field now; one with none joins. */
export type JoinReason = `offline` | `closed` | `nothing` | `tournament` | `busy` | `events` | `refused` | `clock` | `full`;

/** The reasons a bot not ready now stands under: Ready now hides these, and the list's foot counts them. */
export const notReadyToJoin: ReadonlySet<JoinReason> = new Set([`offline`, `closed`, `nothing`]);

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
 * Why a bot cannot join the field beside the bots in it, or null when it
 * can: being open and its owner's switch bind only the bots the viewer,
 * who sets the round robin up, does not own. A bot in the field is asked
 * against the others.
 */
export function joinReason(bot: BotListing, field: readonly BotListing[], reads: DuelReads): JoinReason | null {
    const own = ownedBy(bot, reads.viewer);
    const inField = field.some((each) => nameKeyOf(each.name) === nameKeyOf(bot.name));
    if (!bot.online) return `offline`;
    if (!bot.openForChallenges && !own) return `closed`;
    if (!shareClock(bot, null)) return `nothing`;
    if (reads.reserved.has(bot.name)) return `tournament`;
    if (bot.liveGames >= botConcurrentGameCap) return `busy`;
    const state = reads.states.find((each) => nameKeyOf(each.name) === nameKeyOf(bot.name));
    if (state !== undefined && state.dueling.length + state.roundRobins >= duelPerBotCap) return `events`;
    if (state !== undefined && !state.duelsByOthers && !own) return `refused`;
    if (clockClashes(bot, field).length > 0) return `clock`;
    if (!inField && field.length >= roundRobinMaxBots) return `full`;
    return null;
}

/** A round robin of one person's bots alone is a test. */
export function isTest(field: readonly BotListing[]): boolean {
    const owner = field[0]?.ownerName ?? null;
    return owner !== null && field.every((bot) => bot.ownerName === owner);
}

/** The games a pair may play: a test's choice, or a round robin's. */
export function gamesPerPairOf(test: boolean): readonly TournamentGamesPerPair[] {
    return test ? roundRobinTestGamesPerPair : roundRobinGamesPerPair;
}

// A field's schedule: its pairs and rounds, the pairs a round plays at once, and the games in all and for each bot.
interface Schedule {
    readonly pairs: number;
    readonly rounds: number;
    readonly atOnce: number;
    readonly games: number;
    readonly gamesPerBot: number;
}

/** The circle method's schedule: N - 1 rounds for an even field, N for an odd one, where each bot rests once. */
export function scheduleOf(bots: number, gamesPerPair: number): Schedule {
    const pairs = (bots * (bots - 1)) / 2;
    return { pairs, rounds: bots % 2 === 0 ? bots - 1 : bots, atOnce: Math.floor(bots / 2), games: pairs * gamesPerPair, gamesPerBot: (bots - 1) * gamesPerPair };
}

// Where this browser keeps the games a pair last played in a round robin and in a test.
const roundRobinStorageKey = `hexo-arena.round-robins.v1`;

export interface RoundRobinChoices {
    readonly games: TournamentGamesPerPair;
    readonly testGames: TournamentGamesPerPair;
}

const firstChoices: RoundRobinChoices = { games: defaultRoundRobinGamesPerPair, testGames: defaultRoundRobinGamesPerPair };

function countIn(value: unknown, counts: readonly TournamentGamesPerPair[]): TournamentGamesPerPair {
    return counts.find((count) => count === value) ?? defaultRoundRobinGamesPerPair;
}

export function readRoundRobinChoices(): RoundRobinChoices {
    const raw = readStored(roundRobinStorageKey);
    if (raw === null) return firstChoices;
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== `object` || value === null) return firstChoices;
        return { games: countIn(Reflect.get(value, `games`), roundRobinGamesPerPair), testGames: countIn(Reflect.get(value, `testGames`), roundRobinTestGamesPerPair) };
    } catch {
        return firstChoices;
    }
}

/** Remember the games a pair plays, with or without a round robin set up. */
export function writeRoundRobinChoices(changes: Partial<RoundRobinChoices>): RoundRobinChoices {
    const next = { ...readRoundRobinChoices(), ...changes };
    writeStored(roundRobinStorageKey, JSON.stringify(next));
    return next;
}

/** The opening a round robin starts with unless its creator picks another. */
export const defaultRoundRobinOpening: OpeningPlies = defaultOpeningPlies;
