import type { Database } from '../db/sqlite';
import { appendAudit } from './audit';
import { newId, nowIso } from './crypto';
import type { SessionUser } from './auth';

export interface ConsumedBatch {
  batchId: string;
  quantity: number;
  batchNumber: string | null;
  expiryDate: string | null;
}

export interface ReceiveInput {
  materialId: string;
  warehouseId: string;
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  entryNumber?: string | null;
  notes?: string | null;
  supplierId?: string | null;
}

export interface MovementResult {
  movementId: string;
  balance: number;
  consumed?: ConsumedBatch[];
}

/** إضافة دفعة ورصيد — تُستدعى داخل معاملة فقط. */
export function addBatch(
  db: Database,
  materialId: string,
  warehouseId: string,
  quantity: number,
  batchNumber: string | null,
  expiryDate: string | null,
  ts = nowIso(),
): string {
  const batchId = newId('bat');
  db.prepare(
    `INSERT INTO batches (id, material_id, warehouse_id, batch_number, quantity, expiry_date, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(batchId, materialId, warehouseId, batchNumber, quantity, expiryDate, ts);

  db.prepare(
    `INSERT INTO stock_items (material_id, warehouse_id, quantity, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(material_id, warehouse_id)
     DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at`,
  ).run(materialId, warehouseId, quantity, ts);

  return batchId;
}

/** استهلاك FIFO: الأقرب انتهاءً أولًا ثم الأقدم استلامًا. يرفض كليًا عند نقص الرصيد. */
export function consumeFifo(
  db: Database,
  materialId: string,
  warehouseId: string,
  quantity: number,
): ConsumedBatch[] {
  const available = getBalance(db, materialId, warehouseId);
  if (available < quantity) {
    throw Object.assign(new Error('INSUFFICIENT_STOCK'), {
      code: 'INSUFFICIENT_STOCK',
      details: { available, requested: quantity },
    });
  }

  const batches = db
    .prepare(
      `SELECT id, quantity, batch_number AS batchNumber, expiry_date AS expiryDate
         FROM batches
        WHERE material_id = ? AND warehouse_id = ? AND quantity > 0
        ORDER BY (expiry_date IS NULL), expiry_date ASC, received_at ASC`,
    )
    .all(materialId, warehouseId) as Array<{
    id: string;
    quantity: number;
    batchNumber: string | null;
    expiryDate: string | null;
  }>;

  const take = db.prepare('UPDATE batches SET quantity = quantity - ? WHERE id = ?');
  const consumed: ConsumedBatch[] = [];
  let remaining = quantity;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const amount = Math.min(batch.quantity, remaining);
    take.run(amount, batch.id);
    consumed.push({
      batchId: batch.id,
      quantity: amount,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
    });
    remaining -= amount;
  }
  if (remaining > 0) throw Object.assign(new Error('BATCH_INTEGRITY_ERROR'), { code: 'BATCH_INTEGRITY_ERROR' });

  db.prepare(
    `UPDATE stock_items SET quantity = quantity - ?, updated_at = ?
      WHERE material_id = ? AND warehouse_id = ?`,
  ).run(quantity, nowIso(), materialId, warehouseId);

  return consumed;
}

function assertFiscalOpen(
  db: Database,
  movementDate: string | null | undefined,
): void {
  if (!movementDate) return;
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'fiscal_closed_until'")
    .get() as { value: string } | undefined;
  const closedUntil = row?.value?.trim();
  if (closedUntil && movementDate < closedUntil) {
    throw Object.assign(new Error('FISCAL_PERIOD_CLOSED'), {
      code: 'FISCAL_PERIOD_CLOSED',
      details: { closedUntil, movementDate },
    });
  }
}

function recordMovement(
  db: Database,
  user: SessionUser,
  movement: {
    type: string;
    materialId: string;
    warehouseId: string;
    toWarehouseId?: string | null;
    batchId?: string | null;
    quantity: number;
    delta?: number | null;
    entryNumber?: string | null;
    expiryDate?: string | null;
    notes?: string | null;
    createdAt?: string;
  },
): string {
  const id = newId('mov');
  db.prepare(
    `INSERT INTO movements (id, type, material_id, warehouse_id, to_warehouse_id, batch_id,
                            quantity, delta, entry_number, expiry_date, notes, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    movement.type,
    movement.materialId,
    movement.warehouseId,
    movement.toWarehouseId ?? null,
    movement.batchId ?? null,
    movement.quantity,
    movement.delta ?? null,
    movement.entryNumber ?? null,
    movement.expiryDate ?? null,
    movement.notes ?? null,
    user.id,
    movement.createdAt ?? nowIso(),
  );
  return id;
}

export function receive(
  db: Database,
  user: SessionUser,
  input: ReceiveInput,
): MovementResult {
  const run = db.transaction(() => {
    assertMaterialWarehouse(db, input.materialId, input.warehouseId);
    assertFiscalOpen(db, nowIso());
    const ts = nowIso();
    const batchId = addBatch(
      db,
      input.materialId,
      input.warehouseId,
      input.quantity,
      input.batchNumber ?? null,
      input.expiryDate ?? null,
      ts,
    );
    const movementId = recordMovement(db, user, {
      type: 'IN',
      materialId: input.materialId,
      warehouseId: input.warehouseId,
      batchId,
      quantity: input.quantity,
      entryNumber: input.entryNumber ?? null,
      expiryDate: input.expiryDate ?? null,
      notes: input.notes ?? null,
      createdAt: ts,
    });
    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_RECEIVE',
      entity: 'material',
      entityId: input.materialId,
      details: {
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        batchId,
        movementId,
        supplierId: input.supplierId ?? null,
      },
    });
    return { movementId, balance: getBalance(db, input.materialId, input.warehouseId) };
  });
  return run();
}

