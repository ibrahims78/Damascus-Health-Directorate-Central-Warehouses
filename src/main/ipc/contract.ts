import { z } from 'zod';

/**
 * عقد الاتصال بين الواجهة والعملية الرئيسية.
 * كل قناة مُعرَّفة صراحةً، وكل حِمل يُتحقَّق منه بـ zod قبل التنفيذ.
 */

export const CHANNELS = [
  'auth:login',
  'auth:logout',
  'auth:me',
  'auth:changePassword',
  'materials:list',
  'materials:create',
  'materials:update',
  'warehouses:list',
  'warehouses:save',
  'suppliers:list',
  'suppliers:save',
  'inventory:stock',
  'inventory:receive',
  'inventory:issue',
  'inventory:transfer',
  'inventory:dispose',
  'inventory:adjust',
  'inventory:findByBarcode',
  'custody:list',
  'custody:assign',
  'custody:return',
  'custody:revealId',
  'reports:run',
  'reports:export',
  'users:list',
  'users:create',
  'users:setStatus',
  'users:setRole',
  'users:resetPassword',
  'roles:list',
  'notices:list',
  'notices:create',
  'notices:delete',
  'audit:list',
  'audit:verify',
  'settings:get',
  'settings:set',
  'backup:list',
  'backup:create',
  'backup:restore',
  'backup:export',
  'dashboard:stats',
] as const;

export type Channel = (typeof CHANNELS)[number];

const text = z.string().trim().min(1);
const optText = z.string().trim().max(500).nullish();
const qty = z.number().int().positive().max(10_000_000);
const nonNegInt = z.number().int().min(0).max(10_000_000);

export const payloadSchemas = {
  'auth:login': z.object({ username: text, password: z.string().min(1).max(200) }),
  'auth:logout': z.object({}),
  'auth:me': z.object({}),
  'auth:changePassword': z.object({
    oldPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
  }),

  'materials:list': z.object({ query: optText, onlyBelowMin: z.boolean().nullish() }),
  'materials:create': z.object({
    code: text.max(60),
    name: text.max(200),
    unit: text.max(30),
    category: optText,
    classification: optText,
    type: optText,
    minStock: nonNegInt.nullish(),
    maxStock: nonNegInt.nullish(),
    barcode: optText,
  }),
  'materials:update': z.object({
    id: text,
    code: text.max(60),
    name: text.max(200),
    unit: text.max(30),
    category: optText,
    classification: optText,
    type: optText,
    minStock: nonNegInt.nullish(),
    maxStock: nonNegInt.nullish(),
    barcode: optText,
    status: z.enum(['active', 'archived']).nullish(),
  }),

  'warehouses:list': z.object({}),
  'warehouses:save': z.object({
    id: z.string().trim().min(1).nullish(),
    name: text.max(200),
    type: text.max(50),
    category: optText,
    location: optText,
    managerId: optText,
    capacity: nonNegInt.nullish(),
    parentId: optText,
  }),

  'suppliers:list': z.object({}),
  'suppliers:save': z.object({
    id: z.string().trim().min(1).nullish(),
    name: text.max(200),
    contact: optText,
    phone: optText,
    address: optText,
    sourceType: optText,
  }),

  'inventory:stock': z.object({ warehouseId: optText, query: optText, onlyBelowMin: z.boolean().nullish() }),
  'inventory:receive': z.object({
    materialId: text,
    warehouseId: text,
    quantity: qty,
    batchNumber: optText,
    expiryDate: optText,
    entryNumber: optText,
    notes: optText,
    supplierId: optText,
  }),
  'inventory:issue': z.object({
    materialId: text,
    warehouseId: text,
    quantity: qty,
    recipient: optText,
    entryNumber: optText,
    notes: optText,
  }),
  'inventory:transfer': z.object({
    materialId: text,
    fromWarehouseId: text,
    toWarehouseId: text,
    quantity: qty,
    notes: optText,
  }),
  'inventory:dispose': z.object({
    materialId: text,
    warehouseId: text,
    quantity: qty,
    reason: text.max(500),
  }),
  'inventory:adjust': z.object({
    materialId: text,
    warehouseId: text,
    countedQuantity: nonNegInt,
    reason: text.max(500),
  }),
  'inventory:findByBarcode': z.object({ code: text.max(120) }),

  'custody:list': z.object({ status: z.enum(['active', 'closed']).nullish() }),
  'custody:assign': z.object({
    materialId: text,
    warehouseId: text,
    custodianName: text.max(200),
    custodianJob: optText,
    nationalId: optText,
    quantity: qty,
    notes: optText,
  }),
  'custody:return': z.object({ custodyId: text, quantity: qty, notes: optText }),
  'custody:revealId': z.object({ custodyId: text }),

  'reports:run': z.object({
    kind: z.enum(['stock_summary', 'movements', 'below_min', 'expiring_soon', 'custody_open', 'audit_trail']),
    warehouseId: optText,
    from: optText,
    to: optText,
    days: z.number().int().min(1).max(3650).nullish(),
    limit: z.number().int().min(1).max(50_000).nullish(),
  }),
  'reports:export': z.object({
    kind: z.enum(['stock_summary', 'movements', 'below_min', 'expiring_soon', 'custody_open', 'audit_trail']),
    warehouseId: optText,
    from: optText,
    to: optText,
    days: z.number().int().min(1).max(3650).nullish(),
    limit: z.number().int().min(1).max(50_000).nullish(),
  }),

  'users:list': z.object({}),
  'users:create': z.object({
    username: text.max(60),
    fullName: text.max(200),
    roleId: text.max(40),
    jobTitle: optText,
    phone: optText,
    warehouseIds: z.array(z.string()).max(200).nullish(),
    activate: z.boolean().nullish(),
  }),
  'users:setStatus': z.object({
    userId: text,
    status: z.enum(['active', 'pending', 'disabled']),
  }),
  'users:setRole': z.object({
    userId: text,
    roleId: text.max(40),
    warehouseIds: z.array(z.string()).max(200).default([]),
  }),
  'users:resetPassword': z.object({ userId: text }),
  'roles:list': z.object({}),

  'notices:list': z.object({ limit: z.number().int().min(1).max(500).nullish() }),
  'notices:create': z.object({
    title: text.max(200),
    body: text.max(4000),
    kind: z.enum(['circular', 'alert']).nullish(),
  }),
  'notices:delete': z.object({ id: text }),

  'audit:list': z.object({ limit: z.number().int().min(1).max(1000).default(200) }),
  'audit:verify': z.object({}),

  'settings:get': z.object({}),
  'settings:set': z.object({
    org_name_ar: z.string().max(200).optional(),
    org_name_en: z.string().max(200).optional(),
    org_address: z.string().max(300).optional(),
    org_phone: z.string().max(60).optional(),
    fiscal_closed_until: z.string().max(30).optional(),
    low_stock_alert: z.string().max(5).optional(),
    barcode_prefix: z.string().max(30).optional(),
  }),

  'backup:list': z.object({}),
  'backup:create': z.object({}),
  'backup:restore': z.object({ file: text, confirmation: z.literal('RESTORE') }),
  'backup:export': z.object({ file: text }),

  'dashboard:stats': z.object({}),
} satisfies Record<Channel, z.ZodTypeAny>;

