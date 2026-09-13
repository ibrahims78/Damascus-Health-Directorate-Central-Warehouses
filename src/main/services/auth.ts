import type BetterSqlite3 from 'better-sqlite3';
import { appendAudit } from './audit';
import { hashPassword, newId, nowIso, verifyPassword } from './crypto';
import {
  LOCKOUT_MINUTES,
  MIN_PASSWORD_LENGTH,
  SESSION_IDLE_MINUTES,
  hasPermission,
  isLockedOut,
  type Permission,
  type RoleId,
} from '@shared/permissions';

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: RoleId;
  mustChangePassword: boolean;
  warehouseIds: string[];
}

export interface Session {
  user: SessionUser;
  lastSeenAt: number;
}

let currentSession: Session | null = null;

/** الجلسة تعيش في العملية الرئيسية فقط — الواجهة لا تستطيع تزوير هوية. */
export function getSession(): SessionUser | null {
  if (!currentSession) return null;
  const idleMs = Date.now() - currentSession.lastSeenAt;
  if (idleMs > SESSION_IDLE_MINUTES * 60_000) {
    currentSession = null;
    return null;
  }
  currentSession.lastSeenAt = Date.now();
  return currentSession.user;
}

export function requireSession(): SessionUser {
  const user = getSession();
  if (!user) throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  return user;
}

export function logout(): void {
  currentSession = null;
}

interface UserRow {
  id: string;
  username: string;
  full_name: string;
  role_id: string;
  password_hash: string;
  password_salt: string;
  password_algo: string;
  status: string;
  failed_attempts: number;
  locked_until: string | null;
  must_change_password: number;
}

export function login(db: BetterSqlite3.Database, username: string, password: string): SessionUser {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username.trim()) as UserRow | undefined;

  if (!row) {
    appendAudit(db, {
      userId: null,
      userName: username,
      action: 'LOGIN_FAILED',
      entity: 'user',
      details: { reason: 'unknown-user' },
    });
    throw Object.assign(new Error('INVALID_CREDENTIALS'), { code: 'INVALID_CREDENTIALS' });
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    appendAudit(db, {
      userId: row.id,
      userName: row.username,
      action: 'LOGIN_BLOCKED',
      entity: 'user',
      entityId: row.id,
      details: { reason: 'locked' },
    });
    throw Object.assign(new Error('ACCOUNT_LOCKED'), { code: 'ACCOUNT_LOCKED' });
  }

  if (row.status !== 'active') {
    throw Object.assign(new Error('ACCOUNT_DISABLED'), { code: 'ACCOUNT_DISABLED' });
  }

  const ok = verifyPassword(password, row.password_hash, row.password_salt, row.password_algo);
  if (!ok) {
    const attempts = row.failed_attempts + 1;
    const lockedUntil = isLockedOut(attempts)
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString()
      : null;
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
      attempts,
      lockedUntil,
      nowIso(),
      row.id,
    );
    appendAudit(db, {
      userId: row.id,
      userName: row.username,
      action: 'LOGIN_FAILED',
      entity: 'user',
      entityId: row.id,
      details: { attempts, lockedUntil },
    });
    throw Object.assign(new Error(lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS'), {
      code: lockedUntil ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS',
    });
  }

  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(
    nowIso(),
    row.id,
  );
  appendAudit(db, {
    userId: row.id,
    userName: row.username,
    action: 'LOGIN_SUCCESS',
    entity: 'user',
    entityId: row.id,
  });

  const sessionUser: SessionUser = {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role_id as RoleId,
    mustChangePassword: row.must_change_password === 1,
    warehouseIds: listUserWarehouses(db, row.id),
  };
  currentSession = { user: sessionUser, lastSeenAt: Date.now() };
  return sessionUser;
}

function listUserWarehouses(db: BetterSqlite3.Database, userId: string): string[] {
  const rows = db
    .prepare('SELECT warehouse_id FROM user_warehouses WHERE user_id = ?')
    .all(userId) as Array<{ warehouse_id: string }>;
  return rows.map((r) => r.warehouse_id);
}

export function changePassword(
  db: BetterSqlite3.Database,
  userId: string,
  oldPassword: string,
  newPassword: string,
): void {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(new Error('WEAK_PASSWORD'), { code: 'WEAK_PASSWORD' });
  }
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow | undefined;
  if (!row) throw Object.assign(new Error('USER_NOT_FOUND'), { code: 'USER_NOT_FOUND' });
  if (!verifyPassword(oldPassword, row.password_hash, row.password_salt, row.password_algo)) {
    throw Object.assign(new Error('INVALID_CREDENTIALS'), { code: 'INVALID_CREDENTIALS' });
  }
  const { hash, salt, algo } = hashPassword(newPassword);
  db.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, password_algo = ?,
                      must_change_password = 0, updated_at = ? WHERE id = ?`,
  ).run(hash, salt, algo, nowIso(), userId);
  appendAudit(db, {
    userId,
    userName: row.username,
    action: 'PASSWORD_CHANGED',
    entity: 'user',
    entityId: userId,
  });
}

export function can(permission: Permission): boolean {
  const user = getSession();
  if (!user) return false;
  return hasPermission(user.role, permission);
}
