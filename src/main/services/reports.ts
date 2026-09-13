import type { Database } from '../db/sqlite';

/** التقارير: كلها قراءة فقط من القاعدة المحلية، وقابلة للتصدير إلى ملف. */

export type ReportKind =
  | 'stock_summary'
  | 'movements'
  | 'below_min'
  | 'expiring_soon'
  | 'custody_open'
  | 'audit_trail';

export interface ReportRequest {
  kind: ReportKind;
  warehouseId?: string | null;
  from?: string | null;
  to?: string | null;
  days?: number | null;
  limit?: number | null;
}

export function runReport(db: Database, request: ReportRequest): unknown[] {
  const limit = Math.min(Math.max(request.limit ?? 5000, 1), 50000);
  switch (request.kind) {
    case 'stock_summary':
      return db
        .prepare(
          `SELECT m.code AS "الرمز", m.name AS "المادة", w.name AS "المستودع", m.unit AS "الوحدة",
                  s.quantity AS "الرصيد", m.min_stock AS "الحد الأدنى",
                  CASE WHEN s.quantity <= m.min_stock THEN 'تحت الحد' ELSE 'طبيعي' END AS "الحالة"
             FROM stock_items s
             JOIN materials m ON m.id = s.material_id
             JOIN warehouses w ON w.id = s.warehouse_id
            WHERE (? IS NULL OR s.warehouse_id = ?)
            ORDER BY m.name`,
        )
        .all(request.warehouseId ?? null, request.warehouseId ?? null);

    case 'movements':
      return db
        .prepare(
          `SELECT mv.created_at AS "التاريخ", mv.type AS "النوع", m.code AS "الرمز", m.name AS "المادة",
                  w.name AS "المستودع", mv.quantity AS "الكمية", mv.notes AS "ملاحظات", u.full_name AS "المستخدم"
             FROM movements mv
             JOIN materials m ON m.id = mv.material_id
             JOIN warehouses w ON w.id = mv.warehouse_id
             JOIN users u ON u.id = mv.user_id
            WHERE (? IS NULL OR mv.created_at >= ?)
              AND (? IS NULL OR mv.created_at <= ?)
              AND (? IS NULL OR mv.warehouse_id = ?)
            ORDER BY mv.created_at DESC
            LIMIT ?`,
        )
        .all(
          request.from ?? null,
          request.from ?? null,
          request.to ?? null,
          request.to ?? null,
          request.warehouseId ?? null,
          request.warehouseId ?? null,
          limit,
        );

    case 'below_min':
      return db
        .prepare(
          `SELECT m.code AS "الرمز", m.name AS "المادة", w.name AS "المستودع", s.quantity AS "الرصيد",
                  m.min_stock AS "الحد الأدنى", (m.min_stock - s.quantity) AS "النقص"
             FROM stock_items s
             JOIN materials m ON m.id = s.material_id
             JOIN warehouses w ON w.id = s.warehouse_id
            WHERE s.quantity <= m.min_stock
            ORDER BY (m.min_stock - s.quantity) DESC`,
        )
        .all();

    case 'expiring_soon':
      return db
        .prepare(
          `SELECT m.code AS "الرمز", m.name AS "المادة", w.name AS "المستودع", b.batch_number AS "الدفعة",
                  b.quantity AS "الكمية", b.expiry_date AS "تاريخ الصلاحية",
                  CAST(julianday(b.expiry_date) - julianday('now') AS INTEGER) AS "الأيام المتبقية"
             FROM batches b
             JOIN materials m ON m.id = b.material_id
             JOIN warehouses w ON w.id = b.warehouse_id
            WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL
              AND julianday(b.expiry_date) - julianday('now') <= ?
            ORDER BY b.expiry_date ASC
            LIMIT ?`,
        )
        .all(request.days ?? 90, limit);

    case 'custody_open':
      return db
        .prepare(
          `SELECT c.created_at AS "التاريخ", m.name AS "المادة", w.name AS "المستودع",
                  c.custodian_name AS "العهدة", c.custodian_job AS "الوظيفة",
                  c.quantity AS "الكمية", c.quantity_returned AS "المُعاد",
                  (c.quantity - c.quantity_returned) AS "المتبقي"
             FROM personal_custody c
             JOIN materials m ON m.id = c.material_id
             JOIN warehouses w ON w.id = c.warehouse_id
            WHERE c.status = 'active'
            ORDER BY c.created_at DESC`,
        )
        .all();

    case 'audit_trail':
      return db
        .prepare(
          `SELECT seq AS "#", created_at AS "التاريخ", user_name AS "المستخدم", action AS "الإجراء",
                  entity AS "الكيان", entity_id AS "المعرّف", details AS "التفاصيل"
             FROM audit_log ORDER BY seq DESC LIMIT ?`,
        )
        .all(limit);

    default:
      return [];
  }
}

export const REPORT_TITLES_AR: Record<ReportKind, string> = {
  stock_summary: 'تقرير الأرصدة',
  movements: 'سجل الحركات',
  below_min: 'المواد تحت الحد الأدنى',
  expiring_soon: 'الدفعات القريبة الانتهاء',
  custody_open: 'العهد الشخصية المفتوحة',
  audit_trail: 'سجل التدقيق',
};

/** تحويل النتيجة إلى CSV متوافق مع Excel العربي (BOM + فاصلة منقوطة). */
export function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return '\uFEFF';
  const first = rows[0] as Record<string, unknown>;
  const headers = Object.keys(first);
  const escape = (value: unknown): string => {
    const text = value === null || value === undefined ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(escape).join(';')];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(headers.map((header) => escape(record[header])).join(';'));
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
