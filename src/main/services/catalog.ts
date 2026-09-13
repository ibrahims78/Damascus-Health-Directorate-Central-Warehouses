import type { Database } from '../db/sqlite';
import { newId, nowIso } from './crypto';
import { appendAudit } from './audit';
import type { SessionUser } from './auth';

/** الكتالوج: المواد، المستودعات، المورّدون. */

export interface MaterialInput {
  code: string;
  name: string;
  unit: string;
  category?: string | null;
  classification?: string | null;
  type?: string | null;
  minStock?: number | null;
  maxStock?: number | null;
  barcode?: string | null;
}

export function listMaterials(
  db: Database,
  filters: { query?: string | null; onlyBelowMin?: boolean } = {},
): unknown[] {
  const like = filters.query ? `%${filters.query.trim()}%` : null;
  return db
    .prepare(
      `SELECT m.id, m.code, m.name, m.unit, m.category, m.classification, m.type,
              m.min_stock AS minStock, m.max_stock AS maxStock, m.barcode, m.status,
              COALESCE((SELECT SUM(quantity) FROM stock_items s WHERE s.material_id = m.id), 0) AS totalQuantity
         FROM materials m
        WHERE m.status = 'active'
          AND (? IS NULL OR m.name LIKE ? OR m.code LIKE ? OR m.barcode LIKE ?)
        ORDER BY m.name ASC
        LIMIT 1000`,
    )
    .all(like, like, like, like);
}

export function createMaterial(
  db: Database,
  user: SessionUser,
  input: MaterialInput,
): { id: string } {
  if (db.prepare('SELECT 1 FROM materials WHERE code = ? COLLATE NOCASE').get(input.code)) {
    throw Object.assign(new Error('DUPLICATE_CODE'), { code: 'DUPLICATE_CODE' });
  }
  if (input.barcode) {
    const dup = db.prepare('SELECT 1 FROM materials WHERE barcode = ?').get(input.barcode);
    if (dup) throw Object.assign(new Error('DUPLICATE_BARCODE'), { code: 'DUPLICATE_BARCODE' });
  }
  const id = newId('mat');
  const ts = nowIso();
  db.prepare(
    `INSERT INTO materials (id, code, name, unit, category, classification, type,
                            min_stock, max_stock, barcode, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    input.code.trim(),
    input.name.trim(),
    input.unit.trim(),
    input.category ?? null,
    input.classification ?? null,
    input.type ?? null,
    input.minStock ?? 0,
    input.maxStock ?? 0,
    input.barcode ?? null,
    ts,
    ts,
  );
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'MATERIAL_CREATED',
    entity: 'material',
    entityId: id,
    details: { code: input.code, name: input.name },
  });
  return { id };
}

export function updateMaterial(
  db: Database,
  user: SessionUser,
  input: MaterialInput & { id: string; status?: string | null },
): { ok: true } {
  const ts = nowIso();
  const before = db.prepare('SELECT * FROM materials WHERE id = ?').get(input.id);
  if (!before) throw Object.assign(new Error('MATERIAL_NOT_FOUND'), { code: 'MATERIAL_NOT_FOUND' });
  db.prepare(
    `UPDATE materials SET code = ?, name = ?, unit = ?, category = ?, classification = ?, type = ?,
                          min_stock = ?, max_stock = ?, barcode = ?, status = ?, updated_at = ?
      WHERE id = ?`,
  ).run(
    input.code.trim(),
    input.name.trim(),
    input.unit.trim(),
    input.category ?? null,
    input.classification ?? null,
    input.type ?? null,
    input.minStock ?? 0,
    input.maxStock ?? 0,
    input.barcode ?? null,
    input.status ?? 'active',
    ts,
    input.id,
  );
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'MATERIAL_UPDATED',
    entity: 'material',
    entityId: input.id,
    details: { before, after: input },
  });
  return { ok: true };
}

export interface WarehouseInput {
  id?: string | null;
  name: string;
  type: string;
  category?: string | null;
  location?: string | null;
  managerId?: string | null;
  capacity?: number | null;
  parentId?: string | null;
}

export function listWarehouses(db: Database): unknown[] {
  return db
    .prepare(
      `SELECT w.id, w.name, w.type, w.category, w.location, w.manager_id AS managerId,
              w.capacity, w.parent_id AS parentId, w.status,
              COALESCE((SELECT SUM(quantity) FROM stock_items s WHERE s.warehouse_id = w.id), 0) AS totalQuantity
         FROM warehouses w
        ORDER BY w.name ASC`,
    )
    .all();
}

export function saveWarehouse(
  db: Database,
  user: SessionUser,
  input: WarehouseInput,
): { id: string } {
  const ts = nowIso();
  if (input.id) {
    const exists = db.prepare('SELECT 1 FROM warehouses WHERE id = ?').get(input.id);
    if (!exists) throw Object.assign(new Error('WAREHOUSE_NOT_FOUND'), { code: 'WAREHOUSE_NOT_FOUND' });
    db.prepare(
      `UPDATE warehouses SET name = ?, type = ?, category = ?, location = ?, manager_id = ?,
                             capacity = ?, parent_id = ?, updated_at = ? WHERE id = ?`,
    ).run(
      input.name.trim(),
      input.type.trim(),
      input.category ?? null,
      input.location ?? null,
      input.managerId ?? null,
      input.capacity ?? 0,
      input.parentId ?? null,
      ts,
      input.id,
    );
    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'WAREHOUSE_UPDATED',
      entity: 'warehouse',
      entityId: input.id,
      details: input,
    });
    return { id: input.id };
  }

  const id = newId('wh');
  db.prepare(
    `INSERT INTO warehouses (id, name, type, category, location, manager_id, capacity, parent_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.type.trim(),
    input.category ?? null,
    input.location ?? null,
    input.managerId ?? null,
    input.capacity ?? 0,
    input.parentId ?? null,
    ts,
    ts,
  );
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'WAREHOUSE_CREATED',
    entity: 'warehouse',
    entityId: id,
    details: input,
  });
  return { id };
}

export interface SupplierInput {
  id?: string | null;
  name: string;
  contact?: string | null;
  phone?: string | null;
  address?: string | null;
  sourceType?: string | null;
}

export function listSuppliers(db: Database): unknown[] {
  return db
    .prepare(
      `SELECT id, name, contact, phone, address, source_type AS sourceType, status
         FROM suppliers ORDER BY name ASC`,
    )
    .all();
}

export function saveSupplier(
  db: Database,
  user: SessionUser,
  input: SupplierInput,
): { id: string } {
  const ts = nowIso();
  if (input.id) {
    db.prepare(
      `UPDATE suppliers SET name = ?, contact = ?, phone = ?, address = ?, source_type = ?, updated_at = ?
        WHERE id = ?`,
    ).run(
      input.name.trim(),
      input.contact ?? null,
      input.phone ?? null,
      input.address ?? null,
      input.sourceType ?? null,
      ts,
      input.id,
    );
    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'SUPPLIER_UPDATED',
      entity: 'supplier',
      entityId: input.id,
      details: input,
    });
    return { id: input.id };
  }
  const id = newId('sup');
  db.prepare(
    `INSERT INTO suppliers (id, name, contact, phone, address, source_type, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    id,
    input.name.trim(),
    input.contact ?? null,
    input.phone ?? null,
    input.address ?? null,
    input.sourceType ?? null,
    ts,
    ts,
  );
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'SUPPLIER_CREATED',
    entity: 'supplier',
    entityId: id,
    details: input,
  });
  return { id };
}
