import type { Database } from '../db/sqlite';
import { appendAudit } from './audit';
import { getFieldKey } from '../db/database';
import { decryptField, encryptField, newId, nowIso } from './crypto';
import { addBatch, consumeFifo, getBalance } from './inventory';
import type { SessionUser } from './auth';

/** العهد الشخصية: تُخصم من المستودع وتُعاد إليه عند الإرجاع، والرقم الوطني مشفَّر. */

export interface AssignInput {
  materialId: string;
  warehouseId: string;
  custodianName: string;
  custodianJob?: string | null;
  nationalId?: string | null;
  quantity: number;
  notes?: string | null;
}

export async function assignCustody(
  db: Database,
  user: SessionUser,
  input: AssignInput,
): Promise<{ id: string; balance: number }> {
  const nidEnc = input.nationalId ? await encryptField(input.nationalId, getFieldKey()) : null;
  const id = newId('cus');
  const ts = nowIso();

  const run = db.transaction(() => {
    const consumed = consumeFifo(db, input.materialId, input.warehouseId, input.quantity);

    db.prepare(
      `INSERT INTO personal_custody (id, material_id, warehouse_id, custodian_name, custodian_job,
                                     custodian_nid_enc, quantity, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      input.materialId,
      input.warehouseId,
      input.custodianName.trim(),
      input.custodianJob ?? null,
      nidEnc,
      input.quantity,
      input.notes ?? null,
      ts,
    );

    db.prepare(
      `INSERT INTO movements (id, type, material_id, warehouse_id, quantity, notes, user_id, created_at)
       VALUES (?, 'CUSTODY_OUT', ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('mov'),
      input.materialId,
      input.warehouseId,
      input.quantity,
      `عهدة: ${input.custodianName}`,
      user.id,
      ts,
    );

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'CUSTODY_ASSIGNED',
      entity: 'custody',
      entityId: id,
      details: { ...input, nationalId: input.nationalId ? '***' : null, consumed },
    });

    return { id, balance: getBalance(db, input.materialId, input.warehouseId) };
  });

  return run();
}

export function returnCustody(
  db: Database,
  user: SessionUser,
  input: { custodyId: string; quantity: number; notes?: string | null },
): { ok: true; balance: number } {
  const ts = nowIso();
  const run = db.transaction(() => {
    const row = db
      .prepare('SELECT * FROM personal_custody WHERE id = ?')
      .get(input.custodyId) as
      | {
          id: string;
          material_id: string;
          warehouse_id: string;
          quantity: number;
          quantity_returned: number;
          status: string;
        }
      | undefined;
    if (!row) throw Object.assign(new Error('CUSTODY_NOT_FOUND'), { code: 'CUSTODY_NOT_FOUND' });
    if (row.status !== 'active') {
      throw Object.assign(new Error('CUSTODY_ALREADY_CLOSED'), { code: 'CUSTODY_ALREADY_CLOSED' });
    }
    const outstanding = row.quantity - row.quantity_returned;
    if (input.quantity > outstanding) {
      throw Object.assign(new Error('CUSTODY_RETURN_EXCEEDS'), {
        code: 'CUSTODY_RETURN_EXCEEDS',
        details: { outstanding },
      });
    }

    addBatch(db, row.material_id, row.warehouse_id, input.quantity, 'CUSTODY-RETURN', null, ts);

    const returned = row.quantity_returned + input.quantity;
    db.prepare(
      'UPDATE personal_custody SET quantity_returned = ?, status = ?, returned_at = ? WHERE id = ?',
    ).run(returned, returned >= row.quantity ? 'closed' : 'active', ts, row.id);

    db.prepare(
      `INSERT INTO movements (id, type, material_id, warehouse_id, quantity, notes, user_id, created_at)
       VALUES (?, 'CUSTODY_IN', ?, ?, ?, ?, ?, ?)`,
    ).run(newId('mov'), row.material_id, row.warehouse_id, input.quantity, input.notes ?? 'إرجاع عهدة', user.id, ts);

    appendAudit(db, {
      userId: user.id,
      userName: user.username,
      action: 'CUSTODY_RETURNED',
      entity: 'custody',
      entityId: row.id,
      details: { quantity: input.quantity, remaining: row.quantity - returned },
    });

    return { ok: true as const, balance: getBalance(db, row.material_id, row.warehouse_id) };
  });
  return run();
}

export interface CustodyRow {
  id: string;
  materialId: string;
  materialName: string;
  warehouseName: string;
  custodianName: string;
  custodianJob: string | null;
  quantity: number;
  quantityReturned: number;
  status: string;
  createdAt: string;
  hasNationalId: number;
}

export function listCustody(
  db: Database,
  filters: { status?: string | null } = {},
): CustodyRow[] {
  return db
    .prepare(
      `SELECT c.id, c.material_id AS materialId, m.name AS materialName, w.name AS warehouseName,
              c.custodian_name AS custodianName, c.custodian_job AS custodianJob, c.quantity,
              c.quantity_returned AS quantityReturned, c.status, c.created_at AS createdAt,
              (c.custodian_nid_enc IS NOT NULL) AS hasNationalId
         FROM personal_custody c
         JOIN materials m ON m.id = c.material_id
         JOIN warehouses w ON w.id = c.warehouse_id
        WHERE (? IS NULL OR c.status = ?)
        ORDER BY c.created_at DESC
        LIMIT 1000`,
    )
    .all(filters.status ?? null, filters.status ?? null) as CustodyRow[];
}

/** كشف الرقم الوطني يتطلب صلاحية CUSTODY_MANAGE ويُسجَّل في التدقيق. */
export async function revealNationalId(
  db: Database,
  user: SessionUser,
  custodyId: string,
): Promise<{ nationalId: string | null }> {
  const row = db
    .prepare('SELECT custodian_nid_enc AS enc FROM personal_custody WHERE id = ?')
    .get(custodyId) as { enc: string | null } | undefined;
  if (!row?.enc) return { nationalId: null };
  const nationalId = await decryptField(row.enc, getFieldKey());
  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'CUSTODY_ID_REVEALED',
    entity: 'custody',
    entityId: custodyId,
  });
  return { nationalId };
}
