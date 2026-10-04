import { and, eq, isNull } from 'drizzle-orm';
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { recordAdminAction } from './admin-store';
import type { ChallengeRegistry } from './challenge-registry';
import type { Query } from './db';
import { users } from './db/schema';
import type { GameRegistry } from './game-registry';
import { deleteUser, liveBotIdsOf, type UserDeletion } from './moderation';
import type { PresenceRegistry } from './presence';
import type { DuelRunner } from './duel-runner';
import type { TournamentScheduler } from './tournament-scheduler';

/** The registries a deletion ends live play on, the scheduler it withdraws entries from, and the runner whose duels it ends. */
export interface ErasureDeps {
    games: Pick<GameRegistry, `abortForPerson` | `abortForBot`>;
    presence: Pick<PresenceRegistry, `close`>;
    challenges: Pick<ChallengeRegistry, `withdrawFor`>;
    tournaments: Pick<TournamentScheduler, `withdraw` | `stopSetUpBy`>;
    duels: Pick<DuelRunner, `endForBot`>;
    analysis: { withdraw: (botId: string) => void };
}

/**
 * Deletes a user inside the caller's transaction: their own and their
 * bots' live games end unrated, their bots leave the streams, challenges,
 * tournaments, and duels, and the account goes under the deletion policy.
 * An operator's or a person's own deletion is no one's fault at the board,
 * and a clean delete would take the game rows away from under the registry.
 */
export function eraseUser(deps: ErasureDeps, tx: Query, userId: string): UserDeletion & { aborted: number } {
    let aborted = deps.games.abortForPerson({ kind: `user`, id: userId });
    deps.tournaments.stopSetUpBy(userId, `deleted`);
    for (const botId of liveBotIdsOf(tx, userId)) {
        // Ended before the abort, so the duel names the deletion rather than the abort.
        deps.duels.endForBot(botId, `deleted`);
        aborted += deps.games.abortForBot(botId);
        deps.presence.close(botId);
        deps.analysis.withdraw(botId);
        deps.challenges.withdrawFor(botId);
        deps.tournaments.withdraw(botId, `deleted`);
    }
    return { ...deleteUser(tx, userId), aborted };
}

const entrySchema = z.object({ userId: z.string().min(1), at: z.number().int() });
type ErasureEntry = z.infer<typeof entrySchema>;

/** The journal's file, beside the database on the data volume and outside the file a restore replaces. */
export function erasureJournalPath(databasePath: string): string {
    return join(dirname(databasePath), `erasures.jsonl`);
}

export interface JournalLog {
    warn(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

/**
 * Every deletion of an account, by id and time, one JSON line each, so a
 * database restored from a backup taken before a deletion can have it
 * applied again.
 * An entry outlives the oldest backup by a day, then goes.
 */
export class ErasureJournal {
    readonly #path: string;
    readonly #keepSeconds: number;
    readonly #log: JournalLog;
    readonly #now: () => number;

    constructor(options: { path: string; keepDays: number; log: JournalLog; now?: () => number }) {
        this.#path = options.path;
        this.#keepSeconds = options.keepDays * 86_400;
        this.#log = options.log;
        this.#now = options.now ?? Date.now;
    }

    // The deletion is committed by now, so a failed write cannot undo it;
    // the log says so, and only a restore inside the window would miss it.
    record(userId: string): void {
        try {
            appendFileSync(this.#path, `${JSON.stringify({ userId, at: Math.floor(this.#now() / 1000) })}\n`);
        } catch (error) {
            this.#log.error({ err: error }, `the erasure journal took no entry; a restore would not repeat this deletion`);
        }
    }

    // A line cut short by a crash mid-write, or edited by hand, is skipped and named in the log.
    entries(): ErasureEntry[] {
        if (!existsSync(this.#path)) return [];
        return readFileSync(this.#path, `utf8`)
            .split(`\n`)
            .filter((line) => line.trim() !== ``)
            .flatMap((line, index) => {
                let json: unknown;
                try {
                    json = JSON.parse(line);
                } catch {
                    json = null;
                }
                const parsed = entrySchema.safeParse(json);
                if (parsed.success) return [parsed.data];
                this.#log.warn({ line: index + 1 }, `the erasure journal holds a line that is no entry; it is skipped`);
                return [];
            });
    }

    /** Drops the entries every backup still kept was taken after; answers how many stay. */
    prune(): number {
        if (!existsSync(this.#path)) return 0;
        const all = this.entries();
        const since = Math.floor(this.#now() / 1000) - this.#keepSeconds;
        const kept = all.filter((entry) => entry.at >= since);
        if (kept.length === all.length) return kept.length;
        const partial = `${this.#path}.partial`;
        writeFileSync(partial, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(``));
        renameSync(partial, this.#path);
        return kept.length;
    }
}

/** The audit actor of a deletion the boot applies again. */
export const restoreActor = `restore`;

/**
 * Applies every journaled deletion again to an account a restore brought
 * back, with its audit row; an account already deleted, or never restored,
 * is left alone.
 * Runs at boot, before any request, so nothing is live.
 * Answers how many it applied.
 */
export function reapplyErasures(deps: ErasureDeps, query: Query, journal: ErasureJournal): number {
    let applied = 0;
    for (const { userId } of journal.entries()) {
        const present = query.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).get();
        if (present === undefined) continue;
        query.transaction((tx) => {
            const deletion = eraseUser(deps, tx, userId);
            recordAdminAction(tx, { actor: restoreActor, action: `delete-user`, target: deletion.placeholder, reason: `applied again after a restore` });
        });
        applied += 1;
    }
    return applied;
}
