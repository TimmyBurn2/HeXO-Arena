import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupNow, msUntilNextRun, scheduleBackups } from '../src/backup';
import { openDatabase, runMigrations, type Sqlite } from '../src/db';

describe('backups', () => {
    let dir: string;
    let sqlite: Sqlite;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), `hexo-arena-backup-`));
        sqlite = openDatabase(join(dir, `live/hexo-arena.sqlite`));
        runMigrations(sqlite);
        sqlite.exec(`insert into site_state (id, paused_at) values (1, 42)`);
    });

    afterEach(() => {
        sqlite.close();
        rmSync(dir, { recursive: true, force: true });
        vi.useRealTimers();
    });

    it('writes a snapshot that opens as a database with the same rows', () => {
        const path = backupNow(sqlite, { dir: join(dir, `backup`), keep: 7 }, new Date(`2026-09-25T03:00:00Z`));
        expect(path).toBe(join(dir, `backup/hexo-arena-2026-09-25.sqlite`));
        const restored = openDatabase(path);
        expect(restored.prepare(`select paused_at as pausedAt from site_state`).get()).toEqual({ pausedAt: 42 });
        restored.close();
    });

    it('keeps the newest backups and leaves unrelated files alone', () => {
        const backupDir = join(dir, `backup`);
        for (let day = 1; day <= 5; day += 1) {
            backupNow(sqlite, { dir: backupDir, keep: 3 }, new Date(`2026-09-0${String(day)}T03:00:00Z`));
        }
        writeFileSync(join(backupDir, `notes.txt`), `operator`);
        backupNow(sqlite, { dir: backupDir, keep: 3 }, new Date(`2026-09-06T03:00:00Z`));
        expect(readdirSync(backupDir).sort()).toEqual([
            `hexo-arena-2026-09-04.sqlite`,
            `hexo-arena-2026-09-05.sqlite`,
            `hexo-arena-2026-09-06.sqlite`,
            `notes.txt`,
        ]);
    });

    it('replaces a same-day backup and a stale partial', () => {
        const backupDir = join(dir, `backup`);
        const at = new Date(`2026-09-25T03:00:00Z`);
        backupNow(sqlite, { dir: backupDir, keep: 7 }, at);
        writeFileSync(join(backupDir, `hexo-arena-2026-09-25.sqlite.partial`), `torn`);
        backupNow(sqlite, { dir: backupDir, keep: 7 }, at);
        expect(readdirSync(backupDir)).toEqual([`hexo-arena-2026-09-25.sqlite`]);
    });

    it('waits until the next run at the configured utc hour', () => {
        expect(msUntilNextRun(new Date(`2026-09-25T02:30:00Z`), 3)).toBe(30 * 60 * 1000);
        expect(msUntilNextRun(new Date(`2026-09-25T03:00:00Z`), 3)).toBe(24 * 60 * 60 * 1000);
        expect(msUntilNextRun(new Date(`2026-09-25T23:00:00Z`), 3)).toBe(4 * 60 * 60 * 1000);
    });

    it('runs nightly and logs a failure without throwing', async () => {
        vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`, `Date`], now: new Date(`2026-09-25T02:00:00Z`) });
        const log = { info: vi.fn(), error: vi.fn() };
        const backupDir = join(dir, `backup`);
        const schedule = scheduleBackups(sqlite, { dir: backupDir, keep: 7, hourUtc: 3 }, log);
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(readdirSync(backupDir)).toEqual([`hexo-arena-2026-09-25.sqlite`]);
        rmSync(backupDir, { recursive: true });
        writeFileSync(backupDir, `not a directory`);
        await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
        expect(log.info).toHaveBeenCalledTimes(1);
        expect(log.error).toHaveBeenCalledTimes(1);
        schedule.stop();
    });
});
