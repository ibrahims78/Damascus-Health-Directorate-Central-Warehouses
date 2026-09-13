import type { Database } from '../db/sqlite';
import { appendAudit } from './audit';
import { hashPassword, newId, nowIso } from './crypto';
import { ROLE_PERMISSIONS, ROLES, type RoleId } from '@shared/permissions';
import type { SessionUser } from './auth';

/** إدارة المستخدمين والأدوار — لا تُمنح صلاحية افتراضيًا لأي حساب جديد. */

export function listUsers(db: Database): unknown[] {
  return db
    .prepare(
      `SELECT u.id, u.username, u.full_name AS fullName, u.role_id AS role, u.status,
              u.job_title AS jobTitle, u.phone, u.must_change_password AS mustChangePassword,
              u.created_at AS createdAt,
              (SELECT group_concat(warehouse_id) FROM user_warehouses w WHERE w.user_id = u.id) AS warehouseIds
         FROM users u ORDER BY u.full_name ASC`,
    )
    .all();
}

export function listRoles(db: Database): unknown[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.title_ar AS titleAr,
              (SELECT group_concat(permission) FROM role_permissions p WHERE p.role_id = r.id) AS permissions
         FROM roles r ORDER BY r.id`,
    )
    .all() as Array<{ id: string; titleAr: string; permissions: string | null }>;
  return rows.map((row) => ({
    ...row,
    permissions: row.permissions ? row.permissions.split(',') : [],
  }));
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  roleId: string;
  jobTitle?: string | null;
  phone?: string | null;
  warehouseIds?: string[];
  activate?: boolean | null;
}

export function createUser(
  db: Database,
  actor: SessionUser,
  input: CreateUserInput,
): { id: string; temporaryPassword: string } {
  if (!ROLES.includes(input.roleId as RoleId)) {
    throw Object.assign(new Error('INVALID_ROLE'), { code: 'INVALID_ROLE' });
  }
  const exists = db
    .prepare('SELECT 1 FROM users WHERE username = ? COLLATE NOCASE')
    .get(input.username.trim());
  if (exists) throw Object.assign(new Error('DUPLICATE_USERNAME'), { code: 'DUPLICATE_USERNAME' });

  const temporaryPassword = generateTemporaryPassword();
  const { hash, salt, algo } = hashPassword(temporaryPassword);
  const id = newId('usr');
  const ts = nowIso();

  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, username, full_name, role_id, password_hash, password_salt, password_algo,
                          status, must_change_password, job_title, phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    ).run(
      id,
      input.username.trim(),
      input.fullName.trim(),
      input.roleId,
      hash,
      salt,
      algo,
      input.activate ? 'active' : 'pending',
      input.jobTitle ?? null,
      input.phone ?? null,
      ts,
      ts,
    );
    const link = db.prepare('INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)');
    for (const warehouseId of input.warehouseIds ?? []) link.run(id, warehouseId);
  });
  run();

  appendAudit(db, {
    userId: actor.id,
    userName: actor.username,
    action: 'USER_CREATED',
    entity: 'user',
    entityId: id,
    details: { username: input.username, role: input.roleId, status: input.activate ? 'active' : 'pending' },
  });

  return { id, temporaryPassword };
}

export function setUserStatus(
  db: Database,
  actor: SessionUser,
  input: { userId: string; status: 'active' | 'pending' | 'disabled' },
): { ok: true } {
  if (!['active', 'pending', 'disabled'].includes(input.status)) {
    throw Object.assign(new Error('INVALID_STATUS'), { code: 'INVALID_STATUS' });
  }
  if (input.userId === actor.id && input.status !== 'active') {
    throw Object.assign(new Error('CANNOT_DISABLE_SELF'), { code: 'CANNOT_DISABLE_SELF' });
  }
  ensureNotLastActiveAdmin(db, input.userId, input.status);
  db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(
    input.status,
    nowIso(),
    input.userId,
  );
  appendAudit(db, {
    userId: actor.id,
    userName: actor.username,
    action: 'USER_STATUS_CHANGED',
    entity: 'user',
    entityId: input.userId,
    details: { status: input.status },
  });
  return { ok: true };
}

export function setUserRole(
  db: Database,
  actor: SessionUser,
  input: { userId: string; roleId: string; warehouseIds: string[] },
): { ok: true } {
  if (!ROLES.includes(input.roleId as RoleId)) {
    throw Object.assign(new Error('INVALID_ROLE'), { code: 'INVALID_ROLE' });
  }
  if (input.userId === actor.id && input.roleId !== 'Admin') {
    throw Object.assign(new Error('CANNOT_DEMOTE_SELF'), { code: 'CANNOT_DEMOTE_SELF' });
  }
  ensureNotLastActiveAdmin(db, input.userId, 'active', input.roleId);

  const run = db.transaction(() => {
    db.prepare('UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?').run(
      input.roleId,
      nowIso(),
      input.userId,
    );
    db.prepare('DELETE FROM user_warehouses WHERE user_id = ?').run(input.userId);
    const link = db.prepare('INSERT OR IGNORE INTO user_warehouses (user_id, warehouse_id) VALUES (?, ?)');
    for (const warehouseId of input.warehouseIds) link.run(input.userId, warehouseId);
  });
  run();

  appendAudit(db, {
    userId: actor.id,
    userName: actor.username,
    action: 'USER_ROLE_CHANGED',
    entity: 'user',
    entityId: input.userId,
    details: { role: input.roleId, warehouses: input.warehouseIds },
  });
  return { ok: true };
}

export function resetPassword(
  db: Database,
  actor: SessionUser,
  input: { userId: string },
): { temporaryPassword: string } {
  const temporaryPassword = generateTemporaryPassword();
  const { hash, salt, algo } = hashPassword(temporaryPassword);
  db.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?,
                      must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ?
      WHERE id = ?`,
  ).run(hash, salt, algo, nowIso(), input.userId);

  appendAudit(db, {
    userId: actor.id,
    userName: actor.username,
    action: 'USER_PASSWORD_RESET',
    entity: 'user',
    entityId: input.userId,
    details: { by: actor.username },
  });
  return { temporaryPassword };
}

export function rolePermissionMatrix(): Record<string, readonly string[]> {
  return ROLE_PERMISSIONS as Record<string, readonly string[]>;
}

function ensureNotLastActiveAdmin(
  db: Database,
  userId: string,
  nextStatus: string,
  nextRole?: string,
): void {
  const target = db.prepare('SELECT role_id, status FROM users WHERE id = ?').get(userId) as
    | { role_id: string; status: string }
    | undefined;
  if (!target || target.role_id !== 'Admin') return;
  const remainsAdmin = nextRole === undefined || nextRole === 'Admin';
  const remainsActive = nextStatus === 'active';
  if (remainsAdmin && remainsActive) return;

  const activeAdmins = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role_id = 'Admin' AND status = 'active'")
    .get() as { c: number };
  if (activeAdmins.c <= 1) {
    throw Object.assign(new Error('LAST_ADMIN_PROTECTED'), { code: 'LAST_ADMIN_PROTECTED' });
  }
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)] ?? 'x';
  }
  return out;
}
