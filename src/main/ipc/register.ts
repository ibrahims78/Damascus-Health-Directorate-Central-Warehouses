import { ipcMain } from 'electron';
import { z } from 'zod';
import { getDb } from '../db/database';
import { appendAudit, verifyAuditChain } from '../services/audit';
import { changePassword, getSession, login, logout, requireSession } from '../services/auth';
import { issue, listStock, receive } from '../services/inventory';
import { hasPermission, type Permission } from '@shared/permissions';
import { newId, nowIso } from '../services/crypto';
import {
  CHANNELS,
  ERROR_MESSAGES_AR,
  payloadSchemas,
  type Channel,
  type Envelope,
} from './contract';

/** صلاحية مطلوبة لكل قناة — تُفحص في العملية الرئيسية قبل أي تنفيذ. */
const REQUIRED_PERMISSION: Partial<Record<Channel, Permission>> = {
  'materials:list': 'MATERIALS_VIEW',
  'materials:create': 'MATERIALS_MANAGE',
  'warehouses:list': 'WAREHOUSES_VIEW',
  'inventory:stock': 'STOCK_VIEW',
  'inventory:receive': 'STOCK_RECEIVE',
  'inventory:issue': 'STOCK_ISSUE',
  'audit:list': 'AUDIT_VIEW',
  'audit:verify': 'AUDIT_VIEW',
  'dashboard:stats': 'STOCK_VIEW',
};

function fail(code: string, message?: string): Envelope<never> {
  return { ok: false, code, message: message ?? ERROR_MESSAGES_AR[code] ?? ERROR_MESSAGES_AR['INTERNAL_ERROR']! };
}

function toEnvelope(error: unknown): Envelope<never> {
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === 'string' && ERROR_MESSAGES_AR[code]) return fail(code);
  if (error instanceof z.ZodError) return fail('VALIDATION_ERROR');
  // لا تُسرَّب أي تفاصيل تقنية إلى الواجهة.
  console.error('[ipc] unexpected error:', error);
  return fail('INTERNAL_ERROR');
}

async function handle<C extends Channel>(
  channel: C,
  fn: (payload: z.infer<(typeof payloadSchemas)[C]>) => unknown,
): Promise<void> {
  ipcMain.handle(channel, async (_event, rawPayload: unknown): Promise<Envelope<unknown>> => {
    try {
      const parsed = payloadSchemas[channel].parse(rawPayload ?? {});
      const user = getSession();
      const required = REQUIRED_PERMISSION[channel];
      if (required) {
        if (!user) return fail('UNAUTHENTICATED');
        if (!hasPermission(user.role, required)) {
          appendAudit(getDb(), {
            userId: user.id,
            userName: user.username,
            action: 'PERMISSION_DENIED',
            entity: 'ipc',
            entityId: channel,
            details: { permission: required },
          });
          return fail('FORBIDDEN');
        }
      }
      return { ok: true, data: await fn(parsed) };
    } catch (error) {
      return toEnvelope(error);
    }
  });
}

export function registerIpcHandlers(): void {
  // تُفرَّغ القنوات القديمة عند إعادة التسجيل (مفيد أثناء التطوير الساخن).
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);

  void handle('auth:login', (payload) => login(getDb(), payload.username, payload.password));
  void handle('auth:logout', () => {
    const user = getSession();
    if (user) {
      appendAudit(getDb(), {
        userId: user.id,
        userName: user.username,
        action: 'LOGOUT',
        entity: 'user',
        entityId: user.id,
      });
    }
    logout();
    return { ok: true };
  });
  void handle('auth:me', () => getSession());
  void handle('auth:changePassword', (payload) => {
    const user = requireSession();
    changePassword(getDb(), user.id, payload.oldPassword, payload.newPassword);
    return { ok: true };
  });

  void handle('materials:list', (payload) => {
    const db = getDb();
    const like = payload.query ? `%${payload.query}%` : null;
    return db
      .prepare(
        `SELECT id, code, name, unit, category, type, min_stock AS minStock, barcode, status
           FROM materials
          WHERE status = 'active'
            AND (? IS NULL OR name LIKE ? OR code LIKE ? OR barcode LIKE ?)
          ORDER BY name ASC
          LIMIT 500`,
      )
      .all(like, like, like, like);
  });

  void handle('materials:create', (payload) => {
    const db = getDb();
    const exists = db.prepare('SELECT 1 FROM materials WHERE code = ?').get(payload.code);
    if (exists) throw Object.assign(new Error('DUPLICATE_CODE'), { code: 'DUPLICATE_CODE' });
    const id = newId('mat');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO materials (id, code, name, unit, category, type, min_stock, barcode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    ).run(
      id,
      payload.code,
      payload.name,
      payload.unit,
      payload.category ?? null,
      payload.type ?? null,
      payload.minStock,
      payload.barcode ?? null,
      ts,
      ts,
    );
    appendAudit(db, {
      userId: getSession()?.id ?? null,
      userName: getSession()?.username ?? null,
      action: 'MATERIAL_CREATED',
      entity: 'material',
      entityId: id,
      details: { code: payload.code, name: payload.name },
    });
    return { id };
  });

  void handle('warehouses:list', () =>
    getDb()
      .prepare("SELECT id, name, type, category, location FROM warehouses WHERE status = 'active' ORDER BY name")
      .all(),
  );

  void handle('inventory:stock', (payload) =>
    listStock(getDb(), { warehouseId: payload.warehouseId ?? null, query: payload.query ?? null }),
  );

  void handle('inventory:receive', (payload) => {
    const user = requireSession();
    return receive(getDb(), user, {
      materialId: payload.materialId,
      warehouseId: payload.warehouseId,
      quantity: payload.quantity,
      batchNumber: payload.batchNumber ?? null,
      expiryDate: payload.expiryDate ?? null,
      entryNumber: payload.entryNumber ?? null,
      notes: payload.notes ?? null,
    });
  });

  void handle('inventory:issue', (payload) => {
    const user = requireSession();
    return issue(getDb(), user, {
      materialId: payload.materialId,
      warehouseId: payload.warehouseId,
      quantity: payload.quantity,
      notes: payload.notes ?? null,
    });
  });

  void handle('audit:list', (payload) =>
    getDb()
      .prepare(
        `SELECT seq, action, entity, entity_id AS entityId, user_name AS userName, created_at AS createdAt
           FROM audit_log ORDER BY seq DESC LIMIT ?`,
      )
      .all(payload.limit),
  );

  void handle('audit:verify', () => verifyAuditChain(getDb()));

  void handle('dashboard:stats', () => {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM materials WHERE status = 'active')                       AS materials,
           (SELECT COUNT(*) FROM warehouses WHERE status = 'active')                      AS warehouses,
           (SELECT COALESCE(SUM(quantity), 0) FROM stock_items)                           AS totalQuantity,
           (SELECT COUNT(*) FROM stock_items WHERE quantity <= (SELECT min_stock FROM materials m WHERE m.id = material_id)) AS belowMin,
           (SELECT COUNT(*) FROM movements WHERE created_at >= datetime('now', '-1 day'))  AS movementsToday`,
      )
      .get();
    return row;
  });
}
