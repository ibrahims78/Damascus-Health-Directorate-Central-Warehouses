import { app, dialog, ipcMain } from 'electron';
import { writeFileSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { getDb } from '../db/database';
import { appendAudit, verifyAuditChain } from '../services/audit';
import { changePassword, getSession, login, logout, requireSession } from '../services/auth';
import {
  adjust,
  dispose,
  findByBarcode,
  issue,
  listStock,
  receive,
  transfer,
} from '../services/inventory';
import {
  createMaterial,
  listMaterials,
  listSuppliers,
  listWarehouses,
  saveSupplier,
  saveWarehouse,
  updateMaterial,
} from '../services/catalog';
import { assignCustody, listCustody, returnCustody, revealNationalId } from '../services/custody';
import { REPORT_TITLES_AR, runReport, toCsv } from '../services/reports';
import {
  createUser,
  listRoles,
  listUsers,
  resetPassword,
  setUserRole,
  setUserStatus,
} from '../services/users';
import { createNotice, deleteNotice, listNotices } from '../services/notices';
import { createBackup, listBackups, restoreBackup } from '../services/backup';
import { getAllSettings, setSettings } from '../services/settings';
import { hasPermission, type Permission } from '@shared/permissions';
import { CHANNELS, ERROR_MESSAGES_AR, payloadSchemas, type Channel, type Envelope } from './contract';

export interface RuntimePaths {
  dbPath: string;
  backupDir: string;
}

const REQUIRED_PERMISSION: Partial<Record<Channel, Permission>> = {
  'materials:list': 'MATERIALS_VIEW',
  'materials:create': 'MATERIALS_MANAGE',
  'materials:update': 'MATERIALS_MANAGE',
  'warehouses:list': 'WAREHOUSES_VIEW',
  'warehouses:save': 'WAREHOUSES_MANAGE',
  'suppliers:list': 'SUPPLIERS_VIEW',
  'suppliers:save': 'SUPPLIERS_MANAGE',
  'inventory:stock': 'STOCK_VIEW',
  'inventory:receive': 'STOCK_RECEIVE',
  'inventory:issue': 'STOCK_ISSUE',
  'inventory:transfer': 'STOCK_TRANSFER',
  'inventory:dispose': 'STOCK_DISPOSE',
  'inventory:adjust': 'STOCK_VIEW',
  'inventory:findByBarcode': 'STOCK_VIEW',
  'custody:list': 'CUSTODY_VIEW',
  'custody:assign': 'CUSTODY_MANAGE',
  'custody:return': 'CUSTODY_MANAGE',
  'custody:revealId': 'CUSTODY_MANAGE',
  'reports:run': 'REPORTS_VIEW',
  'reports:export': 'REPORTS_EXPORT',
  'users:list': 'USERS_VIEW',
  'users:create': 'USERS_MANAGE',
  'users:setStatus': 'USERS_MANAGE',
  'users:setRole': 'PERMISSIONS_MANAGE',
  'users:resetPassword': 'USERS_MANAGE',
  'roles:list': 'USERS_VIEW',
  'notices:list': 'MESSAGES_USE',
  'notices:create': 'MESSAGES_USE',
  'notices:delete': 'MESSAGES_USE',
  'audit:list': 'AUDIT_VIEW',
  'audit:verify': 'AUDIT_VIEW',
  'settings:get': 'MATERIALS_VIEW',
  'settings:set': 'SETTINGS_MANAGE',
  'backup:list': 'BACKUP_MANAGE',
  'backup:create': 'BACKUP_MANAGE',
  'backup:restore': 'BACKUP_MANAGE',
  'backup:export': 'BACKUP_MANAGE',
  'dashboard:stats': 'STOCK_VIEW',
};

function fail(code: string): Envelope<never> {
  return {
    ok: false,
    code,
    message: ERROR_MESSAGES_AR[code] ?? ERROR_MESSAGES_AR['INTERNAL_ERROR']!,
  };
}

function toEnvelope(error: unknown): Envelope<never> {
  if (error instanceof z.ZodError) return fail('VALIDATION_ERROR');
  const code = (error as { code?: string } | null)?.code;
  if (typeof code === 'string' && ERROR_MESSAGES_AR[code]) return fail(code);
  // لا تُسرَّب أي تفاصيل تقنية إلى الواجهة.
  console.error('[ipc] unexpected error:', error);
  return fail('INTERNAL_ERROR');
}

async function handle<C extends Channel>(
  channel: C,
  fn: (payload: z.infer<(typeof payloadSchemas)[C]>, paths: RuntimePaths) => unknown,
  paths: RuntimePaths,
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
      return { ok: true, data: await fn(parsed, paths) };
    } catch (error) {
      return toEnvelope(error);
    }
  });
}

