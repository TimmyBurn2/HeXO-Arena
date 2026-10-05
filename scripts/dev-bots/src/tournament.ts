import { botDailyCap, pairDailyCap, tournamentMinPresent, type OpeningPlies, type TournamentWeekday } from '@hexo-arena/contract';
import { ApiError, type ArenaClient } from './client';

/** The name the dev tournament goes by, so a rerun finds the one already waiting. */
export const devTournamentName = `Dev round robin`;

/** How far ahead the seed schedules it: time to restart pnpm dev:bots first. */
export const devTournamentLeadMs = 3 * 60_000;

/** A weekly rule in the admin client's terms: its UTC slot, name pattern, and clock as the flags take them. */
export interface DevWeeklyRule {
    readonly weekday: TournamentWeekday;
    readonly time: string;
    readonly namePattern: string;
    readonly clock: string;
    readonly openingPlies: OpeningPlies;
    readonly maxEntrants: number;
    readonly daysAhead: number;
}

/**
 * The weekly rule the seed adds, sized to the daily caps:
 * a full field of five, the dev bots and one online bot each of ana and dmitri,
 * plays 2(5-1) = 8 games a bot and 2 a pair,
 * minutes into the UTC day, before the dev bots' own challenges spend their pair caps.
 */
export const devWeeklyRule: DevWeeklyRule = {
    weekday: `mon`,
    time: `00:10`,
    namePattern: `Dev weekly {date}`,
    clock: `turn:10`,
    openingPlies: 5,
    maxEntrants: 5,
    daysAhead: 7,
};

/** A bot the seed may enter, with the owner who enters it. */
export interface Candidate {
    readonly owner: string;
    readonly bot: string;
}

interface DevTournamentOptions {
    client: ArenaClient;
    // Schedules the tournament through the admin client and answers its id.
    schedule: (name: string, startsAt: Date) => Promise<string>;
    candidates: readonly Candidate[];
    now: () => number;
    log: (line: string) => void;
}

/** What the seed left waiting: the tournament and the bots it entered. */
export interface DevTournament {
    readonly id: string;
    readonly entered: readonly string[];
}

function utcDate(at: number): string {
    return new Date(at).toISOString().slice(0, 10);
}

/**
 * Schedules the dev tournament a few minutes out, or finds the one waiting,
 * and enters each candidate whose games today leave room for a full round
 * robin: under its own daily cap, and under the pair cap against every bot
 * already picked. Nothing is scheduled while a tournament runs.
 */
export async function seedDevTournament(options: DevTournamentOptions): Promise<DevTournament | null> {
    const { client, log } = options;
    const list = await client.tournaments();
    const weekly = list.running.find((tournament) => tournament.origin === `operator`);
    if (weekly !== undefined) {
        log(`${weekly.name} is running; no dev tournament scheduled`);
        return null;
    }
    const listed = new Set((await client.listBots()).map((bot) => bot.name));
    const today = utcDate(options.now());
    // Today's games: every game counted, less those finished before today.
    const todays = async (player: string, vs?: string) => {
        const query = vs === undefined ? { player, kind: `bot-bot` as const } : { player, vs };
        return (await client.finishedCount(query)) - (await client.finishedCount({ ...query, before: today }));
    };
    const present = options.candidates.filter((candidate) => listed.has(candidate.bot));
    const games = 2 * (present.length - 1);
    const picked: Candidate[] = [];
    for (const candidate of present) {
        if (botDailyCap - (await todays(candidate.bot)) < games) continue;
        let fits = true;
        for (const other of picked) if (pairDailyCap - (await todays(candidate.bot, other.bot)) < 2) fits = false;
        if (fits) picked.push(candidate);
    }
    if (picked.length < tournamentMinPresent) log(`only ${String(picked.length)} bots have games left today; the dev tournament will be called off`);
    const waiting = list.scheduled.find((tournament) => tournament.name === devTournamentName);
    const id = waiting?.id ?? (await options.schedule(devTournamentName, new Date(options.now() + devTournamentLeadMs)));
    const entered: string[] = [];
    for (const candidate of picked) {
        try {
            await client.enterTournament(await client.devLogin(candidate.owner), id, candidate.bot);
            entered.push(candidate.bot);
        } catch (error) {
            if (!(error instanceof ApiError)) throw error;
            log(`${candidate.bot} was not entered: ${error.message}`);
        }
    }
    return { id, entered };
}
