import type BetterSqlite3 from 'better-sqlite3';
import { appendAudit } from './audit';
import { newId, nowIso } from './crypto';
import type { SessionUser } from './auth';

export interface ReceiveInput {
  materialId: string;
  warehouseId: string;
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  entryNumber?: string | null;
  notes?: string | null;
}

export interface IssueInput {
  materialId: string;
  warehouseId: string;
  quantity: number;
  notes?: string | null;
}

/** إدخال كمية: دفعة جديدة + تحديث الرصيد + حركة + تدقيق — كلها في معاملة واحدة. */
export function receive(
  db: BetterSqlite3.Database,
  user: SessionUser,
  input: ReceiveInput,
): { batchId: string; movementId: string; balance: number } {
  const ts = nowIso();
  const batchId = newId('bat');
  const movementId = newId('mov');

  const run = db.transaction(() => {
    ensureMaterialWarehouse(db, input.materialId, input.warehouseId);

    db.prepare(
      `INSERT INTO batches (id, material_id, warehouse_id, batch_number, quantity, expiry_date, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      batchId,
      input.materialId,
      input.warehouseId,
      input.batchNumber ?? null,
      input.quantity,
      input.expiryDate ?? null,
      ts,
    );

    db.prepare(
      `INSERT INTO stock_items (material_id, warehouse_id, quantity, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(material_id, warehouse_id)
       DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
    ).run(input.materialId, input.warehouseId, input.quantity, ts);

    db.prepare(
      `INSERT INTO movements (id, type, material_id, warehouse_id, batch_id, quantity, entry_number, notes, user_id, created_at)
       VALUES (?, 'IN', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      movementId,
      input.materialId,
      input.warehouseId,
      batchId,
      input.quantity,
      input.entryNumber ?? null,
      input.notes ?? null,
      user.id,
      ts,
    );

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_RECEIVE',
      entity: 'material',
      entityId: input.materialId,
      details: { warehouseId: input.warehouseId, quantity: input.quantity, batchId, movementId },
    });

    return getBalance(db, input.materialId, input.warehouseId);
  });

  return { batchId, movementId, balance: run() };
}

/**
 * إخراج كمية بنظام FIFO: الأقرب انتهاءً أولًا، ثم الأقدم استلامًا.
 * تُرفض العملية كاملةً إذا كان الرصيد غير كافٍ (لا رصيد سالب).
 */
export function issue(
  db: BetterSqlite3.Database,
  user: SessionUser,
  input: IssueInput,
): { movementId: string; consumed: Array<{ batchId: string; quantity: number }>; balance: number } {
  const ts = nowIso();
  const movementId = newId('mov');

  const run = db.transaction(() => {
    ensureMaterialWarehouse(db, input.materialId, input.warehouseId);

    const available = getBalance(db, input.materialId, input.warehouseId);
    if (available < input.quantity) {
      throw Object.assign(new Error('INSUFFICIENT_STOCK'), {
        code: 'INSUFFICIENT_STOCK',
        details: { available, requested: input.quantity },
      });
    }

    const batches = db
      .prepare(
        `SELECT id, quantity FROM batches
          WHERE material_id = ? AND warehouse_id = ? AND quantity > 0
          ORDER BY (expiry_date IS NULL), expiry_date ASC, received_at ASC`,
      )
      .all(input.materialId, input.warehouseId) as Array<{ id: string; quantity: number }>;

    let remaining = input.quantity;
    const consumed: Array<{ batchId: string; quantity: number }> = [];
    const takeFromBatch = db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?');

    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(batch.quantity, remaining);
      takeFromBatch.run(take, batch.id);
      consumed.push({ batchId: batch.id, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) {
      throw Object.assign(new Error('BATCH_INTEGRITY_ERROR'), { code: 'BATCH_INTEGRITY_ERROR' });
    }

    db.prepare(
      `UPDATE stock_items SET quantity = quantity - ?, updated_at = ?
        WHERE material_id = ? AND warehouse_id = ?`,
    ).run(input.quantity, ts, input.materialId, input.warehouseId);

    db.prepare(
      `INSERT INTO movements (id, type, material_id, warehouse_id, quantity, notes, user_id, created_at)
       VALUES (?, 'OUT', ?, ?, ?, ?, ?, ?)`,
    ).run(
      movementId,
      input.materialId,
      input.warehouseId,
      input.quantity,
      input.notes ?? null,
      user.id,
      ts,
    );

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_ISSUE',
      entity: 'material',
      entityId: input.materialId,
      details: { warehouseId: input.warehouseId, quantity: input.quantity, consumed, movementId },
    });

    return {
      balance: getBalance(db, input.materialId, input.warehouseId),
      consumed,
    };
  });

  const result = run();
  return { movementId, consumed: result.consumed, balance: result.balance };
}

export function getBalance(
  db: BetterSqlite3.Database,
  materialId: string,
  warehouseId: string,
): number {
  const row = db
    .prepare('SELECT quantity FROM stock_items WHERE material_id = ? AND warehouse_id = ?')
    .get(materialId, warehouseId) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

export interface StockRow {
  materialId: string;
  code: string;
  materialName: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  minStock: number;
  unit: string;
}

export function listStock(
  db: BetterSqlite3.Database,
  filters: { warehouseId?: string | null; query?: string | null } = {},
): StockRow[] {
  const like = filters.query ? `%${filters.query.trim()}%` : null;
  const rows = db
    .prepare(
      `SELECT s.material_id AS materialId, m.code AS code, m.name AS materialName, m.unit AS unit,
              s.warehouse_id AS warehouseId, w.name AS warehouseName, s.quantity AS quantity,
              m.min_stock AS minStock
         FROM stock_items s
         JOIN materials m ON m.id = s.material_id
         JOIN warehouses w ON w.id = s.warehouse_id
        WHERE (? IS NULL OR s.warehouse_id = ?)
          AND (? IS NULL OR m.name LIKE ? OR m.code LIKE ?)
        ORDER BY (s.quantity <= m.min_stock) DESC, m.name ASC`,
    )
    .all(
      filters.warehouseId ?? null,
      filters.warehouseId ?? null,
      like,
      like,
      like,
    ) as StockRow[];
  return rows;
}

function ensureMaterialWarehouse(
  db: BetterSqlite3.Database,
  materialId: string,
  warehouseId: string,
): void {
  const material = db.prepare('SELECT status FROM materials WHERE id = ?').get(materialId) as
    | { status: string }
    | undefined;
  if (!material || material.status !== 'active') {
    throw Object.assign(new Error('MATERIAL_NOT_FOUND'), { code: 'MATERIAL_NOT_FOUND' });
  }
  const warehouse = db.prepare('SELECT status FROM warehouses WHERE id = ?').get(warehouseId) as
    | { status: string }
    | undefined;
  if (!warehouse || warehouse.status !== 'active') {
    throw Object.assign(new Error('WAREHOUSE_NOT_FOUND'), { code: 'WAREHOUSE_NOT_FOUND' });
  }
}
