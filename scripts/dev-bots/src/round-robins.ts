import { nameKeyOf, type TimeControl, type TournamentDetail, type TournamentGamesPerPair } from '@hexo-arena/contract';
import { setTimeout as sleep } from 'node:timers/promises';
import { ApiError, type ArenaClient } from './client';
import type { PersonaName } from './personas';

/** A round robin the seed sets up: who sets it up, its bots, and the games each pair plays. */
export interface DevRoundRobinPlan {
    readonly creator: PersonaName;
    readonly bots: readonly string[];
    readonly gamesPerPair: TournamentGamesPerPair;
}

/** The round robins the seed leaves to look at: one played to its end, a test played out, and one under way. */
export interface DevRoundRobinPlans {
    readonly finished: DevRoundRobinPlan;
    readonly test: DevRoundRobinPlan;
    readonly live: DevRoundRobinPlan;
}

/** What the seed left: each round robin's id, or null where none could start. */
export interface DevRoundRobins {
    readonly finished: string | null;
    readonly test: string | null;
    readonly live: string | null;
}

/**
 * The dev round robins: bruno's of four persona bots and ana's test of her
 * three, which the seed plays out while it holds them online, two openings
 * a pair in the test; and dmitri's of two dev bots and pebble, which pnpm
 * dev:bots plays on after the seed.
 */
export const devRoundRobinPlans: DevRoundRobinPlans = {
    finished: { creator: `bruno`, bots: [`hextide`, `pebble`, `quietlake`, `cinder`], gamesPerPair: 2 },
    test: { creator: `ana`, bots: [`hextide`, `pebble`, `cinder`], gamesPerPair: 4 },
    live: { creator: `dmitri`, bots: [`devbot-b`, `devbot-c`, `pebble`], gamesPerPair: 4 },
};

const roundRobinClock: TimeControl = { mode: `turn`, turnTimeMs: 10_000 };

// How long the seed waits for a played-out round robin: its games between
// the personas' quick strategies take seconds, and each round after the
// first waits half a minute.
const playDeadlineMs = 10 * 60_000;

export interface DevRoundRobinOptions {
    client: ArenaClient;
    plans: DevRoundRobinPlans;
    // A signed-in persona's session cookie.
    cookieOf: (person: PersonaName) => Promise<string>;
    log: (line: string) => void;
    pollMs?: number;
}

const fieldOf = (bots: readonly string[]) => bots.map(nameKeyOf).sort().join(` `);

// The round robin a plan already left, finished or running, by its creator and its bots.
async function findLeft(client: ArenaClient, plan: DevRoundRobinPlan, wanted: (status: TournamentDetail[`status`]) => boolean): Promise<string | null> {
    const first = plan.bots[0];
    if (first === undefined) return null;
    const list = await client.tournaments({ bot: first });
    for (const summary of [...list.running, ...list.past]) {
        if (summary.origin !== `person` || summary.createdBy !== plan.creator || !wanted(summary.status)) continue;
        const detail = await client.tournament(summary.id);
        if (fieldOf(detail.entries.map((entry) => entry.bot)) === fieldOf(plan.bots)) return detail.id;
    }
    return null;
}

// A refusal that leaves the seed's other work standing: a bot not online,
// busy, or a cap is named in the log, and no round robin is left.
async function start(options: DevRoundRobinOptions, plan: DevRoundRobinPlan): Promise<string | null> {
    try {
        const created = await options.client.createRoundRobin(await options.cookieOf(plan.creator), {
            bots: plan.bots.map((name) => ({ name })),
            gamesPerPair: plan.gamesPerPair,
            timeControl: roundRobinClock,
        });
        return created.id;
    } catch (error) {
        if (!(error instanceof ApiError) || error.status >= 500) throw error;
        options.log(`no round robin of ${plan.bots.join(`, `)}: ${error.message}`);
        return null;
    }
}

// Finds the round robin a plan already left finished or running, else sets
// it up, and plays it to its end; null where it could not start or ended early.
async function playOut(options: DevRoundRobinOptions, plan: DevRoundRobinPlan): Promise<string | null> {
    const pollMs = options.pollMs ?? 1_000;
    const id = (await findLeft(options.client, plan, (status) => status === `finished` || status === `running`)) ?? (await start(options, plan));
    if (id === null) return null;
    const deadline = Date.now() + playDeadlineMs;
    for (;;) {
        const detail = await options.client.tournament(id);
        if (detail.status !== `running`) {
            const leader = detail.standings[0];
            options.log(`${detail.name} ${detail.id}: ${detail.status}${leader === undefined ? `` : `, ${leader.bot} first with ${String(leader.points)}`}`);
            return detail.status === `finished` ? id : null;
        }
        if (Date.now() > deadline) throw new Error(`round robin ${id} did not finish in time`);
        await sleep(pollMs);
    }
}

/**
 * Sets the dev round robins up unless they already stand: the finished one
 * and the test play out side by side while the seed holds their bots
 * online, and the live one is left running. A rerun finds the played ones
 * over and the live one still running, and sets none up again.
 */
export async function seedDevRoundRobins(options: DevRoundRobinOptions): Promise<DevRoundRobins> {
    const { plans, log } = options;
    const [finished, test] = await Promise.all([playOut(options, plans.finished), playOut(options, plans.test)]);
    const live = (await findLeft(options.client, plans.live, (status) => status === `running`)) ?? (await start(options, plans.live));
    if (live !== null) log(`round robin ${live} runs: ${plans.live.bots.join(`, `)}, ${String(plans.live.gamesPerPair)} games a pair`);
    return { finished, test, live };
}
