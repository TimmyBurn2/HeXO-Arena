import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Sqlite } from './db';

const nightlyPattern = /^hexo-arena-\d{4}-\d{2}-\d{2}\.sqlite$/;
const labelledPattern = /^hexo-arena-[a-z0-9-]+-(\d{8}T\d{6})\.sqlite$/;
const dayMs = 86_400_000;

export interface BackupPolicy {
    dir: string;
    keep: number;
    hourUtc: number;
}

export interface BackupLog {
    info(fields: object, message: string): void;
    error(fields: object, message: string): void;
}

// A labelled backup carries the second it was taken, so a later one never
// replaces it.
function backupName(at: Date, label: string | undefined): string {
    if (label === undefined) return `hexo-arena-${at.toISOString().slice(0, 10)}.sqlite`;
    return `hexo-arena-${label}-${at.toISOString().slice(0, 19).replace(/[-:]/g, ``)}.sqlite`;
}

function labelledAt(name: string): number | null {
    const stamp = labelledPattern.exec(name)?.[1];
    return stamp === undefined ? null : Date.parse(stamp.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)$/, `$1-$2-$3T$4:$5:$6Z`));
}

// Names sort by date, so the newest `keep` nightly backups are the first
// after a reverse sort.
// A labelled backup goes once it is within a day of `keep` days old: the
// next prune may be a nightly run away, and no backup outlives `keep`
// days, which the erasure journal's window and the privacy policy count on.
function prune(policy: Pick<BackupPolicy, `dir` | `keep`>, at: Date): void {
    const names = readdirSync(policy.dir);
    const staleNightly = names
        .filter((name) => nightlyPattern.test(name))
        .sort()
        .reverse()
        .slice(policy.keep);
    const cutoff = at.getTime() - (policy.keep - 1) * dayMs;
    const staleLabelled = names.filter((name) => {
        const takenAt = labelledAt(name);
        return takenAt !== null && takenAt < cutoff;
    });
    for (const name of [...staleNightly, ...staleLabelled]) rmSync(join(policy.dir, name));
}

// VACUUM INTO writes a consistent snapshot through the live connection,
// where a file copy of a WAL database can tear.
// It runs on the event loop; at this database size that is a pause of
// milliseconds, well inside every clock's slack.
// The snapshot lands under a partial name first, so a crash mid-write
// never leaves a truncated file that looks like a backup.
// Answers the path written.
export function backupNow(sqlite: Sqlite, policy: Pick<BackupPolicy, `dir` | `keep`>, at: Date, label?: string): string {
    mkdirSync(policy.dir, { recursive: true });
    const target = join(policy.dir, backupName(at, label));
    const partial = `${target}.partial`;
    rmSync(partial, { force: true });
    sqlite.prepare(`VACUUM INTO ?`).run(partial);
    renameSync(partial, target);
    prune(policy, at);
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
