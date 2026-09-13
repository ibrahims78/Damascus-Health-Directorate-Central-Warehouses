/**
 * مخطط قاعدة البيانات المحلية (SQLite).
 * قاعدة العمل الأساسية مفروضة في القاعدة نفسها لا في الواجهة:
 *  - لا أرصدة سالبة (CHECK + TRIGGER)
 *  - كل حركة مخزون تُسجَّل في جدول movements
 */

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  title_ar    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id     TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);

CREATE TABLE IF NOT EXISTS warehouses (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,
  category      TEXT,
  location      TEXT,
  manager_id    TEXT,
  capacity      INTEGER NOT NULL DEFAULT 0,
  parent_id     TEXT REFERENCES warehouses(id),
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                   TEXT PRIMARY KEY,
  username             TEXT NOT NULL UNIQUE,
  full_name            TEXT NOT NULL,
  role_id              TEXT NOT NULL REFERENCES roles(id),
  password_hash        TEXT NOT NULL,
  password_salt        TEXT NOT NULL,
  password_algo        TEXT NOT NULL DEFAULT 'scrypt',
  status               TEXT NOT NULL DEFAULT 'pending',
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_warehouses (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS materials (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  unit        TEXT NOT NULL,
  category    TEXT,
  type        TEXT,
  min_stock   INTEGER NOT NULL DEFAULT 0,
  barcode     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id            TEXT PRIMARY KEY,
  material_id   TEXT NOT NULL REFERENCES materials(id),
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
  batch_number  TEXT,
  quantity      INTEGER NOT NULL CHECK (quantity >= 0),
  expiry_date   TEXT,
  received_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  material_id   TEXT NOT NULL REFERENCES materials(id),
  warehouse_id  TEXT NOT NULL REFERENCES warehouses(id),
  quantity      INTEGER NOT NULL CHECK (quantity >= 0),
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (material_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS movements (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('IN','OUT','TRANSFER','DISPOSE','ADJUST')),
  material_id        TEXT NOT NULL REFERENCES materials(id),
  warehouse_id       TEXT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id    TEXT REFERENCES warehouses(id),
  batch_id           TEXT REFERENCES batches(id),
  quantity           INTEGER NOT NULL CHECK (quantity > 0),
  entry_number       TEXT,
  notes              TEXT,
  user_id            TEXT NOT NULL REFERENCES users(id),
  created_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_movements_material ON movements(material_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(warehouse_id, material_id, expiry_date);

CREATE TABLE IF NOT EXISTS suppliers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  address     TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_custody (
  id                  TEXT PRIMARY KEY,
  material_id         TEXT NOT NULL REFERENCES materials(id),
  warehouse_id        TEXT NOT NULL REFERENCES warehouses(id),
  custodian_name      TEXT NOT NULL,
  custodian_job       TEXT,
  custodian_nid_enc   TEXT,
  quantity            INTEGER NOT NULL CHECK (quantity > 0),
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  seq         INTEGER PRIMARY KEY AUTOINCREMENT,
  id          TEXT NOT NULL UNIQUE,
  user_id     TEXT,
  user_name   TEXT,
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   TEXT,
  details     TEXT,
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_stock_no_negative
BEFORE UPDATE ON stock_items
FOR EACH ROW WHEN NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'NEGATIVE_STOCK_FORBIDDEN');
END;
`;
