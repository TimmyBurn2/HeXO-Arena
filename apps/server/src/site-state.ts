import { pausedRetryAfterSeconds } from '@hexo-arena/contract';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { nowSeconds, type Query } from './db';
import { siteState } from './db/schema';

// The paused flag is durable, so a restart mid-incident keeps the site
// paused; every read goes to the row, which leaves no second copy to drift.
export function isPaused(query: Query): boolean {
    const row = query.select({ pausedAt: siteState.pausedAt }).from(siteState).where(eq(siteState.id, 1)).get();
    return (row?.pausedAt ?? null) !== null;
}

// Answers whether the flag moved, so a repeated pause is not a change.
export function setPaused(query: Query, paused: boolean): boolean {
    if (isPaused(query) === paused) return false;
    const pausedAt = paused ? nowSeconds() : null;
    query.insert(siteState)
        .values({ id: 1, pausedAt })
        .onConflictDoUpdate({ target: siteState.id, set: { pausedAt } })
        .run();
    return true;
}

// A boot claims the next generation for the process it starts.
export function beginGeneration(query: Query): number {
    const [row] = query.insert(siteState)
        .values({ id: 1, generation: 1 })
        .onConflictDoUpdate({ target: siteState.id, set: { generation: sql`${siteState.generation} + 1` } })
        .returning({ generation: siteState.generation })
        .all();
    if (row === undefined) throw new Error(`the generation upsert returned no row`);
    return row.generation;
}

// Moves the stored generation past this one; a later boot claims its own
// anyway, so the gap is harmless.
export function retireGeneration(query: Query, generation: number): void {
    query.update(siteState)
        .set({ generation: generation + 1 })
        .where(eq(siteState.generation, generation))
        .run();
}

export function isCurrentGeneration(query: Query, generation: number): boolean {
    const row = query.select({ generation: siteState.generation }).from(siteState).where(eq(siteState.id, 1)).get();
    return row?.generation === generation;
}

// Decides whether something new may start.
// Pause is durable site state; draining is this process's own shutdown.
// Both answer the one contract refusal, since a client that retries after
// the advertised delay reaches the next process.
export class StartGate {
    readonly #query: Query;
    #draining = false;

    constructor(query: Query) {
        this.#query = query;
    }

    get draining(): boolean {
        return this.#draining;
    }

    startDraining(): void {
        this.#draining = true;
    }

    closed(): boolean {
        return this.#draining || isPaused(this.#query);
    }

    // Sends the refusal itself and reports whether it did, so a handler
    // that would start something new stays flat.
    refuse(reply: FastifyReply): boolean {
        if (!this.closed()) return false;
        reply
            .code(503)
            .header(`retry-after`, String(pausedRetryAfterSeconds))
            .send({ error: this.#draining ? `the server is restarting` : `the site is paused`, code: `paused` });
        return true;
    }
}
