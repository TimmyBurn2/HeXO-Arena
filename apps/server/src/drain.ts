import type { Query } from './db';
import type { GameRegistry } from './game-registry';
import { retireGeneration, type StartGate } from './site-state';

export const drainGraceMs = 120_000;
const drainPollMs = 1_000;

interface DrainDeps {
    query: Query;
    gate: StartGate;
    games: GameRegistry;
    generation: number;
}

// A deploy must not decide rated games: nothing new starts, live games get
// the grace to end on their own, and whatever outlasts it ends aborted and
// unrated.
// The generation retires first, so an orphan timer fired by a stream the
// deploy cut aborts as well instead of forfeiting.
// Answers how many games the deadline aborted.
export async function drain(deps: DrainDeps, graceMs: number): Promise<number> {
    deps.gate.startDraining();
    retireGeneration(deps.query, deps.generation);
    const deadline = Date.now() + graceMs;
    while (deps.games.liveGameCount() > 0 && Date.now() < deadline) {
        const wait = Math.min(drainPollMs, deadline - Date.now());
        await new Promise<void>((resolve) => {
            setTimeout(resolve, wait);
        });
    }
    return deps.games.abortAll();
}
