import { z } from 'zod';

/**
 * عقد الاتصال بين الواجهة والعملية الرئيسية.
 * كل قناة مُعرَّفة صراحةً، وكل حِمل يُتحقَّق منه بـ zod قبل التنفيذ.
 * لا تُقبل أي قناة غير مذكورة هنا، ولا يُنفَّذ أي منطق في الواجهة.
 */

export const CHANNELS = [
  'auth:login',
  'auth:logout',
  'auth:me',
  'auth:changePassword',
  'materials:list',
  'materials:create',
  'warehouses:list',
  'inventory:stock',
  'inventory:receive',
  'inventory:issue',
  'audit:list',
  'audit:verify',
  'dashboard:stats',
] as const;

export type Channel = (typeof CHANNELS)[number];

const nonEmpty = z.string().trim().min(1);
const optionalText = z.string().trim().max(500).nullish();

export const payloadSchemas = {
  'auth:login': z.object({ username: nonEmpty, password: z.string().min(1).max(200) }),
  'auth:logout': z.object({}),
  'auth:me': z.object({}),
  'auth:changePassword': z.object({
    oldPassword: z.string().min(1).max(200),
    newPassword: z.string().min(10).max(200),
  }),
  'materials:list': z.object({ query: optionalText }).default({ query: null }),
  'materials:create': z.object({
    code: nonEmpty.max(60),
    name: nonEmpty.max(200),
    unit: nonEmpty.max(30),
    category: optionalText,
    type: optionalText,
    minStock: z.number().int().min(0).max(1_000_000).default(0),
    barcode: optionalText,
  }),
  'warehouses:list': z.object({}),
  'inventory:stock': z.object({
    warehouseId: optionalText,
    query: optionalText,
  }),
  'inventory:receive': z.object({
    materialId: nonEmpty,
    warehouseId: nonEmpty,
    quantity: z.number().int().positive().max(10_000_000),
    batchNumber: optionalText,
    expiryDate: optionalText,
    entryNumber: optionalText,
    notes: optionalText,
  }),
  'inventory:issue': z.object({
    materialId: nonEmpty,
    warehouseId: nonEmpty,
    quantity: z.number().int().positive().max(10_000_000),
    notes: optionalText,
  }),
  'audit:list': z.object({ limit: z.number().int().min(1).max(500).default(100) }),
  'audit:verify': z.object({}),
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
  VALIDATION_ERROR: 'بيانات غير صحيحة. يرجى مراجعة الحقول.',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع. لم تُنفَّذ العملية.',
};
