import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import { hashPassword, newId, nowIso } from '../services/crypto';
import { ROLE_PERMISSIONS, ROLE_TITLES_AR, ROLES } from '@shared/permissions';

let db: Database.Database | null = null;
let fieldKey: Buffer | null = null;

export function getDb(): Database.Database {
  if (!db) throw new Error('DB_NOT_INITIALIZED');
  return db;
}

export function getFieldKey(): Buffer {
  if (!fieldKey) throw new Error('KEY_NOT_INITIALIZED');
  return fieldKey;
}

function readOrCreateSecret(path: string, bytes = 32): Buffer {
  if (existsSync(path)) {
    return Buffer.from(readFileSync(path, 'utf8').trim(), 'hex');
  }
  const secret = randomBytes(bytes);
  writeFileSync(path, secret.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  return secret;
}

export interface InitResult {
  dbPath: string;
  initialAdminPassword: string | null;
}

export function initDatabase(userDataDir: string): InitResult {
  mkdirSync(userDataDir, { recursive: true });

  const dbPath = join(userDataDir, 'whsham.db');
  const keySecret = readOrCreateSecret(join(userDataDir, '.field-key'));
  fieldKey = keySecret;

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);

  const applied = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
    .get() as { version: number } | undefined;

  let initialAdminPassword: string | null = null;
  if (!applied || applied.version < SCHEMA_VERSION) {
    initialAdminPassword = seed(db);
    db.prepare('INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      nowIso(),
    );
  }

  return { dbPath, initialAdminPassword };
}

/** تهيئة البيانات المرجعية: الأدوار، صلاحياتها، ومستودع مركزي بالإضافة إلى مدير أول. */
function seed(database: Database.Database): string | null {
  const ts = nowIso();
  const insRole = database.prepare('INSERT OR IGNORE INTO roles (id, title_ar) VALUES (?, ?)');
  const insPerm = database.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)',
  );

  const runSeed = database.transaction(() => {
    for (const role of ROLES) {
      insRole.run(role, ROLE_TITLES_AR[role]);
      for (const permission of ROLE_PERMISSIONS[role]) insPerm.run(role, permission);
    }

    database
      .prepare(
        `INSERT OR IGNORE INTO warehouses (id, name, type, category, location, capacity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('wh_central', 'المستودع المركزي', 'مركزية', 'عام', '', 0, 'active', ts, ts);

    const hasAdmin = database.prepare("SELECT 1 FROM users WHERE role_id = 'Admin' LIMIT 1").get();
    if (hasAdmin) return null;

    const initialPassword = randomBytes(9).toString('base64url');
    const { hash, salt, algo } = hashPassword(initialPassword);
    database
      .prepare(
        `INSERT INTO users (id, username, full_name, role_id, password_hash, password_salt,
                            password_algo, status, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, 'Admin', ?, ?, ?, 'active', 1, ?, ?)`,
      )
      .run(newId('usr'), 'admin', 'مدير النظام', hash, salt, algo, ts, ts);
    return initialPassword;
  });

  return runSeed() ?? null;
}
