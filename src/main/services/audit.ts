import type { Database } from '../db/sqlite';
import { newId, nowIso, sha256 } from './crypto';

/**
 * سجل تدقيق غير قابل للتعديل فعليًا (append-only hash chain).
 * كل قيد يحمل بصمة السجل السابق؛ أي تعديل أو حذف في المنتصف يكسر السلسلة
 * ويمكن كشفه عبر verifyAuditChain().
 */

export interface AuditEntry {
  userId: string | null;
  userName: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: unknown;
}

const GENESIS = 'GENESIS';

export function appendAudit(db: Database, entry: AuditEntry): string {
  const last = db
    .prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')
    .get() as { hash: string } | undefined;
  const prevHash = last?.hash ?? GENESIS;
  const id = newId('aud');
  const createdAt = nowIso();
  const payload = JSON.stringify({
    id,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    details: entry.details ?? null,
    createdAt,
  });
  const hash = sha256(`${prevHash}|${payload}`);

  db.prepare(
    `INSERT INTO audit_log
       (id, user_id, user_name, action, entity, entity_id, details, prev_hash, hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.userId,
    entry.userName,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.details === undefined ? null : JSON.stringify(entry.details),
    prevHash,
    hash,
    createdAt,
  );

  return id;
}

export interface AuditIntegrity {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
}

export function verifyAuditChain(db: Database): AuditIntegrity {
  const rows = db
    .prepare(
      `SELECT seq, id, user_id, action, entity, entity_id, details, prev_hash, hash, created_at
         FROM audit_log ORDER BY seq ASC`,
    )
    .all() as Array<{
    seq: number;
    id: string;
    user_id: string | null;
    action: string;
    entity: string;
    entity_id: string | null;
    details: string | null;
    prev_hash: string;
    hash: string;
    created_at: string;
  }>;

  let prev = GENESIS;
  for (const row of rows) {
    const payload = JSON.stringify({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      details: row.details === null ? null : JSON.parse(row.details),
      createdAt: row.created_at,
    });
    const expected = sha256(`${prev}|${payload}`);
    if (row.prev_hash !== prev || row.hash !== expected) {
      return { ok: false, checked: rows.length, brokenAtSeq: row.seq };
    }
    prev = row.hash;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null };
}
