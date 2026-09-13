import type { Database } from '../db/sqlite';
import { appendAudit } from './audit';
import { newId, nowIso } from './crypto';
import type { SessionUser } from './auth';

/** لوحة التعميمات والإشعارات الداخلية (نظام أحادي الجهاز: إشعارات لا مراسلات). */

export function listNotices(db: Database, limit = 100): unknown[] {
  return db
    .prepare(
      `SELECT id, title, body, kind, author_name AS authorName, created_at AS createdAt
         FROM notices ORDER BY created_at DESC LIMIT ?`,
    )
    .all(Math.min(Math.max(limit, 1), 500));
}

export function createNotice(
  db: Database,
  user: SessionUser,
  input: { title: string; body: string; kind?: string | null },
): { id: string } {
  const id = newId('ntc');
  db.prepare(
    `INSERT INTO notices (id, title, body, kind, author_id, author_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.body.trim(),
    input.kind === 'alert' ? 'alert' : 'circular',
    user.id,
    user.fullName,
    nowIso(),
  );
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'NOTICE_CREATED',
    entity: 'notice',
    entityId: id,
    details: { title: input.title, kind: input.kind ?? 'circular' },
  });
  return { id };
}

export function deleteNotice(
  db: Database,
  user: SessionUser,
  input: { id: string },
): { ok: true } {
  db.prepare('DELETE FROM notices WHERE id = ?').run(input.id);
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'NOTICE_DELETED',
    entity: 'notice',
    entityId: input.id,
  });
  return { ok: true };
}
