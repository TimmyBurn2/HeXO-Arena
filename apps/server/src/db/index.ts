import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import * as schema from './schema';

export type Sqlite = Database.Database;
export type Query = BetterSQLite3Database<typeof schema>;

// WAL plus synchronous=NORMAL may drop recent commits on power loss but
// never corrupts.
// temp_store=MEMORY because the prod rootfs is read-only; foreign keys are
// a standing repo rule (AGENTS.md).
// A buffer opens a serialized image in memory, as tests clone one migrated
// database instead of migrating each of theirs.
export function openDatabase(path: string | Buffer): Sqlite {
    if (typeof path === `string`) mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma(`journal_mode = WAL`);
    db.pragma(`synchronous = NORMAL`);
    db.pragma(`temp_store = MEMORY`);
    db.pragma(`foreign_keys = ON`);
    return db;
}

export function runMigrations(sqlite: Sqlite): void {
    const here = dirname(fileURLToPath(import.meta.url));
    migrate(drizzle(sqlite), { migrationsFolder: join(here, `migrations`) });
}

export function createQuery(sqlite: Sqlite): Query {
    return drizzle(sqlite, { schema });
}

export function nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
}
