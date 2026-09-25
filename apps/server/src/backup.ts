import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Sqlite } from './db';

const backupPattern = /^hexarena-\d{4}-\d{2}-\d{2}\.sqlite$/;

export interface BackupPolicy {
    dir: string;
    keep: number;
    hourUtc: number;
}

export interface BackupLog {
    info(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

function backupName(at: Date): string {
    return `hexarena-${at.toISOString().slice(0, 10)}.sqlite`;
}

// VACUUM INTO writes a consistent snapshot through the live connection,
// where a file copy of a WAL database can tear.
// It runs on the event loop; at this database size that is a pause of
// milliseconds, well inside every clock's slack.
// The snapshot lands under a partial name first, so a crash mid-write
// never leaves a truncated file that looks like a backup.
// Answers the path written.
export function backupNow(sqlite: Sqlite, policy: Pick<BackupPolicy, `dir` | `keep`>, at: Date): string {
    mkdirSync(policy.dir, { recursive: true });
    const target = join(policy.dir, backupName(at));
    const partial = `${target}.partial`;
    rmSync(partial, { force: true });
    sqlite.prepare(`VACUUM INTO ?`).run(partial);
    renameSync(partial, target);
    // Names sort by date, so the newest `keep` are the first after a
    // reverse sort.
    const stale = readdirSync(policy.dir)
        .filter((name) => backupPattern.test(name))
        .sort()
        .reverse()
        .slice(policy.keep);
    for (const name of stale) rmSync(join(policy.dir, name));
    return target;
}

export function msUntilNextRun(now: Date, hourUtc: number): number {
    const next = new Date(now);
    next.setUTCHours(hourUtc, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
}

// A failed backup logs and waits for the next night: the process owns
// every live game and must not die over a full backup volume.
export function scheduleBackups(sqlite: Sqlite, policy: BackupPolicy, log: BackupLog): { stop(): void } {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
        timer = setTimeout(() => {
            try {
                log.info({ path: backupNow(sqlite, policy, new Date()) }, `backup written`);
            } catch (error) {
                log.error({ err: error }, `backup failed`);
            }
            arm();
        }, msUntilNextRun(new Date(), policy.hourUtc));
    };
    arm();
    return {
        stop: () => {
            clearTimeout(timer);
        },
    };
}
