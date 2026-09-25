import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

// WAL plus synchronous=NORMAL may drop recent commits on power loss but
// never corrupts (STACK.md section 4).
// temp_store=MEMORY because the prod rootfs is read-only; foreign keys are
// a standing repo rule (AGENTS.md).
export function openDatabase(path: string): Database.Database {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    db.pragma(`journal_mode = WAL`);
    db.pragma(`synchronous = NORMAL`);
    db.pragma(`temp_store = MEMORY`);
    db.pragma(`foreign_keys = ON`);
    return db;
}