export interface IssueInput {
  materialId: string;
  warehouseId: string;
  quantity: number;
  notes?: string | null;
  recipient?: string | null;
  entryNumber?: string | null;
}

export function issue(
  db: Database,
  user: SessionUser,
  input: IssueInput,
): MovementResult {
  const run = db.transaction(() => {
    assertMaterialWarehouse(db, input.materialId, input.warehouseId);
    assertFiscalOpen(db, nowIso());
    const consumed = consumeFifo(db, input.materialId, input.warehouseId, input.quantity);
    const movementId = recordMovement(db, user, {
      type: 'OUT',
      materialId: input.materialId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      entryNumber: input.entryNumber ?? null,
      notes: [input.recipient ? `المستلم: ${input.recipient}` : null, input.notes ?? null]
        .filter(Boolean)
        .join(' | '),
    });
    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_ISSUE',
      entity: 'material',
      entityId: input.materialId,
      details: {
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        consumed,
        movementId,
        recipient: input.recipient ?? null,
      },
    });
    return {
      movementId,
      balance: getBalance(db, input.materialId, input.warehouseId),
      consumed,
    };
  });
  return run();
}

export function transfer(
  db: Database,
  user: SessionUser,
  input: { materialId: string; fromWarehouseId: string; toWarehouseId: string; quantity: number; notes?: string | null },
): MovementResult {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw Object.assign(new Error('SAME_WAREHOUSE'), { code: 'SAME_WAREHOUSE' });
  }
  const run = db.transaction(() => {
    assertMaterialWarehouse(db, input.materialId, input.fromWarehouseId);
    assertMaterialWarehouse(db, input.materialId, input.toWarehouseId);
    assertFiscalOpen(db, nowIso());
    const ts = nowIso();
    const consumed = consumeFifo(db, input.materialId, input.fromWarehouseId, input.quantity);

    // تُنقل الدفعات نفسها مع الحفاظ على رقم الدفعة وتاريخ الصلاحية.
    let firstBatchId: string | null = null;
    for (const item of consumed) {
      const newBatchId = addBatch(
        db,
        input.materialId,
        input.toWarehouseId,
        item.quantity,
        item.batchNumber,
        item.expiryDate,
        ts,
      );
      if (!firstBatchId) firstBatchId = newBatchId;
    }

    const movementId = recordMovement(db, user, {
      type: 'TRANSFER',
      materialId: input.materialId,
      warehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      batchId: firstBatchId,
      quantity: input.quantity,
      notes: input.notes ?? null,
      createdAt: ts,
    });

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_TRANSFER',
      entity: 'material',
      entityId: input.materialId,
      details: {
        from: input.fromWarehouseId,
        to: input.toWarehouseId,
        quantity: input.quantity,
        movementId,
      },
    });

    return {
      movementId,
      balance: getBalance(db, input.materialId, input.fromWarehouseId),
      consumed,
    };
  });
  return run();
}