export type Payload<C extends Channel> = z.infer<(typeof payloadSchemas)[C]>;

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; code: string; message: string };
export type Envelope<T> = Ok<T> | Err;

export const ERROR_MESSAGES_AR: Record<string, string> = {
  UNAUTHENTICATED: 'انتهت الجلسة. يرجى تسجيل الدخول من جديد.',
  FORBIDDEN: 'لا تملك الصلاحية لتنفيذ هذه العملية.',
  INVALID_CREDENTIALS: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
  ACCOUNT_LOCKED: 'الحساب مقفل مؤقتًا بعد محاولات فاشلة متكررة.',
  ACCOUNT_DISABLED: 'الحساب غير مُفعَّل. يرجى مراجعة مدير النظام.',
  WEAK_PASSWORD: 'كلمة المرور ضعيفة: المطلوب 10 محارف على الأقل.',
  INSUFFICIENT_STOCK: 'الرصيد غير كافٍ لإتمام العملية.',
  MATERIAL_NOT_FOUND: 'المادة غير موجودة أو غير مُفعَّلة.',
  WAREHOUSE_NOT_FOUND: 'المستودع غير موجود أو غير مُفعَّل.',
  DUPLICATE_CODE: 'رمز المادة مستخدم مسبقًا.',
  DUPLICATE_BARCODE: 'الباركود مستخدم لمادة أخرى.',
  DUPLICATE_USERNAME: 'اسم المستخدم مستخدم مسبقًا.',
  INVALID_ROLE: 'الدور المحدد غير صالح.',
  INVALID_STATUS: 'الحالة المحددة غير صالحة.',
  CANNOT_DISABLE_SELF: 'لا يمكنك تعطيل حسابك الحالي.',
  CANNOT_DEMOTE_SELF: 'لا يمكنك تخفيض دور حسابك الحالي.',
  LAST_ADMIN_PROTECTED: 'لا يمكن إزالة آخر مدير نظام مُفعَّل.',
  CUSTODY_NOT_FOUND: 'سجل العهدة غير موجود.',
  CUSTODY_ALREADY_CLOSED: 'هذه العهدة مُغلقة مسبقًا.',
  CUSTODY_RETURN_EXCEEDS: 'الكمية المُعادة تتجاوز المتبقي في العهدة.',
  FISCAL_PERIOD_CLOSED: 'الفترة المالية مُغلقة: لا تُقبل حركة بتاريخ أقدم من تاريخ الإغلاق.',
  SAME_WAREHOUSE: 'لا يمكن النقل إلى المستودع نفسه.',
  NO_ADJUSTMENT_NEEDED: 'الرصيد مطابق للجرد، لا حاجة لتسوية.',
  DB_INTEGRITY_FAILED: 'فحص سلامة قاعدة البيانات فشل — أُلغيت العملية.',
  BACKUP_NOT_FOUND: 'ملف النسخة الاحتياطية غير موجود.',
  EXPORT_CANCELLED: 'أُلغيت عملية التصدير.',
  VALIDATION_ERROR: 'بيانات غير صحيحة. يرجى مراجعة الحقول.',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع. لم تُنفَّذ العملية.',
};
