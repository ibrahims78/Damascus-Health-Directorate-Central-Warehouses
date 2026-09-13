import type { Database } from '../db/sqlite';
import { nowIso } from './crypto';
import { appendAudit } from './audit';
import type { SessionUser } from './auth';

/** إعدادات المنظومة — كل القيم نصية ومُوثَّقة عبر سجل التدقيق عند تغييرها. */

export const SETTING_KEYS = [
  'org_name_ar',
  'org_name_en',
  'org_address',
  'org_phone',
  'fiscal_closed_until',
  'low_stock_alert',
  'barcode_prefix',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const DEFAULTS: Record<SettingKey, string> = {
  org_name_ar: 'مستودعات مديرية صحة دمشق المركزية',
  org_name_en: 'Damascus Health Directorate Central Warehouses',
  org_address: 'دمشق — مجمع المديرية',
  org_phone: '',
  fiscal_closed_until: '',
  low_stock_alert: '1',
  barcode_prefix: '',
};

export function getAllSettings(db: Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const result: Record<string, string> = { ...DEFAULTS };
  for (const row of rows) result[row.key] = row.value;
  return result;
}

/** تاريخ إغلاق السنة المالية — لا تُقبل حركة بتاريخ أقدم منه. */
export function getFiscalClosedUntil(db: Database): string | null {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'fiscal_closed_until'")
    .get() as { value: string } | undefined;
  const value = row?.value?.trim();
  return value ? value : null;
}

export function setSettings(
  db: Database,
  user: SessionUser,
  patch: Partial<Record<SettingKey, string>>,
): Record<string, string> {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );
  const run = db.transaction(() => {
    for (const key of SETTING_KEYS) {
      const value = patch[key];
      if (value === undefined) continue;
      upsert.run(key, String(value), nowIso());
    }
  });
  run();

  appendAudit(db, {
    userId: user.id,
    userName: user.username,
    action: 'SETTINGS_UPDATED',
    entity: 'settings',
    entityId: null,
    details: patch,
  });

  return getAllSettings(db);
}
