import {
    defaultOpeningPlies,
    defaultTournamentGamesPerPair,
    gamesPerPairFits,
    nameKeyOf,
    openingPliesSchema,
    pagePath,
    tournamentBotsMax,
    tournamentGameCounts,
    tournamentGamesPerPairSchema,
    tournamentTestGameCounts,
    type OpeningPlies,
    type TimeControl,
    type TournamentDetail,
    type TournamentGamesPerPair,
} from '@hexo-arena/contract';
import { clockFromParam, clockParam } from '../play/setup';
import { readStored, writeStored } from '../stored';

/** A bot picked for a duel or round robin, by name, at a strength by id, null at its rated one. */
export interface PickedBot {
    readonly name: string;
    readonly level: string | null;
}

/**
 * A duel's or round robin's setup as a link carries it: the picked bots in
 * the order named and their strengths, and the games a pair plays, the
 * clock, and the opening, null for the setup's own defaults.
 */
export interface TournamentSetup {
    readonly bots: readonly PickedBot[];
    readonly games: TournamentGamesPerPair | null;
    readonly clock: TimeControl | null;
    readonly opening: OpeningPlies | null;
}

/** A setup with no bot and every default. */
export const emptyTournamentSetup: TournamentSetup = { bots: [], games: null, clock: null, opening: null };

/** Play's Tournament place, its setup opened as given. */
export function tournamentSetupPath(setup: TournamentSetup): string {
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
export function tournamentSetupFromParams(params: URLSearchParams): TournamentSetup {
    const levels = new Map(
        params.getAll(`level`).flatMap((entry) => {
            const at = entry.lastIndexOf(`:`);
            return at <= 0 ? [] : [[nameKeyOf(entry.slice(0, at)), entry.slice(at + 1)] as const];
        }),
    );
    const names = (params.get(`bots`) ?? ``).split(`,`).filter((name) => name !== ``);
    const unique = names.filter((name, index) => names.findIndex((other) => nameKeyOf(other) === nameKeyOf(name)) === index).slice(0, tournamentBotsMax);
    const games = tournamentGamesPerPairSchema.safeParse(params.has(`games`) ? Number(params.get(`games`)) : undefined);
    const opening = openingPliesSchema.safeParse(params.has(`opening`) ? Number(params.get(`opening`)) : undefined);
    return {
        bots: unique.map((name) => ({ name, level: levels.get(nameKeyOf(name)) ?? null })),
        games: games.success ? games.data : null,
        clock: clockFromParam(params.get(`clock`)),
        opening: opening.success ? opening.data : null,
    };
}

/** The setup a duel or round robin over opens again: the same bots in the same order, strengths, and terms. */
export function againSetupOf(detail: Pick<TournamentDetail, `entries` | `gamesPerPair` | `timeControl` | `openingPlies`>): TournamentSetup {
    return {
        bots: detail.entries.filter((entry) => entry.deleted !== true).map((entry) => ({ name: entry.bot, level: entry.level?.id ?? null })),
        games: detail.gamesPerPair,
        clock: detail.timeControl,
        opening: detail.openingPlies,
    };
}

/** The games a pair may play: a test's choice, or any other's. */
export function gamesPerPairOf(test: boolean): readonly TournamentGamesPerPair[] {
    return test ? tournamentTestGameCounts : tournamentGameCounts;
}

/** The counts a field may play, those no bot of it plays past its most games; the others stay shown, out of reach. */
export function countsInReach(bots: number, test: boolean): readonly TournamentGamesPerPair[] {
    return gamesPerPairOf(test).filter((count) => gamesPerPairFits(Math.max(bots, 2), count, test));
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

// Where this browser keeps the games a pair last played, of a duel, a round robin, and a test.
const storageKey = `hexo-arena.round-robins.v1`;

export interface TournamentChoices {
    readonly duelGames: TournamentGamesPerPair;
    readonly games: TournamentGamesPerPair;
    readonly testGames: TournamentGamesPerPair;
}

const firstChoices: TournamentChoices = { duelGames: defaultTournamentGamesPerPair, games: defaultTournamentGamesPerPair, testGames: defaultTournamentGamesPerPair };

function countIn(value: unknown, counts: readonly TournamentGamesPerPair[]): TournamentGamesPerPair {
    return counts.find((count) => count === value) ?? defaultTournamentGamesPerPair;
}

export function readTournamentChoices(): TournamentChoices {
    const raw = readStored(storageKey);
    if (raw === null) return firstChoices;
    try {
        const value: unknown = JSON.parse(raw);
        if (typeof value !== `object` || value === null) return firstChoices;
        return {
            duelGames: countIn(Reflect.get(value, `duelGames`), tournamentGameCounts),
            games: countIn(Reflect.get(value, `games`), tournamentGameCounts),
            testGames: countIn(Reflect.get(value, `testGames`), tournamentTestGameCounts),
        };
    } catch {
        return firstChoices;
    }
}

/** Remember the games a pair plays, with or without anything set up. */
export function writeTournamentChoices(changes: Partial<TournamentChoices>): TournamentChoices {
    const next = { ...readTournamentChoices(), ...changes };
    writeStored(storageKey, JSON.stringify(next));
    return next;
}

/** The opening a duel or round robin starts with unless its creator picks another. */
export const defaultTournamentOpening: OpeningPlies = defaultOpeningPlies;
