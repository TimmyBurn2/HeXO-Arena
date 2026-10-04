import { nameKeyOf, type DuelGames, type DuelSummary, type TimeControl } from '@hexo-arena/contract';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitingOut, type ArenaClient } from './client';
import type { PersonaName } from './personas';

/** A duel the seed starts: who starts it, between which bots, how long, and whether rated. */
export interface DevDuelPlan {
    readonly starter: PersonaName;
    readonly first: string;
    readonly second: string;
    readonly games: DuelGames;
    readonly rated: boolean;
}

/** The duels the seed leaves to look at: one played to its end, one under way, and a test played out. */
export interface DevDuelPlans {
    readonly finished: DevDuelPlan;
    readonly live: DevDuelPlan;
    readonly test?: DevDuelPlan;
}

/** What the seed left: each duel's id, the played ones null where they ended early or, for the test, where the plan holds none. */
export interface DevDuels {
    readonly finished: string | null;
    readonly live: string;
    readonly test: string | null;
}

/**
 * The dev duels: ana's rated pair between her hextide and dmitri's
 * quietlake, and her test of hextide against her pebble, which the seed
 * plays out while it holds them online; and bruno's unrated five pairs
 * between two dev bots, which pnpm dev:bots plays on after the seed.
 */
export const devDuelPlans: DevDuelPlans = {
    finished: { starter: `ana`, first: `hextide`, second: `quietlake`, games: 2, rated: true },
    live: { starter: `bruno`, first: `devbot-b`, second: `devbot-c`, games: 10, rated: false },
    test: { starter: `ana`, first: `hextide`, second: `pebble`, games: 10, rated: false },
};

const duelClock: TimeControl = { mode: `turn`, turnTimeMs: 10_000 };

// How long the seed waits for a played-out duel's games: a game between
// the personas' quick strategies takes seconds.
const playDeadlineMs = 10 * 60_000;

export interface DevDuelOptions {
    client: ArenaClient;
    plans: DevDuelPlans;
    // A signed-in persona's session cookie.
    cookieOf: (person: PersonaName) => Promise<string>;
    log: (line: string) => void;
    pollMs?: number;
}

const pairKey = (one: string, two: string) => [nameKeyOf(one), nameKeyOf(two)].sort().join(` `);

const between = (duel: DuelSummary, plan: DevDuelPlan) => duel.startedBy === plan.starter && pairKey(duel.first.name, duel.second.name) === pairKey(plan.first, plan.second);

// A refusal that clears by itself is waited out; any other stops the seed with its code.
async function start(options: DevDuelOptions, plan: DevDuelPlan): Promise<string> {
    const cookie = await options.cookieOf(plan.starter);
    const request = { first: plan.first, second: plan.second, games: plan.games, timeControl: duelClock, rated: plan.rated };
    const created = await waitingOut(async () => options.client.createDuel(cookie, request), options.log, options.pollMs);
    return created.id;
}

// Finds the duel a plan already left finished or running, else starts it,
// and plays it to its end; null where it ended early.
async function playOut(options: DevDuelOptions, plan: DevDuelPlan): Promise<string | null> {
    const { client, log } = options;
    const pollMs = options.pollMs ?? 1_000;
    const done = await client.listDuels(plan.first);
    const id =
        done.past.find((duel) => duel.status === `finished` && between(duel, plan))?.id ?? done.running.find((duel) => between(duel, plan))?.id ?? (await start(options, plan));
    const deadline = Date.now() + playDeadlineMs;
    for (;;) {
        const duel = await client.duel(id);
        if (duel.status !== `running`) {
            log(`${duel.kind} ${duel.id}: ${duel.first.name} ${String(duel.score.first)}, ${duel.second.name} ${String(duel.score.second)}, ${duel.status}`);
            return duel.status === `finished` ? id : null;
        }
        if (Date.now() > deadline) throw new Error(`duel ${id} did not finish in time`);
        await sleep(pollMs);
    }
}

/**
 * Starts the dev duels unless they already stand: the finished duel and the
 * test are played to their ends while the seed holds their bots online, and
 * the live one is left running. A rerun finds the played ones over and the
 * live one still running, and starts none again.
 */
export async function seedDevDuels(options: DevDuelOptions): Promise<DevDuels> {
    const { client, plans, log } = options;
    const finished = await playOut(options, plans.finished);
    const test = plans.test === undefined ? null : await playOut(options, plans.test);
    const running = await client.listDuels(plans.live.first);
    const live = running.running.find((duel) => between(duel, plans.live))?.id ?? (await start(options, plans.live));
    log(`duel ${live} runs: ${plans.live.first} and ${plans.live.second}, ${String(plans.live.games)} games`);
    return { finished, live, test };
}
