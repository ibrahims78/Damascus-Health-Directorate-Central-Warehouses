/**
 * مصفوفة الأدوار والصلاحيات — مصدر الحقيقة الوحيد.
 * قاعدة: لا تُمنح صلاحية ضمنيًا. أي صلاحية غير مذكورة هنا = مرفوضة.
 */

export const PERMISSIONS = [
  'MATERIALS_VIEW',
  'MATERIALS_MANAGE',
  'STOCK_VIEW',
  'STOCK_RECEIVE',
  'STOCK_ISSUE',
  'STOCK_TRANSFER',
  'STOCK_DISPOSE',
  'WAREHOUSES_VIEW',
  'WAREHOUSES_MANAGE',
  'SUPPLIERS_VIEW',
  'SUPPLIERS_MANAGE',
  'CUSTODY_VIEW',
  'CUSTODY_MANAGE',
  'MOVEMENTS_VIEW',
  'REPORTS_VIEW',
  'REPORTS_EXPORT',
  'USERS_VIEW',
  'USERS_MANAGE',
  'USERS_APPROVE',
  'PERMISSIONS_MANAGE',
  'AUDIT_VIEW',
  'SETTINGS_MANAGE',
  'BACKUP_MANAGE',
  'MESSAGES_USE',
  'AI_USE',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  'Admin',
  'Central',
  'Branch',
  'Observer',
  'EndUser',
  'Support',
  'Disposal',
  'Assistant',
] as const;

export type RoleId = (typeof ROLES)[number];

export const ROLE_TITLES_AR: Record<RoleId, string> = {
  Admin: 'مدير النظام',
  Central: 'مسؤول المستودع المركزي',
  Branch: 'مسؤول فرع',
  Observer: 'مراقب',
  EndUser: 'مستخدم نهائي',
  Support: 'الدعم',
  Disposal: 'الإتلاف',
  Assistant: 'معاون',
};

const VIEW_ONLY: Permission[] = [
  'MATERIALS_VIEW',
  'STOCK_VIEW',
  'WAREHOUSES_VIEW',
  'MOVEMENTS_VIEW',
  'REPORTS_VIEW',
  'SUPPLIERS_VIEW',
  'CUSTODY_VIEW',
];

export const ROLE_PERMISSIONS: Record<RoleId, readonly Permission[]> = {
  Admin: ['*' as Permission],
  Central: [
    ...VIEW_ONLY,
    'MATERIALS_MANAGE',
    'STOCK_RECEIVE',
    'STOCK_ISSUE',
    'STOCK_TRANSFER',
    'WAREHOUSES_MANAGE',
    'SUPPLIERS_MANAGE',
    'CUSTODY_MANAGE',
    'REPORTS_EXPORT',
    'MESSAGES_USE',
  ],
  Branch: [
    'MATERIALS_VIEW',
    'STOCK_VIEW',
    'STOCK_RECEIVE',
    'STOCK_ISSUE',
    'WAREHOUSES_VIEW',
    'MOVEMENTS_VIEW',
    'CUSTODY_VIEW',
    'REPORTS_VIEW',
    'MESSAGES_USE',
  ],
  Observer: VIEW_ONLY,
  EndUser: ['MATERIALS_VIEW', 'STOCK_VIEW', 'STOCK_RECEIVE', 'MOVEMENTS_VIEW', 'MESSAGES_USE'],
  Support: ['MATERIALS_VIEW', 'MATERIALS_MANAGE', 'MESSAGES_USE'],
  Disposal: ['MATERIALS_VIEW', 'STOCK_VIEW', 'STOCK_DISPOSE', 'MOVEMENTS_VIEW'],
  Assistant: ['USERS_VIEW', 'USERS_APPROVE', 'MESSAGES_USE'],
};

export function hasPermission(
  role: string,
  permission: Permission,
  overrides: readonly Permission[] = [],
): boolean {
  const base = ROLE_PERMISSIONS[role as RoleId];
  if (!base) return false;
  if (base.includes('*' as Permission) || overrides.includes('*' as Permission)) return true;
  return base.includes(permission) || overrides.includes(permission);
}

export function isLockedOut(failedAttempts: number): boolean {
  return failedAttempts >= 5;
}

export const LOCKOUT_MINUTES = 15;
export const SESSION_IDLE_MINUTES = 20;
export const MIN_PASSWORD_LENGTH = 10;