export function registerIpcHandlers(paths: RuntimePaths): void {
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);

  const h = <C extends Channel>(
    channel: C,
    fn: (payload: z.infer<(typeof payloadSchemas)[C]>, paths: RuntimePaths) => unknown,
  ) => void handle(channel, fn, paths);

  /* ------------------------------- المصادقة ------------------------------- */
  h('auth:login', (p) => login(getDb(), p.username, p.password));
  h('auth:logout', () => {
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
  h('auth:me', () => getSession());
  h('auth:changePassword', (p) => {
    const user = requireSession();
    changePassword(getDb(), user.id, p.oldPassword, p.newPassword);
    return { ok: true };
  });

  /* --------------------------------- الكتالوج ------------------------------- */
  h('materials:list', (p) => listMaterials(getDb(), { query: p.query ?? null }));
  h('materials:create', (p) => createMaterial(getDb(), requireSession(), p));
  h('materials:update', (p) => updateMaterial(getDb(), requireSession(), p));
  h('warehouses:list', () => listWarehouses(getDb()));
  h('warehouses:save', (p) => saveWarehouse(getDb(), requireSession(), p));
  h('suppliers:list', () => listSuppliers(getDb()));
  h('suppliers:save', (p) => saveSupplier(getDb(), requireSession(), p));

  /* --------------------------------- المخزون -------------------------------- */
  h('inventory:stock', (p) =>
    listStock(getDb(), {
      warehouseId: p.warehouseId ?? null,
      query: p.query ?? null,
      onlyBelowMin: p.onlyBelowMin ?? false,
    }),
  );
  h('inventory:receive', (p) => receive(getDb(), requireSession(), p));
  h('inventory:issue', (p) => issue(getDb(), requireSession(), p));
  h('inventory:transfer', (p) => transfer(getDb(), requireSession(), p));
  h('inventory:dispose', (p) => dispose(getDb(), requireSession(), p));
  h('inventory:adjust', (p) => adjust(getDb(), requireSession(), p));
  h('inventory:findByBarcode', (p) => findByBarcode(getDb(), p.code));

  /* ---------------------------------- العهد --------------------------------- */
  h('custody:list', (p) => listCustody(getDb(), { status: p.status ?? null }));
  h('custody:assign', (p) => assignCustody(getDb(), requireSession(), p));
  h('custody:return', (p) => returnCustody(getDb(), requireSession(), p));
  h('custody:revealId', (p) => revealNationalId(getDb(), requireSession(), p.custodyId));

  /* -------------------------------- التقارير -------------------------------- */
  h('reports:run', (p) => runReport(getDb(), p));
  h('reports:export', async (p) => {
    const rows = runReport(getDb(), p);
    const defaultName = `${REPORT_TITLES_AR[p.kind]}-${new Date().toISOString().slice(0, 10)}.csv`;
    const result = await dialog.showSaveDialog({
      title: 'تصدير التقرير',
      defaultPath: defaultName,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) throw Object.assign(new Error('EXPORT_CANCELLED'), { code: 'EXPORT_CANCELLED' });
    writeFileSync(result.filePath, toCsv(rows), 'utf8');
    appendAudit(getDb(), {
      userId: getSession()?.id ?? null,
      userName: getSession()?.username ?? null,
      action: 'REPORT_EXPORTED',
      entity: 'report',
      entityId: p.kind,
      details: { file: basename(result.filePath), rows: rows.length },
    });
    return { file: result.filePath, rows: rows.length };
  });

  /* ------------------------------ المستخدمون -------------------------------- */
  h('users:list', () => listUsers(getDb()));
  h('users:create', (p) => createUser(getDb(), requireSession(), { ...p, warehouseIds: p.warehouseIds ?? [] }));
  h('users:setStatus', (p) => setUserStatus(getDb(), requireSession(), p));
  h('users:setRole', (p) => setUserRole(getDb(), requireSession(), p));
  h('users:resetPassword', (p) => resetPassword(getDb(), requireSession(), p));
  h('roles:list', () => listRoles(getDb()));

  /* ------------------------------- التعميمات -------------------------------- */
  h('notices:list', (p) => listNotices(getDb(), p.limit ?? 100));
  h('notices:create', (p) => createNotice(getDb(), requireSession(), p));
  h('notices:delete', (p) => deleteNotice(getDb(), requireSession(), p));

  /* --------------------------------- التدقيق -------------------------------- */
  h('audit:list', (p) =>
    getDb()
      .prepare(
        `SELECT seq, action, entity, entity_id AS entityId, user_name AS userName, created_at AS createdAt
           FROM audit_log ORDER BY seq DESC LIMIT ?`,
      )
      .all(p.limit),
  );
  h('audit:verify', () => verifyAuditChain(getDb()));

  /* -------------------------------- الإعدادات -------------------------------- */
  h('settings:get', () => getAllSettings(getDb()));
  h('settings:set', (p) => setSettings(getDb(), requireSession(), p));

  /* ------------------------------ النسخ الاحتياطي ---------------------------- */
  h('backup:list', (_p, runtime) => listBackups(runtime.backupDir));
  h('backup:create', (_p, runtime) => createBackup(getDb(), runtime.dbPath, runtime.backupDir, requireSession()));
  h('backup:export', async (p) => {
    const result = await dialog.showSaveDialog({
      title: 'حفظ نسخة احتياطية',
      defaultPath: basename(p.file),
      filters: [{ name: 'قاعدة بيانات', extensions: ['db'] }],
    });
    if (result.canceled || !result.filePath) throw Object.assign(new Error('EXPORT_CANCELLED'), { code: 'EXPORT_CANCELLED' });
    copyFileSync(p.file, result.filePath);
    appendAudit(getDb(), {
      userId: getSession()?.id ?? null,
      userName: getSession()?.username ?? null,
      action: 'BACKUP_EXPORTED',
      entity: 'backup',
      entityId: basename(result.filePath),
    });
    return { file: result.filePath };
  });
  h('backup:restore', (p, runtime) => {
    const user = requireSession();
    const confirm = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['إلغاء', 'استعادة وإعادة التشغيل'],
      defaultId: 0,
      cancelId: 0,
      title: 'تأكيد الاستعادة',
      message: 'سيتم استبدال قاعدة البيانات الحالية بالنسخة المختارة، ثم إعادة تشغيل التطبيق.',
      detail: 'تُنشأ نسخة أمان من البيانات الحالية قبل الاستبدال.',
    });
    if (confirm !== 1) throw Object.assign(new Error('EXPORT_CANCELLED'), { code: 'EXPORT_CANCELLED' });
    const result = restoreBackup(getDb(), runtime.dbPath, p.file, runtime.backupDir, user);
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 800);
    return result;
  });

  /* ------------------------------ لوحة المعلومات ---------------------------- */
  h('dashboard:stats', () =>
    getDb()
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM materials WHERE status = 'active')                        AS materials,
           (SELECT COUNT(*) FROM warehouses WHERE status = 'active')                       AS warehouses,
           (SELECT COALESCE(SUM(quantity), 0) FROM stock_items)                            AS totalQuantity,
           (SELECT COUNT(*) FROM stock_items s JOIN materials m ON m.id = s.material_id
             WHERE s.quantity <= m.min_stock)                                              AS belowMin,
           (SELECT COUNT(*) FROM movements WHERE created_at >= datetime('now', '-1 day'))   AS movementsToday,
           (SELECT COUNT(*) FROM personal_custody WHERE status = 'active')                  AS openCustody,
           (SELECT COUNT(*) FROM batches WHERE quantity > 0 AND expiry_date IS NOT NULL
             AND julianday(expiry_date) - julianday('now') <= 90)                           AS expiringSoon`,
      )
      .get(),
  );
}

export function backupFileIn(dir: string, file: string): string {
  return join(dir, basename(file));
}
