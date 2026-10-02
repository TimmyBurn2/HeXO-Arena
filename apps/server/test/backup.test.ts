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

    it('writes a labelled backup under its label and the second it was taken, which no later backup replaces', () => {
        const backupDir = join(dir, `backup`);
        const path = backupNow(sqlite, { dir: backupDir, keep: 7 }, new Date(`2026-09-25T14:05:09Z`), `pre-update`);
        expect(path).toBe(join(backupDir, `hexo-arena-pre-update-20260925T140509.sqlite`));
        backupNow(sqlite, { dir: backupDir, keep: 7 }, new Date(`2026-09-25T15:00:00Z`), `pre-update`);
        backupNow(sqlite, { dir: backupDir, keep: 7 }, new Date(`2026-09-25T16:00:00Z`));
        expect(readdirSync(backupDir).sort()).toEqual([
            `hexo-arena-2026-09-25.sqlite`,
            `hexo-arena-pre-update-20260925T140509.sqlite`,
            `hexo-arena-pre-update-20260925T150000.sqlite`,
        ]);
        const restored = openDatabase(path);
        expect(restored.prepare(`select paused_at as pausedAt from site_state`).get()).toEqual({ pausedAt: 42 });
        restored.close();
    });

    it('drops a labelled backup within a day of keep days old, before the next nightly run could find it older, and counts none toward the nightly ones kept', () => {
        const backupDir = join(dir, `backup`);
        const policy = { dir: backupDir, keep: 3 };
        backupNow(sqlite, policy, new Date(`2026-09-01T12:00:00Z`), `pre-update`);
        backupNow(sqlite, policy, new Date(`2026-09-02T03:00:00Z`));
        backupNow(sqlite, policy, new Date(`2026-09-03T03:00:00Z`));
        backupNow(sqlite, policy, new Date(`2026-09-03T11:00:00Z`), `pre-update`);
        expect(readdirSync(backupDir)).toContain(`hexo-arena-pre-update-20260901T120000.sqlite`);
        backupNow(sqlite, policy, new Date(`2026-09-04T03:00:00Z`));
        expect(readdirSync(backupDir).sort()).toEqual([
            `hexo-arena-2026-09-02.sqlite`,
            `hexo-arena-2026-09-03.sqlite`,
            `hexo-arena-2026-09-04.sqlite`,
            `hexo-arena-pre-update-20260903T110000.sqlite`,
        ]);
        backupNow(sqlite, policy, new Date(`2026-09-06T03:00:00Z`));
        expect(readdirSync(backupDir).sort()).toEqual([`hexo-arena-2026-09-03.sqlite`, `hexo-arena-2026-09-04.sqlite`, `hexo-arena-2026-09-06.sqlite`]);
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