export function dispose(
  db: Database,
  user: SessionUser,
  input: { materialId: string; warehouseId: string; quantity: number; reason: string },
): MovementResult {
  const run = db.transaction(() => {
    assertMaterialWarehouse(db, input.materialId, input.warehouseId);
    assertFiscalOpen(db, nowIso());
    const consumed = consumeFifo(db, input.materialId, input.warehouseId, input.quantity);
    const movementId = recordMovement(db, user, {
      type: 'DISPOSE',
      materialId: input.materialId,
      warehouseId: input.warehouseId,
      quantity: input.quantity,
      notes: input.reason,
    });
    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_DISPOSE',
      entity: 'material',
      entityId: input.materialId,
      details: {
        warehouseId: input.warehouseId,
        quantity: input.quantity,
        reason: input.reason,
        consumed,
        movementId,
      },
    });
    return { movementId, balance: getBalance(db, input.materialId, input.warehouseId) };
  });
  return run();
}

/** تسوية الجرد: ضبط الرصيد إلى قيمة محسوبة، مع تسجيل الفرق بشكل صريح. */
export function adjust(
  db: Database,
  user: SessionUser,
  input: { materialId: string; warehouseId: string; countedQuantity: number; reason: string },
): MovementResult {
  const run = db.transaction(() => {
    assertMaterialWarehouse(db, input.materialId, input.warehouseId);
    assertFiscalOpen(db, nowIso());
    const current = getBalance(db, input.materialId, input.warehouseId);
    const delta = input.countedQuantity - current;
    if (delta === 0) {
      throw Object.assign(new Error('NO_ADJUSTMENT_NEEDED'), { code: 'NO_ADJUSTMENT_NEEDED' });
    }
    const ts = nowIso();

    if (delta > 0) {
      addBatch(db, input.materialId, input.warehouseId, delta, 'ADJUST', null, ts);
    } else if (delta < 0) {
      consumeFifo(db, input.materialId, input.warehouseId, -delta);
    }

    const movementId = recordMovement(db, user, {
      type: 'ADJUST',
      materialId: input.materialId,
      warehouseId: input.warehouseId,
      quantity: Math.abs(delta),
      delta,
      notes: input.reason,
      createdAt: ts,
    });

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'STOCK_ADJUST',
      entity: 'material',
      entityId: input.materialId,
      details: { warehouseId: input.warehouseId, before: current, after: input.countedQuantity, reason: input.reason },
    });
    return { movementId, balance: getBalance(db, input.materialId, input.warehouseId) };
  });
  return run();
}

export function getBalance(
  db: Database,
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
  unit: string;
  warehouseId: string;
  warehouseName: string;
  quantity: number;
  minStock: number;
}

export function listStock(
  db: Database,
  filters: { warehouseId?: string | null; query?: string | null; onlyBelowMin?: boolean } = {},
): StockRow[] {
  const like = filters.query ? `%${filters.query.trim()}%` : null;
  return db
    .prepare(
      `SELECT s.material_id AS materialId, m.code AS code, m.name AS materialName, m.unit AS unit,
              s.warehouse_id AS warehouseId, w.name AS warehouseName, s.quantity AS quantity,
              m.min_stock AS minStock
         FROM stock_items s
         JOIN materials m ON m.id = s.material_id
         JOIN warehouses w ON w.id = s.warehouse_id
        WHERE (? IS NULL OR s.warehouse_id = ?)
          AND (? IS NULL OR m.name LIKE ? OR m.code LIKE ?)
          AND (? = 0 OR s.quantity <= m.min_stock)
        ORDER BY (s.quantity <= m.min_stock) DESC, m.name ASC
        LIMIT 2000`,
    )
    .all(
      filters.warehouseId ?? null,
      filters.warehouseId ?? null,
      like,
      like,
      like,
      filters.onlyBelowMin ? 1 : 0,
    ) as StockRow[];
}

/** بحث سريع بالباركود لإدخال/إخراج بسرعة. */
export function findByBarcode(
  db: Database,
  code: string,
): { id: string; name: string; unit: string; code: string } | null {
  const value = code.trim();
  if (!value) return null;
  const row = db
    .prepare(
      `SELECT id, name, unit, code FROM materials
        WHERE status = 'active' AND (barcode = ? OR code = ? COLLATE NOCASE) LIMIT 1`,
    )
    .get(value, value) as { id: string; name: string; unit: string; code: string } | undefined;
  return row ?? null;
}

function assertMaterialWarehouse(
  db: Database,
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
