import { challengeRecordDays, closedReportMonths, moderationRecordYears } from '@hexo-arena/contract';
import { and, eq, lt } from 'drizzle-orm';
import { msUntilNextRun } from './backup';
import type { Query } from './db';
import { adminActions, challenges, reports } from './db/schema';
import type { ErasureJournal } from './erasure';

/** What one purge removed, by kind. */
export interface Purged {
    readonly moderation: number;
    readonly challenges: number;
    readonly reports: number;
}

/**
 * Removes what has outlived its stated time: moderation records once the
 * third calendar year after their own has ended, the claims they back
 * being time-barred then, challenge records after 90 days, and reports a
 * year after they were closed.
 */
export function purgeExpired(query: Query, now: Date): Purged {
    const seconds = (date: number) => Math.floor(date / 1000);
    const auditCutoff = seconds(Date.UTC(now.getUTCFullYear() - moderationRecordYears, 0, 1));
    const challengeCutoff = seconds(now.getTime()) - challengeRecordDays * 86_400;
    const reportCutoff = new Date(now);
    reportCutoff.setUTCMonth(reportCutoff.getUTCMonth() - closedReportMonths);
    return query.transaction((tx) => ({
        moderation: tx.delete(adminActions).where(lt(adminActions.at, auditCutoff)).run().changes,
        challenges: tx.delete(challenges).where(lt(challenges.createdAt, challengeCutoff)).run().changes,
        reports: tx
            .delete(reports)
            .where(and(eq(reports.status, `closed`), lt(reports.closedAt, seconds(reportCutoff.getTime()))))
            .run().changes,
    }));
}

export interface PurgeLog {
    info(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

/**
 * Purges every night at the hour given, backups or not, and prunes the
 * erasure journal with it.
 * A failed night logs and waits for the next: the process owns every live
 * game and must not die over a purge.
 */
export function schedulePurges(deps: { query: Query; journal: Pick<ErasureJournal, `prune`> | null; hourUtc: number; log: PurgeLog }): { stop(): void } {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
        timer = setTimeout(() => {
            try {
                deps.log.info({ ...purgeExpired(deps.query, new Date()), journaled: deps.journal?.prune() ?? 0 }, `nightly purge done`);
            } catch (error) {
                deps.log.error({ err: error }, `nightly purge failed`);
            }
            arm();
        }, msUntilNextRun(new Date(), deps.hourUtc));
    };
    arm();
    return {
        stop: () => {
            clearTimeout(timer);
        },
    };
}
