import { nameKeyOf, type TimeControl, type TournamentDetail, type TournamentGamesPerPair } from '@hexo-arena/contract';
import { setTimeout as sleep } from 'node:timers/promises';
import { waitingOut, type ArenaClient } from './client';
import type { PersonaName } from './personas';

/**
 * A duel or round robin the seed sets up: its name in the report, who
 * sets it up, its bots, the games each pair plays, and whether the seed
 * plays it out or leaves it running.
 */
export interface DevEventPlan {
    readonly name: string;
    readonly creator: PersonaName;
    readonly bots: readonly string[];
    readonly gamesPerPair: TournamentGamesPerPair;
    readonly left: `played` | `running`;
}

/** What the seed left: each plan's tournament by its name, a played one null where it ended early. */
export type DevEvents = Readonly<Record<string, string | null>>;

/**
 * The dev duels and round robins: ana's duel of her hextide and dmitri's
 * quietlake, her test of hextide against her pebble, bruno's round robin
 * of four persona bots, and ana's test of her three, which the seed plays
 * out while it holds them online; and bruno's duel of two dev bots and
 * dmitri's round robin of two dev bots and pebble, which pnpm dev:bots
 * plays on after the seed.
 */
export const devEventPlans: readonly DevEventPlan[] = [
    { name: `finished duel`, creator: `ana`, bots: [`hextide`, `quietlake`], gamesPerPair: 2, left: `played` },
    { name: `test duel`, creator: `ana`, bots: [`hextide`, `pebble`], gamesPerPair: 10, left: `played` },
    { name: `finished round robin`, creator: `bruno`, bots: [`hextide`, `pebble`, `quietlake`, `cinder`], gamesPerPair: 2, left: `played` },
    { name: `test round robin`, creator: `ana`, bots: [`hextide`, `pebble`, `cinder`], gamesPerPair: 4, left: `played` },
    { name: `live duel`, creator: `bruno`, bots: [`devbot-b`, `devbot-c`], gamesPerPair: 10, left: `running` },
    { name: `live round robin`, creator: `dmitri`, bots: [`devbot-b`, `devbot-c`, `pebble`], gamesPerPair: 4, left: `running` },
];

const eventClock: TimeControl = { mode: `turn`, turnTimeMs: 10_000 };

// How long the seed waits for a played-out event: its games between the
// personas' quick strategies take seconds, and each round of a round robin
// after the first waits half a minute.
const playDeadlineMs = 10 * 60_000;

// A person runs two events at once and a bot plays in two, so the played-out
// plans go two at a time, in the order listed, which keeps both caps.
const playedAtOnce = 2;

interface DevEventOptions {
    client: ArenaClient;
    plans: readonly DevEventPlan[];
    // A signed-in persona's session cookie.
    cookieOf: (person: PersonaName) => Promise<string>;
    log: (line: string) => void;
    pollMs?: number;
}

const fieldOf = (bots: readonly string[]) => bots.map(nameKeyOf).sort().join(` `);

// The event a plan already left, finished or running, by its creator and its bots.
async function findLeft(client: ArenaClient, plan: DevEventPlan, wanted: (status: TournamentDetail[`status`]) => boolean): Promise<string | null> {
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

// A refusal that clears by itself is waited out; any other stops the seed with its code.
async function start(options: DevEventOptions, plan: DevEventPlan): Promise<string> {
    const cookie = await options.cookieOf(plan.creator);
    const request = { bots: plan.bots.map((name) => ({ name })), gamesPerPair: plan.gamesPerPair, timeControl: eventClock };
    const created = await waitingOut(async () => options.client.createTournament(cookie, request), options.log, options.pollMs);
    return created.id;
}

// Finds the event a plan already left finished or running, else sets it
// up, and plays it to its end; null where it ended early.
async function playOut(options: DevEventOptions, plan: DevEventPlan): Promise<string | null> {
    const pollMs = options.pollMs ?? 1_000;
    const id = (await findLeft(options.client, plan, (status) => status === `finished` || status === `running`)) ?? (await start(options, plan));
    const deadline = Date.now() + playDeadlineMs;
    for (;;) {
        const detail = await options.client.tournament(id);
        if (detail.status !== `running`) {
            const leader = detail.standings[0];
            options.log(`${plan.name} ${detail.id}: ${detail.status}${leader === undefined ? `` : `, ${leader.bot} first with ${String(leader.points)}`}`);
            return detail.status === `finished` ? id : null;
        }
        if (Date.now() > deadline) throw new Error(`${plan.name} ${id} did not finish in time`);
        await sleep(pollMs);
    }
}

/**
 * Sets the dev duels and round robins up unless they already stand: the
 * played-out ones play to their ends while the seed holds their bots
 * online, and the running ones are left to pnpm dev:bots. A rerun finds the
 * played ones over and the running ones still running, and sets none up again.
 */
export async function seedDevEvents(options: DevEventOptions): Promise<DevEvents> {
    const { plans, log } = options;
    const left: Record<string, string | null> = {};
    const played = plans.filter((plan) => plan.left === `played`);
    for (let at = 0; at < played.length; at += playedAtOnce) {
        const batch = played.slice(at, at + playedAtOnce);
        const ids = await Promise.all(batch.map(async (plan) => playOut(options, plan)));
        for (const [index, plan] of batch.entries()) left[plan.name] = ids[index] ?? null;
    }
    for (const plan of plans.filter((each) => each.left === `running`)) {
        const id = (await findLeft(options.client, plan, (status) => status === `running`)) ?? (await start(options, plan));
        log(`${plan.name} ${id} runs: ${plan.bots.join(`, `)}, ${String(plan.gamesPerPair)} games a pair`);
        left[plan.name] = id;
    }
    return left;
}
