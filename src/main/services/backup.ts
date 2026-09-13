import type BetterSqlite3 from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { appendAudit } from './audit';
import { nowIso } from './crypto';
import type { SessionUser } from './auth';

/** النسخ الاحتياطي والاستعادة — نسخ متسقة مع فحص سلامة، وتدقيق لكل عملية. */

export interface BackupInfo {
  file: string;
  sizeBytes: number;
  createdAt: string;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function createBackup(
  db: BetterSqlite3.Database,
  dbPath: string,
  backupDir: string,
  user: SessionUser,
): BackupInfo {
  mkdirSync(backupDir, { recursive: true });
  // دمج سجل WAL في الملف الرئيسي قبل النسخ لضمان اتساق النسخة.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
  const ok = integrity?.[0]?.integrity_check === 'ok';
  if (!ok) throw Object.assign(new Error('DB_INTEGRITY_FAILED'), { code: 'DB_INTEGRITY_FAILED' });

  const target = join(backupDir, `whsham-${timestamp()}.db`);
  copyFileSync(dbPath, target);

  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'BACKUP_CREATED',
    entity: 'backup',
    entityId: basename(target),
    details: { sizeBytes: statSync(target).size },
  });

  return { file: target, sizeBytes: statSync(target).size, createdAt: nowIso() };
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const full = join(backupDir, name);
      const stat = statSync(full);
      return { file: full, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function pruneBackups(backupDir: string, keep = 20): number {
  const backups = listBackups(backupDir);
  let removed = 0;
  for (const backup of backups.slice(keep)) {
    try {
      rmSync(backup.file, { force: true });
      removed += 1;
    } catch {
      /* تجاهل */
    }
  }
  return removed;
}

/**
 * الاستعادة: تُنشأ نسخة أمان من القاعدة الحالية أولًا، ثم تُستبدل، ثم يُعاد تشغيل التطبيق.
 * لا تُنفَّذ إلا بصلاحية BACKUP_MANAGE وتأكيد صريح من الواجهة.
 */
export function restoreBackup(
  db: BetterSqlite3.Database,
  dbPath: string,
  backupFile: string,
  backupDir: string,
  user: SessionUser,
): { ok: true; safetyCopy: string } {
  if (!existsSync(backupFile)) {
    throw Object.assign(new Error('BACKUP_NOT_FOUND'), { code: 'BACKUP_NOT_FOUND' });
  }

  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'BACKUP_RESTORE_STARTED',
    entity: 'backup',
    entityId: basename(backupFile),
    details: { dbPath },
  });

  db.pragma('wal_checkpoint(TRUNCATE)');
  const safetyCopy = join(backupDir, `pre-restore-${timestamp()}.db`);
  copyFileSync(dbPath, safetyCopy);

  db.close();
  copyFileSync(backupFile, dbPath);
  return { ok: true, safetyCopy };
}
