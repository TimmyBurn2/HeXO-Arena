import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), `../src/db/migrations`);

/**
 * A copy of the migrations folder whose journal stops after `count`
 * entries, so a test can seed rows the way an older deploy left them;
 * the caller removes it.
 */
export function migrationsUpTo(count: number): string {
    const folder = mkdtempSync(join(tmpdir(), `hexo-arena-migrations-`));
    cpSync(migrationsFolder, folder, { recursive: true });
    const journalPath = join(folder, `meta/_journal.json`);
    const journal = JSON.parse(readFileSync(journalPath, `utf8`)) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, count);
    writeFileSync(journalPath, JSON.stringify(journal));
    return folder;
}
