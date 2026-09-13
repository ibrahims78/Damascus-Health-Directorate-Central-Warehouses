import { contextBridge, ipcRenderer } from 'electron';

/**
 * الجسر الوحيد بين الواجهة والعملية الرئيسية.
 * واجهة مُعدَّدة بأسماء صريحة — لا تمرير قنوات عام ولا كشف لأي قدرة نظامية.
 */

type Envelope<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

function invoke<T>(channel: string, payload: unknown = {}): Promise<Envelope<T>> {
  return ipcRenderer.invoke(channel, payload) as Promise<Envelope<T>>;
}

const api = {
  auth: {
    login: (username: string, password: string) => invoke('auth:login', { username, password }),
    logout: () => invoke('auth:logout'),
    me: () => invoke('auth:me'),
    changePassword: (oldPassword: string, newPassword: string) =>
      invoke('auth:changePassword', { oldPassword, newPassword }),
  },
  materials: {
    list: (query?: string | null, onlyBelowMin?: boolean) =>
      invoke('materials:list', { query: query ?? null, onlyBelowMin: onlyBelowMin ?? null }),
    create: (input: unknown) => invoke('materials:create', input),
    update: (input: unknown) => invoke('materials:update', input),
  },
  warehouses: {
    list: () => invoke('warehouses:list'),
    save: (input: unknown) => invoke('warehouses:save', input),
  },
  suppliers: {
    list: () => invoke('suppliers:list'),
    save: (input: unknown) => invoke('suppliers:save', input),
  },
  inventory: {
    stock: (filters?: { warehouseId?: string | null; query?: string | null; onlyBelowMin?: boolean }) =>
      invoke('inventory:stock', {
        warehouseId: filters?.warehouseId ?? null,
        query: filters?.query ?? null,
        onlyBelowMin: filters?.onlyBelowMin ?? null,
      }),
    receive: (input: unknown) => invoke('inventory:receive', input),
    issue: (input: unknown) => invoke('inventory:issue', input),
    transfer: (input: unknown) => invoke('inventory:transfer', input),
    dispose: (input: unknown) => invoke('inventory:dispose', input),
    adjust: (input: unknown) => invoke('inventory:adjust', input),
    findByBarcode: (code: string) => invoke('inventory:findByBarcode', { code }),
  },
  custody: {
    list: (status?: 'active' | 'closed' | null) => invoke('custody:list', { status: status ?? null }),
    assign: (input: unknown) => invoke('custody:assign', input),
    returnBack: (input: unknown) => invoke('custody:return', input),
    revealId: (custodyId: string) => invoke('custody:revealId', { custodyId }),
  },
  reports: {
    run: (input: unknown) => invoke('reports:run', input),
    export: (input: unknown) => invoke('reports:export', input),
  },
  users: {
    list: () => invoke('users:list'),
    create: (input: unknown) => invoke('users:create', input),
    setStatus: (input: unknown) => invoke('users:setStatus', input),
    setRole: (input: unknown) => invoke('users:setRole', input),
    resetPassword: (userId: string) => invoke('users:resetPassword', { userId }),
    roles: () => invoke('roles:list'),
  },
  notices: {
    list: (limit = 100) => invoke('notices:list', { limit }),
    create: (input: unknown) => invoke('notices:create', input),
    remove: (id: string) => invoke('notices:delete', { id }),
  },
  audit: {
    list: (limit = 200) => invoke('audit:list', { limit }),
    verify: () => invoke('audit:verify'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch: unknown) => invoke('settings:set', patch),
  },
  backup: {
    list: () => invoke('backup:list'),
    create: () => invoke('backup:create'),
    restore: (file: string) => invoke('backup:restore', { file, confirmation: 'RESTORE' as const }),
    export: (file: string) => invoke('backup:export', { file }),
  },
  dashboard: {
    stats: () => invoke('dashboard:stats'),
  },
} as const;

export type WhshamApi = typeof api;

contextBridge.exposeInMainWorld('whsham', api);
